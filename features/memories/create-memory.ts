import "server-only";

import { randomUUID } from "node:crypto";

import { lockMemory, type Tx } from "@/features/memories/lock";
import { renewUploadLease } from "@/features/memories/upload-lease";
import { hashClaimToken } from "@/lib/claim-token";
import { createLogger } from "@/lib/logger";
import { extensionFor, MAX_FILES_PER_MEMORY, maxBytesFor, memoryTypeFor, normalizeMime } from "@/lib/media-types";
import { storagePrefix } from "@/lib/site-url";
import { mintUploadTicket, type UploadTicket } from "@/lib/upload-ticket";
import { replaceRequestSchema } from "@/lib/validations/media";
import { type MemoryFileInput, uploadTicketRequestSchema } from "@/lib/validations/memory";
import { getUploadEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";

const log = createLogger({ category: "upload" });

/** Re-exported for existing callers; the constant lives in lib/media-types so validation can import it. */
export { MAX_FILES_PER_MEMORY };
const DAY_MS = 24 * 60 * 60 * 1000;
/** Neon computes can take a couple of seconds to wake; Prisma's defaults (2 s / 5 s) are too tight. */
export const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

export type UploadGrant = { pathname: string; ticket: UploadTicket };

export type UploadTicketResult =
  | { ok: true; upload: UploadGrant }
  | { ok: false; code: "invalid" | "unsupported_type" | "too_large" | "budget_exceeded" | "not_found" | "too_many_files" | "replacement_pending" };

export interface ResolvedFile {
  mimeType: string;
  /** The reservation and the ticket's ceiling: the kind's maximum for a claim-page file, or the declared size for a send (createSubmission). */
  maxBytes: number;
  extension: string;
  originalFilename: string;
  durationSeconds: number | null;
  caption: string | null;
  approxDateText: string | null;
  place: string | null;
}

export function resolveFile(file: MemoryFileInput): ResolvedFile | "unsupported_type" | "too_large" {
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

/** True when `addMemories` more memories and `addBytes` more ticketed bytes fit in today's budgets. */
export async function withinBudget(tx: Tx, addBytes: number, addMemories: number): Promise<boolean> {
  const env = getUploadEnv();
  const since = new Date(Date.now() - DAY_MS);
  if (addMemories > 0) {
    const memories = await tx.memory.count({ where: { createdAt: { gt: since } } });
    if (memories + addMemories > env.DAILY_MEMORY_BUDGET) {
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

/** The PENDING row alone, with a fresh write-once pathname; the caller decides whether a ticket is minted now (the claim page) or per file later (createSubmission). */
export async function createPendingMediaRow(
  tx: Tx,
  memoryId: string,
  file: ResolvedFile,
  placement: { sortOrder: number; replacesMediaId: string | null }
): Promise<{ mediaId: string; pathname: string }> {
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
  return { mediaId: media.id, pathname };
}

async function createPendingMedia(
  tx: Tx,
  memoryId: string,
  file: ResolvedFile,
  placement: { sortOrder: number; replacesMediaId: string | null }
): Promise<UploadGrant> {
  const { mediaId, pathname } = await createPendingMediaRow(tx, memoryId, file, placement);
  const ticket = mintUploadTicket({ mediaId, memoryId, pathname, mimeType: file.mimeType, maxBytes: file.maxBytes });
  return { pathname, ticket };
}

/** Next display slot: rows are never hard-deleted, so the row count is monotonic. */
async function nextSortOrder(tx: Tx, memoryId: string): Promise<number> {
  return tx.media.count({ where: { memoryId } });
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
    // Anchor first, then this memory: the one lock order every multi-memory writer shares (C25).
    await renewUploadLease(tx, memory);
    await lockMemory(tx, memory.id);
    if ((await liveFileCount(tx, memory.id)) >= MAX_FILES_PER_MEMORY) {
      return "too_many_files" as const;
    }
    if (!(await withinBudget(tx, file.maxBytes, 0))) {
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
    await renewUploadLease(tx, memory);
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
    if (!(await withinBudget(tx, file.maxBytes, 0))) {
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
