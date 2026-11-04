import "server-only";

import { randomUUID } from "node:crypto";

import { completeSubmission } from "@/features/memories/complete-submission";
import { createPendingMediaRow, resolveFile, type ResolvedFile, TX_OPTIONS, withinBudget } from "@/features/memories/create-memory";
import { hashClaimToken, newClaimToken } from "@/lib/claim-token";
import { createLogger } from "@/lib/logger";
import { memoryCreated } from "@/lib/sentry/metrics";
import { identifyContributor, tagIds } from "@/lib/sentry/user";
import { summarizeMemoryType } from "@/lib/media-types";
import { UPLOAD_LEASE_MS } from "@/lib/upload-ticket";
import { createSubmissionInputSchema, type SubmissionIssueField, submissionIssueLocation, type SubmissionMemoryInput } from "@/lib/validations/memory";
import { getMemorialEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";

const log = createLogger({ category: "upload" });

/** One file's place in a send; its ticket is minted later by `issueUploadTicket`, right before its upload. */
export interface SubmissionFile {
  fileIndex: number;
  mediaId: string;
}

export interface SubmissionMemory {
  index: number;
  memoryId: string;
  /** Raw token: the browser holds it for the upload steps and hands every one back to `completeSubmission`. */
  claimToken: string;
  files: SubmissionFile[];
}

export type CreateSubmissionResult =
  | { ok: true; submissionId: string; memories: SubmissionMemory[]; emailed: boolean }
  | {
      ok: false;
      code: "invalid" | "unsupported_type" | "too_large" | "budget_exceeded";
      message: string;
      /** The card and file the problem belongs to, when it belongs to one. */
      memoryIndex: number | null;
      fileIndex: number | null;
      /** The contributor field the problem belongs to (name or email), when it belongs to one. */
      field: SubmissionIssueField;
    };

interface ResolvedMemory {
  input: SubmissionMemoryInput;
  files: ResolvedFile[];
  hasWords: boolean;
}

/** The reservation for one declared file: its own size, never more than the kind's ceiling; an unknown (0) size falls back to the ceiling. */
function declaredBytes(file: ResolvedFile, declaredSize: number): number {
  return declaredSize > 0 ? Math.min(file.maxBytes, declaredSize) : file.maxBytes;
}

/**
 * Create a whole send from the /share cards: one new Contributor, N PENDING
 * memories that share a `submissionId` and are numbered 0..N-1, and their
 * PENDING Media rows in display order, with no tickets (each file gets its
 * ticket from `issueUploadTicket` right before it is uploaded). Everything
 * happens in one transaction behind the daily budgets, which count the N
 * memories and the declared bytes rather than every file's ceiling.
 *
 * Index 0 is the anchor: it carries the upload lease while files may still
 * be landing, and later the send's one confirmation email row. Visibility,
 * the notify flag and consent are shared by every memory of the send (D5).
 */
export async function createSubmission(raw: unknown): Promise<CreateSubmissionResult> {
  const parsed = createSubmissionInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue ? submissionIssueLocation(issue) : { memoryIndex: null, fileIndex: null, field: null, message: "Invalid input" };
    return { ok: false, code: "invalid", message: where.message, memoryIndex: where.memoryIndex, fileIndex: where.fileIndex, field: where.field };
  }
  const input = parsed.data;
  // Identity as soon as it is known (plan 2026-11-04 §8.2); the id follows once the row exists.
  identifyContributor({ email: input.email, name: input.name });

  const resolved: ResolvedMemory[] = [];
  for (const [memoryIndex, memory] of input.memories.entries()) {
    const files: ResolvedFile[] = [];
    for (const [fileIndex, file] of memory.files.entries()) {
      const outcome = resolveFile(file);
      if (outcome === "unsupported_type") {
        return { ok: false, code: outcome, message: "That kind of file is not supported", memoryIndex, fileIndex, field: null };
      }
      if (outcome === "too_large") {
        return { ok: false, code: outcome, message: "That file is too large", memoryIndex, fileIndex, field: null };
      }
      files.push({ ...outcome, maxBytes: declaredBytes(outcome, file.size) });
    }
    resolved.push({ input: memory, files, hasWords: (memory.note ?? "").trim().length > 0 });
  }
  const declaredTotal = resolved.reduce((sum, m) => sum + m.files.reduce((s, f) => s + f.maxBytes, 0), 0);
  const hasFiles = declaredTotal > 0 || resolved.some((m) => m.files.length > 0);

  const { MEMORIAL_SLUG, CONSENT_VERSION } = getMemorialEnv();
  const submissionId = randomUUID();
  const tokens = resolved.map(() => newClaimToken());

  const created = await getDb().$transaction(async (tx) => {
    if (!(await withinBudget(tx, declaredTotal, resolved.length))) {
      return null;
    }
    const memorial = await tx.memorial.findUnique({ where: { slug: MEMORIAL_SLUG } });
    if (!memorial) {
      throw new Error(`Memorial "${MEMORIAL_SLUG}" is not seeded`);
    }
    const contributor = await tx.contributor.create({
      data: {
        memorialId: memorial.id,
        name: input.name,
        email: input.email,
        relationship: input.relationship ?? null,
        contactOptIn: input.contactOptIn,
        mailingListOptIn: input.mailingListOptIn,
      },
    });
    identifyContributor({ id: contributor.id, email: contributor.email, name: contributor.name });
    const consentedAt = new Date();
    const memories: SubmissionMemory[] = [];
    for (const [index, memory] of resolved.entries()) {
      const row = await tx.memory.create({
        data: {
          memorialId: memorial.id,
          contributorId: contributor.id,
          // Validation guarantees files or words, so the summary is never null; TEXT is only the type-level fallback.
          type: summarizeMemoryType(memory.files, memory.hasWords) ?? "TEXT",
          source: "WEB_UPLOAD",
          approxDateText: memory.input.approxDateText ?? null,
          place: memory.input.place ?? null,
          contributorNote: memory.hasWords ? memory.input.note : null,
          visibility: input.visibility,
          notifyWhenPosted: input.notifyWhenPosted,
          consentVersion: CONSENT_VERSION,
          consentedAt,
          status: "PENDING",
          claimTokenHash: hashClaimToken(tokens[index]!),
          submissionId,
          submissionIndex: index,
          uploadLeaseUntil: index === 0 && hasFiles ? new Date(Date.now() + UPLOAD_LEASE_MS) : null,
        },
      });
      const files: SubmissionFile[] = [];
      for (const [fileIndex, file] of memory.files.entries()) {
        const { mediaId } = await createPendingMediaRow(tx, row.id, file, { sortOrder: fileIndex, replacesMediaId: null });
        files.push({ fileIndex, mediaId });
      }
      memories.push({ index, memoryId: row.id, claimToken: tokens[index]!, files });
    }
    return memories;
  }, TX_OPTIONS);

  if (!created) {
    log.warn({ action: "budget_refusal", memories: resolved.length }, "daily budget reached");
    return { ok: false, code: "budget_exceeded", message: "We are receiving a lot of memories right now. Please try again later.", memoryIndex: null, fileIndex: null, field: null };
  }
  tagIds({ submissionId });
  memoryCreated(created.length);
  log.info({ action: "submission_created", submissionId, memories: created.length, files: created.reduce((n, m) => n + m.files.length, 0) }, "submission created");
  // A send with no files is complete now: the receipt goes out while this
  // request still holds every raw token, and the admin alerts follow the
  // response. A send with files is completed by the browser after its uploads.
  let emailed = false;
  if (!hasFiles) {
    const completion = await completeSubmission({ claimTokens: created.map((m) => m.claimToken) }, { thumbnailWaitMs: 0 });
    emailed = completion.ok && completion.emailed;
  }
  return { ok: true, submissionId, memories: created, emailed };
}
