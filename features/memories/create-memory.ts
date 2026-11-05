import "server-only";

import { randomUUID } from "node:crypto";

import { BudgetBusyError, lockBudget, lockMemory, type Tx } from "@/features/memories/lock";
import { renewUploadLease } from "@/features/memories/upload-lease";
import { hashClaimToken } from "@/lib/claim-token";
import { createLogger } from "@/lib/logger";
import { extensionFor, MAX_FILES_PER_MEMORY, maxBytesFor, memoryTypeFor, normalizeMime } from "@/lib/media-types";
import { storagePrefix } from "@/lib/site-url";
import { mintUploadTicket, UPLOAD_WINDOW_MS, type UploadTicket } from "@/lib/upload-ticket";
import { replaceRequestSchema } from "@/lib/validations/media";
import { type MemoryFileInput, uploadTicketRequestSchema } from "@/lib/validations/memory";
import { tagIds } from "@/lib/sentry/user";
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

/** What the budget knows about the tables at one instant (one statement, one snapshot). */
export interface BudgetStats {
  /** Memories created in the last 24 h. */
  memoriesToday: number;
  /** READY rows created in the last 24 h (their ticketed `maxBytes`) plus every open reservation. */
  bytesToday: number;
  /** READY originals, by their real size. */
  storedBytes: number;
  /** READY derived copies (web images and thumbnails), by their real size. */
  derivedBytes: number;
  /** Every open reservation's `maxBytes`, whatever its age. */
  openBytes: number;
}

/**
 * The budget's one read. A PENDING row is an *open reservation* while its
 * upload window (`reservedUntil`: creation or last ticket + UPLOAD_WINDOW_MS)
 * is ahead; a row the old code wrote before the column existed is open for a
 * day from its creation, which is what it always was. Cancelled rows count
 * like any other until their window closes: cancelling cannot recall a Blob
 * token that was already handed out (TCR #3/#9). Expired and FAILED
 * reservations never got bytes and no token for them is still valid, so they
 * stop counting (T10). An open reservation counts toward the day whatever its
 * `createdAt`: being open means it was ticketed within the last 75 min (TCR #5).
 *
 * One statement rather than five aggregates: at READ COMMITTED each statement
 * has its own snapshot, and a file finalized between two of them would appear
 * in neither the stored nor the open sum (TCR #10). The whole read also holds
 * the budget lock for one round trip instead of five. (REPEATABLE READ would
 * not do: its snapshot is taken by the lock statement itself, before the lock
 * is granted, so it would predate the previous holder's commit.)
 *
 * Caller holds `lockBudget`. The sums are cast to float8 so they arrive as
 * numbers; every value is an exact integer well under 2^53.
 */
export async function readBudgetStats(tx: Tx, now: Date): Promise<BudgetStats> {
  const since = new Date(now.getTime() - DAY_MS);
  const rows = await tx.$queryRaw<BudgetStats[]>`
    SELECT
      (SELECT COUNT(*) FROM "Memory" WHERE "createdAt" > ${since})::int AS "memoriesToday",
      (SELECT COALESCE(SUM("maxBytes"), 0) FROM "Media"
        WHERE ("status" = 'READY' AND "createdAt" > ${since})
           OR ("status" = 'PENDING' AND ("reservedUntil" > ${now} OR ("reservedUntil" IS NULL AND "createdAt" > ${since}))))::float8 AS "bytesToday",
      (SELECT COALESCE(SUM("sizeBytes"), 0) FROM "Media" WHERE "status" = 'READY')::float8 AS "storedBytes",
      (SELECT COALESCE(SUM("sizeBytes"), 0) FROM "DerivedMedia" WHERE "status" = 'READY')::float8 AS "derivedBytes",
      (SELECT COALESCE(SUM("maxBytes"), 0) FROM "Media"
        WHERE "status" = 'PENDING' AND ("reservedUntil" > ${now} OR ("reservedUntil" IS NULL AND "createdAt" > ${since})))::float8 AS "openBytes"`;
  const stats = rows[0];
  if (!stats) {
    throw new Error("budget statistics query returned no row");
  }
  return stats;
}

/**
 * True when `addMemories` more memories and `addBytes` more ticketed bytes fit
 * in today's budgets and under the total ceiling, given the lock is already
 * held (`issueUploadTicket` takes it earlier, for its own re-read).
 *
 * The day's bytes are READY rows (their ticketed ceiling, `maxBytes`) plus
 * open reservations. The stock is READY originals (`sizeBytes`) plus READY
 * derived copies plus every open reservation, of any age, against
 * TOTAL_BYTE_CEILING (Oscar #16).
 */
export async function budgetHasRoom(tx: Tx, addBytes: number, addMemories: number, now = new Date()): Promise<boolean> {
  const env = getUploadEnv();
  const stats = await readBudgetStats(tx, now);
  if (addMemories > 0 && stats.memoriesToday + addMemories > env.DAILY_MEMORY_BUDGET) {
    return false;
  }
  if (addBytes > 0) {
    if (stats.bytesToday + addBytes > env.DAILY_BYTE_BUDGET) {
      return false;
    }
    const stock = stats.storedBytes + stats.derivedBytes + stats.openBytes;
    if (stock + addBytes > env.TOTAL_BYTE_CEILING) {
      log.warn({ action: "ceiling_refusal", stock, addBytes }, "total byte ceiling reached");
      return false;
    }
  }
  return true;
}

/**
 * `budgetHasRoom` behind the global advisory lock (issue #44, Oscar #13):
 * without it, concurrent writers at READ COMMITTED each see the same capacity
 * and all commit past it. Callers that also take row locks take them before
 * calling this (lease → memory → budget); nothing waits on a row lock
 * afterwards. Throws `BudgetBusyError` when the lock is not granted in time.
 */
export async function withinBudget(tx: Tx, addBytes: number, addMemories: number): Promise<boolean> {
  await lockBudget(tx);
  return budgetHasRoom(tx, addBytes, addMemories);
}

/** Live rows (READY or PENDING, not removed) count against MAX_FILES_PER_MEMORY; FAILED and removed rows do not. */
async function liveFileCount(tx: Tx, memoryId: string): Promise<number> {
  return tx.media.count({ where: { memoryId, deletedAt: null, status: { in: ["PENDING", "READY"] } } });
}

/**
 * The PENDING row alone, with a fresh write-once pathname; the caller decides
 * whether a ticket is minted now (the claim page) or per file later
 * (createSubmission). Either way the reservation opens with one full upload
 * window from `now`: a ticket minted at that same instant can land bytes until
 * then, and until then the row holds its bytes of the budget (issue #44).
 */
export async function createPendingMediaRow(
  tx: Tx,
  memoryId: string,
  file: ResolvedFile,
  placement: { sortOrder: number; replacesMediaId: string | null },
  now = Date.now()
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
      reservedUntil: new Date(now + UPLOAD_WINDOW_MS),
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
  // One clock reading for the row and the ticket, so the window is exactly the token's last possible byte (TCR #6).
  const now = Date.now();
  const { mediaId, pathname } = await createPendingMediaRow(tx, memoryId, file, placement, now);
  const ticket = mintUploadTicket({ mediaId, memoryId, pathname, mimeType: file.mimeType, maxBytes: file.maxBytes }, { now });
  return { pathname, ticket };
}

/** The claim-page ticket transactions answer a lock wait with the ordinary budget refusal instead of a 500 (TCR #4). */
async function ticketTransaction<T>(run: () => Promise<T | "budget_exceeded">): Promise<T | "budget_exceeded"> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof BudgetBusyError) {
      log.warn({ action: "budget_busy" }, "budget lock wait timed out; answered budget_exceeded");
      return "budget_exceeded";
    }
    throw error;
  }
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
  const result = await ticketTransaction(() => getDb().$transaction(async (tx) => {
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
    const grant = await createPendingMedia(tx, memory.id, file, { sortOrder: await nextSortOrder(tx, memory.id), replacesMediaId: null });
    tagIds({ memoryId: memory.id, mediaId: grant.ticket.mediaId });
    return grant;
  }, TX_OPTIONS));
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
  const result = await ticketTransaction(() => getDb().$transaction(async (tx) => {
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
    const grant = await createPendingMedia(tx, memory.id, inherited, { sortOrder: target.sortOrder, replacesMediaId: target.id });
    tagIds({ memoryId: memory.id, mediaId: grant.ticket.mediaId });
    return grant;
  }, TX_OPTIONS));
  if (typeof result === "string") {
    return { ok: false, code: result };
  }
  log.info({ action: "replacement_ticket", mediaId }, "replacement ticket minted");
  return { ok: true, upload: result };
}
