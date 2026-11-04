import "server-only";

import { randomUUID } from "node:crypto";

import { confirmQuietly } from "@/features/memories/ingest-upload";
import { lockMemory, type Tx } from "@/features/memories/lock";
import { hashClaimToken, newClaimToken } from "@/lib/claim-token";
import { createLogger } from "@/lib/logger";
import { extensionFor, MAX_FILES_PER_MEMORY, maxBytesFor, memoryTypeFor, normalizeMime, summarizeMemoryType } from "@/lib/media-types";
import { storagePrefix } from "@/lib/site-url";
import { mintUploadTicket, type UploadTicket } from "@/lib/upload-ticket";
import { claimMediaRefSchema, replaceRequestSchema } from "@/lib/validations/media";
import { createMemoryInputSchema, type MemoryFileInput, uploadTicketRequestSchema } from "@/lib/validations/memory";
import { getMemorialEnv, getUploadEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";

const log = createLogger({ category: "upload" });

/** Re-exported for existing callers; the constant lives in lib/media-types so validation can import it. */
export { MAX_FILES_PER_MEMORY };
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Submission lease: how long the reconcile cron waits, from the last ticket,
 * before it may confirm (and rotate the link of) a memory whose contributor
 * may still be sending files. Longer than the 1 h Blob client token.
 */
export const LEASE_MS = 70 * 60 * 1000;
/** Neon computes can take a couple of seconds to wake; Prisma's defaults (2 s / 5 s) are too tight. */
const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

export type UploadGrant = { pathname: string; ticket: UploadTicket };

export type CreateMemoryResult =
  | { ok: true; memoryId: string; claimToken: string; media: Array<{ mediaId: string; sortOrder: number }>; emailed: boolean }
  | { ok: false; code: "invalid" | "unsupported_type" | "too_large" | "budget_exceeded"; message: string };

export type UploadTicketResult =
  | { ok: true; upload: UploadGrant }
  | { ok: false; code: "invalid" | "unsupported_type" | "too_large" | "budget_exceeded" | "not_found" | "too_many_files" | "replacement_pending" };

interface ResolvedFile {
  mimeType: string;
  maxBytes: number;
  extension: string;
  originalFilename: string;
  durationSeconds: number | null;
  caption: string | null;
  approxDateText: string | null;
  place: string | null;
}

function resolveFile(file: MemoryFileInput): ResolvedFile | "unsupported_type" | "too_large" {
  const mimeType = normalizeMime(file.type, file.name);
  if (!mimeType) {
    return "unsupported_type";
  }
  const maxBytes = maxBytesFor(mimeType);
  if (file.size > maxBytes) {
    return "too_large";
  }
  const durationSeconds = memoryTypeFor(mimeType) !== "PHOTO" && file.durationSeconds !== undefined && file.durationSeconds > 0
    ? file.durationSeconds
    : null;
  return {
    mimeType,
    maxBytes,
    extension: extensionFor(mimeType),
    originalFilename: file.name.slice(0, 255),
    durationSeconds,
    caption: file.caption ?? null,
    approxDateText: file.approxDateText ?? null,
    place: file.place ?? null,
  };
}

/** Keep the cron off this memory for a while: the contributor is (still) sending files. */
async function renewLease(tx: Tx, memoryId: string): Promise<void> {
  await tx.memory.update({ where: { id: memoryId }, data: { uploadLeaseUntil: new Date(Date.now() + LEASE_MS) } });
}

/** True when one more memory and `addBytes` more ticketed bytes fit in today's budgets. */
async function withinBudget(tx: Tx, addBytes: number, countMemory: boolean): Promise<boolean> {
  const env = getUploadEnv();
  const since = new Date(Date.now() - DAY_MS);
  if (countMemory) {
    const memories = await tx.memory.count({ where: { createdAt: { gt: since } } });
    if (memories >= env.DAILY_MEMORY_BUDGET) {
      return false;
    }
  }
  if (addBytes > 0) {
    const bytes = await tx.media.aggregate({ _sum: { maxBytes: true }, where: { createdAt: { gt: since } } });
    if ((bytes._sum.maxBytes ?? 0) + addBytes > env.DAILY_BYTE_BUDGET) {
      return false;
    }
  }
  return true;
}

/** Live rows (READY or PENDING, not removed) count against MAX_FILES_PER_MEMORY; FAILED and removed rows do not. */
async function liveFileCount(tx: Tx, memoryId: string): Promise<number> {
  return tx.media.count({ where: { memoryId, deletedAt: null, status: { in: ["PENDING", "READY"] } } });
}

async function createPendingMedia(
  tx: Tx,
  memoryId: string,
  file: ResolvedFile,
  placement: { sortOrder: number; replacesMediaId: string | null }
): Promise<UploadGrant> {
  const pathname = `${storagePrefix()}${memoryId}/${randomUUID()}.${file.extension}`;
  const media = await tx.media.create({
    data: {
      memoryId,
      storageKey: pathname,
      mimeType: file.mimeType,
      maxBytes: file.maxBytes,
      originalFilename: file.originalFilename,
      durationSeconds: file.durationSeconds,
      caption: file.caption,
      approxDateText: file.approxDateText,
      place: file.place,
      status: "PENDING",
      sortOrder: placement.sortOrder,
      replacesMediaId: placement.replacesMediaId,
    },
  });
  const ticket = mintUploadTicket({
    mediaId: media.id,
    memoryId,
    pathname,
    mimeType: file.mimeType,
    maxBytes: file.maxBytes,
  });
  return { pathname, ticket };
}

/** Next display slot: rows are never hard-deleted, so the row count is monotonic. */
async function nextSortOrder(tx: Tx, memoryId: string): Promise<number> {
  return tx.media.count({ where: { memoryId } });
}

/**
 * Create a memory from the /share form: a new Contributor for this submission
 * (never matched to an existing one by unverified email), a PENDING Memory
 * with a fresh claim token (stored hashed), and, when a file is attached, a
 * PENDING Media row whose upload ticket the browser exchanges at /api/upload.
 * Everything happens in one transaction behind the daily budgets.
 */
export async function createMemory(raw: unknown): Promise<CreateMemoryResult> {
  const parsed = createMemoryInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const input = parsed.data;
  const files: ResolvedFile[] = [];
  for (const file of input.files) {
    const resolved = resolveFile(file);
    if (resolved === "unsupported_type") {
      return { ok: false, code: "unsupported_type", message: "That kind of file is not supported" };
    }
    if (resolved === "too_large") {
      return { ok: false, code: "too_large", message: "That file is too large" };
    }
    files.push(resolved);
  }
  const hasWords = (input.note ?? "").trim().length > 0;

  const { MEMORIAL_SLUG, CONSENT_VERSION } = getMemorialEnv();
  const claimToken = newClaimToken();

  const created = await getDb().$transaction(async (tx) => {
    if (!(await withinBudget(tx, files.reduce((sum, f) => sum + f.maxBytes, 0), true))) {
      return null;
    }
    const memorial = await tx.memorial.findUnique({ where: { slug: MEMORIAL_SLUG } });
    if (!memorial) {
      throw new Error(`Memorial "${MEMORIAL_SLUG}" is not seeded`);
    }
    const contributor = await tx.contributor.create({
      data: {
        memorialId: memorial.id,
        name: input.name ?? null,
        email: input.email ?? null,
        relationship: input.relationship ?? null,
        contactOptIn: input.contactOptIn,
        mailingListOptIn: input.mailingListOptIn,
      },
    });
    const memory = await tx.memory.create({
      data: {
        memorialId: memorial.id,
        contributorId: contributor.id,
        type: summarizeMemoryType(files, hasWords) ?? "TEXT",
        source: "WEB_UPLOAD",
        approxDateText: input.approxDateText ?? null,
        place: input.place ?? null,
        contributorNote: hasWords ? input.note : null,
        visibility: input.visibility,
        notifyWhenPosted: input.notifyWhenPosted,
        consentVersion: CONSENT_VERSION,
        consentedAt: new Date(),
        status: "PENDING",
        claimTokenHash: hashClaimToken(claimToken),
        // The contributor is about to send these files; the cron waits for the lease (or completeSubmission).
        uploadLeaseUntil: files.length > 0 ? new Date(Date.now() + LEASE_MS) : null,
      },
    });
    // Rows only: each ticket is minted right before its upload (issueUploadTicket), so none can expire in a queue.
    const media: Array<{ mediaId: string; sortOrder: number }> = [];
    for (const [sortOrder, file] of files.entries()) {
      const row = await tx.media.create({
        data: {
          memoryId: memory.id,
          storageKey: `${storagePrefix()}${memory.id}/${randomUUID()}.${file.extension}`,
          mimeType: file.mimeType,
          maxBytes: file.maxBytes,
          originalFilename: file.originalFilename,
          durationSeconds: file.durationSeconds,
          caption: file.caption,
          approxDateText: file.approxDateText,
          place: file.place,
          status: "PENDING",
          sortOrder,
          replacesMediaId: null,
        },
      });
      media.push({ mediaId: row.id, sortOrder });
    }
    return { memoryId: memory.id, media };
  }, TX_OPTIONS);

  if (!created) {
    log.warn({ action: "budget_refusal" }, "daily budget reached");
    return { ok: false, code: "budget_exceeded", message: "We are receiving a lot of memories right now. Please try again later." };
  }
  log.info({ action: "memory_created", memoryId: created.memoryId, files: created.media.length }, "memory created");
  // A text-only memory is complete now; one with files is confirmed by completeSubmission() / finalizeUpload().
  const emailed = created.media.length === 0 ? await confirmQuietly(created.memoryId, claimToken) : false;
  return { ok: true, memoryId: created.memoryId, claimToken, media: created.media, emailed };
}

/**
 * Ticket for one of the memory's own PENDING rows, minted just before the
 * browser uploads it (tickets expire 15 minutes after minting, a batch can
 * take longer). Renews the submission lease.
 */
export async function issueUploadTicket(raw: unknown): Promise<UploadTicketResult> {
  const parsed = claimMediaRefSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const { claimToken, mediaId } = parsed.data;
  const claimTokenHash = hashClaimToken(claimToken);
  const result = await getDb().$transaction(async (tx) => {
    const memory = await tx.memory.findUnique({ where: { claimTokenHash } });
    if (!memory || memory.deletedAt !== null) {
      return "not_found" as const;
    }
    await lockMemory(tx, memory.id);
    const row = await tx.media.findFirst({ where: { id: mediaId, memoryId: memory.id, status: "PENDING", deletedAt: null } });
    if (!row) {
      return "not_found" as const;
    }
    // Only a submission still in progress keeps the cron waiting; a closed lease is never reopened by a late ticket.
    if (memory.uploadLeaseUntil !== null && memory.uploadLeaseUntil.getTime() > Date.now()) {
      await renewLease(tx, memory.id);
    }
    const ticket = mintUploadTicket({ mediaId: row.id, memoryId: memory.id, pathname: row.storageKey, mimeType: row.mimeType, maxBytes: row.maxBytes });
    return { pathname: row.storageKey, ticket } satisfies UploadGrant;
  }, TX_OPTIONS);
  if (typeof result === "string") {
    return { ok: false, code: result };
  }
  return { ok: true, upload: result };
}

/** Ticket for one more file on an existing memory, from its claim page. */
export async function createUploadTicket(raw: unknown): Promise<UploadTicketResult> {
  const parsed = uploadTicketRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const file = resolveFile(parsed.data.file);
  if (file === "unsupported_type" || file === "too_large") {
    return { ok: false, code: file };
  }
  const claimTokenHash = hashClaimToken(parsed.data.claimToken);
  const result = await getDb().$transaction(async (tx) => {
    const memory = await tx.memory.findUnique({ where: { claimTokenHash } });
    if (!memory || memory.deletedAt !== null) {
      return "not_found" as const;
    }
    await lockMemory(tx, memory.id);
    if ((await liveFileCount(tx, memory.id)) >= MAX_FILES_PER_MEMORY) {
      return "too_many_files" as const;
    }
    if (!(await withinBudget(tx, file.maxBytes, false))) {
      return "budget_exceeded" as const;
    }
    // No lease here: the memory's one email was handled with its first submission; cron must not be held off.
    return createPendingMedia(tx, memory.id, file, { sortOrder: await nextSortOrder(tx, memory.id), replacesMediaId: null });
  }, TX_OPTIONS);
  if (typeof result === "string") {
    return { ok: false, code: result };
  }
  return { ok: true, upload: result };
}

/**
 * Ticket for a file that will replace one of the memory's READY files. The
 * new row is PENDING with `replacesMediaId`; the target stays visible until
 * the replacement reaches READY (ingest-upload swaps them). One pending
 * replacement per target; the cap may be exceeded by exactly one.
 */
export async function createReplacementTicket(raw: unknown): Promise<UploadTicketResult> {
  const parsed = replaceRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const file = resolveFile(parsed.data.file);
  if (file === "unsupported_type" || file === "too_large") {
    return { ok: false, code: file };
  }
  const { claimToken, mediaId } = parsed.data;
  const claimTokenHash = hashClaimToken(claimToken);
  const result = await getDb().$transaction(async (tx) => {
    const memory = await tx.memory.findUnique({ where: { claimTokenHash } });
    if (!memory || memory.deletedAt !== null) {
      return "not_found" as const;
    }
    await lockMemory(tx, memory.id);
    const target = await tx.media.findFirst({ where: { id: mediaId, memoryId: memory.id, deletedAt: null, status: "READY" } });
    if (!target) {
      return "not_found" as const;
    }
    const pending = await tx.media.findFirst({ where: { memoryId: memory.id, replacesMediaId: target.id, deletedAt: null, status: "PENDING" } });
    if (pending) {
      return "replacement_pending" as const;
    }
    if ((await liveFileCount(tx, memory.id)) >= MAX_FILES_PER_MEMORY + 1) {
      return "too_many_files" as const;
    }
    if (!(await withinBudget(tx, file.maxBytes, false))) {
      return "budget_exceeded" as const;
    }
    // The replacement keeps the target's words unless the contributor typed new ones.
    const inherited: ResolvedFile = {
      ...file,
      caption: file.caption ?? target.caption,
      approxDateText: file.approxDateText ?? target.approxDateText,
      place: file.place ?? target.place,
    };
    return createPendingMedia(tx, memory.id, inherited, { sortOrder: target.sortOrder, replacesMediaId: target.id });
  }, TX_OPTIONS);
  if (typeof result === "string") {
    return { ok: false, code: result };
  }
  log.info({ action: "replacement_ticket", mediaId }, "replacement ticket minted");
  return { ok: true, upload: result };
}
