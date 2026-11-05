import "server-only";

import { TX_OPTIONS, withinBudget } from "@/features/memories/create-memory";
import type { Prisma } from "@/generated/prisma/client";
import { hashClaimToken, newClaimToken } from "@/lib/claim-token";
import { createLogger } from "@/lib/logger";
import { getSiteUrl } from "@/lib/site-url";
import { draftMemoryInputSchema, reissueClaimLinkSchema } from "@/lib/validations/memory";
import { getMemorialEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";

const log = createLogger({ category: "api" });

export type MemoryStatus = "DRAFT" | "PENDING" | "APPROVED" | "HIDDEN";

export type DraftMemoryResult =
  /** `originalNoteRecorded` is true when the input carried the verbatim excerpt behind a rewrite and it went into the revision. */
  | { ok: true; memoryId: string; claimToken: string; claimLink: string; originalNoteRecorded: boolean }
  | { ok: false; code: "invalid"; message: string }
  | { ok: false; code: "duplicate"; memoryId: string; status: MemoryStatus }
  | { ok: false; code: "budget_exceeded" };

export type ReissueResult =
  | { ok: true; memoryId: string; claimLink: string }
  | { ok: false; code: "invalid" | "not_found" | "not_draft" };

/** Prisma's unique-constraint error. With a driver adapter `meta.target` is absent, so only the code is checked. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

function claimLinkFor(token: string): string {
  return `${getSiteUrl()}/m/${token}`;
}

/**
 * Draft a memory on a sender's behalf (docs/plans/2026-11-03-draft-memory-on-behalf.md,
 * amended by docs/plans/2026-11-05-draft-skill-rewrite-prompts.md): a new
 * Contributor, a DRAFT TEXT memory holding the sender's words (verbatim, or the
 * light rewrite Rob approved) with no consent stamp yet (the person consents by
 * pressing Share on the claim page), a fresh claim token (stored hashed) and an
 * ADMIN revision. When the stored words are a rewrite, the verbatim excerpt is
 * the revision's `before`, so the admin History shows what the sender wrote and
 * what changed; the result says so (`originalNoteRecorded`) because an older
 * server would drop the field silently.
 * One memory per `sourceRef`: a repeat answers `duplicate` with the existing
 * row's id and status, before anything is written, so a retry never leaves an
 * orphan Contributor. Admin-drafted memories get no site email (confirm.ts).
 */
export async function draftMemory(raw: unknown): Promise<DraftMemoryResult> {
  const parsed = draftMemoryInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const input = parsed.data;
  const { MEMORIAL_SLUG, CONSENT_VERSION } = getMemorialEnv();
  const claimToken = newClaimToken();
  const db = getDb();

  let created: { memoryId: string } | { duplicate: { memoryId: string; status: MemoryStatus } } | null;
  try {
    created = await db.$transaction(async (tx) => {
      const existing = await tx.memory.findUnique({ where: { sourceRef: input.sourceRef }, select: { id: true, status: true } });
      if (existing) {
        return { duplicate: { memoryId: existing.id, status: existing.status } };
      }
      if (!(await withinBudget(tx, 0, 1))) {
        return null;
      }
      const memorial = await tx.memorial.findUnique({ where: { slug: MEMORIAL_SLUG } });
      if (!memorial) {
        throw new Error(`Memorial "${MEMORIAL_SLUG}" is not seeded`);
      }
      const contributor = await tx.contributor.create({
        data: {
          memorialId: memorial.id,
          name: input.contributor.name ?? null,
          email: input.contributor.email,
          phone: input.contributor.phone ?? null,
          relationship: input.contributor.relationship ?? null,
          // Preferences are the person's to give: nothing is opted in until they press Share
          // (the claim page prefills both checkboxes on, like the /share form).
          contactOptIn: false,
        },
      });
      const memory = await tx.memory.create({
        data: {
          memorialId: memorial.id,
          contributorId: contributor.id,
          type: "TEXT",
          status: "DRAFT",
          source: input.source,
          sourceRef: input.sourceRef,
          approxDateText: input.approxDateText ?? null,
          place: input.place ?? null,
          contributorNote: input.note,
          visibility: input.visibility,
          notifyWhenPosted: true,
          consentVersion: CONSENT_VERSION,
          consentedAt: null,
          claimTokenHash: hashClaimToken(claimToken),
        },
      });
      // Everything the draft wrote, so the revision history starts from a complete picture.
      const after: Prisma.InputJsonObject = {
        note: input.note,
        name: input.contributor.name ?? null,
        relationship: input.contributor.relationship ?? null,
        approxDateText: input.approxDateText ?? null,
        place: input.place ?? null,
        visibility: input.visibility,
        status: "DRAFT",
        source: input.source,
        sourceRef: input.sourceRef,
      };
      // A rewrite starts its history from the sender's exact words; a verbatim save starts from nothing.
      const before: Prisma.InputJsonObject = input.originalNote === undefined ? {} : { note: input.originalNote };
      await tx.memoryRevision.create({ data: { memoryId: memory.id, changedVia: "ADMIN", before, after } });
      return { memoryId: memory.id };
    }, TX_OPTIONS);
  } catch (error) {
    // Two drafts of the same message at once: the loser's insert fails on the
    // unique index. Postgres has aborted that transaction, so the re-read must
    // happen out here, on a fresh connection.
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const winner = await db.memory.findUnique({ where: { sourceRef: input.sourceRef }, select: { id: true, status: true } });
    if (!winner) {
      throw error;
    }
    created = { duplicate: { memoryId: winner.id, status: winner.status } };
  }

  if (created === null) {
    log.warn({ action: "budget_refusal", source: "admin_draft" }, "daily budget reached");
    return { ok: false, code: "budget_exceeded" };
  }
  if ("duplicate" in created) {
    log.info({ action: "draft_duplicate", memoryId: created.duplicate.memoryId }, "memory already drafted for this source");
    return { ok: false, code: "duplicate", ...created.duplicate };
  }
  log.info({ action: "memory_drafted", memoryId: created.memoryId, source: input.source }, "memory drafted on a sender's behalf");
  return { ok: true, memoryId: created.memoryId, claimToken, claimLink: claimLinkFor(claimToken), originalNoteRecorded: input.originalNote !== undefined };
}

/**
 * Mint a fresh claim link for a DRAFT. This is a deliberate revocation: any
 * link already sent stops working. Allowed only while the memory is still a
 * DRAFT (a conditional write, so a concurrent Share cannot be undone).
 */
export async function reissueDraftClaimLink(raw: unknown): Promise<ReissueResult> {
  const parsed = reissueClaimLinkSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const { memoryId } = parsed.data;
  const claimToken = newClaimToken();

  const result = await getDb().$transaction(async (tx) => {
    const rotated = await tx.memory.updateMany({
      where: { id: memoryId, status: "DRAFT", deletedAt: null },
      data: { claimTokenHash: hashClaimToken(claimToken) },
    });
    if (rotated.count === 0) {
      const memory = await tx.memory.findUnique({ where: { id: memoryId }, select: { status: true, deletedAt: true } });
      return !memory || memory.deletedAt !== null ? ("not_found" as const) : ("not_draft" as const);
    }
    await tx.memoryRevision.create({ data: { memoryId, changedVia: "ADMIN", before: {}, after: { claimLinkReissued: true } } });
    return "ok" as const;
  }, TX_OPTIONS);

  if (result !== "ok") {
    return { ok: false, code: result };
  }
  log.info({ action: "draft_link_reissued", memoryId }, "claim link reissued for a draft");
  return { ok: true, memoryId, claimLink: claimLinkFor(claimToken) };
}
