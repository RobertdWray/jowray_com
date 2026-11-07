import "server-only";

import { createHash } from "node:crypto";

import { extractPhotoGps, GPS_READ_DEADLINE_MS } from "@/features/media/extract-photo-gps";
import { confirmMemory } from "@/features/memories/confirm";
import { deriveMedia } from "@/features/memories/derive-media";
import { lockMemory } from "@/features/memories/lock";
import { notifyAdminsOfMemory } from "@/features/memories/notify-admins";
import { appendClaimRevision, appendRevision, readyLiveMediaIds, recomputeMemoryType, visibleMediaIds } from "@/features/memories/media-state";
import { hashClaimToken } from "@/lib/claim-token";
import { createLogger, logError, logErrorAndFlush } from "@/lib/logger";
import { detectMediaType, isAllowedMime, SIGNATURE_PREFIX_BYTES } from "@/lib/media-types";
import { afterWithFlush } from "@/lib/sentry/after-flush";
import { uploadFinalized } from "@/lib/sentry/metrics";
import { tagIds } from "@/lib/sentry/user";
import { getSiteUrl } from "@/lib/site-url";
import { type UploadTicket, verifyUploadTicket } from "@/lib/upload-ticket";
import { getDb } from "@/server/db/client";
import { createStorageService } from "@/services/storage";

const log = createLogger({ category: "upload" });
/** Neon computes can take a couple of seconds to wake; Prisma's defaults (2 s / 5 s) are too tight. */
const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/** Files at or under this size are hashed inline in `after()`; larger ones by the cron. */
export const INLINE_HASH_MAX_BYTES = 50 * 1024 * 1024;
/** Budget for the derived copies made right after finalize (the page's Server Functions have 120 s). */
export const DERIVE_DEADLINE_FINALIZE_MS = 20_000;

/**
 * Why a row became FAILED in this call. `size_mismatch` and `checksum_mismatch`
 * are connector uploads only (plan 2026-11-06-mcp-attach-media §8.3). FAILED
 * rows store no reason, so a repeat call on a FAILED row cannot say which
 * (follow-up F9).
 */
export type FailedReason = "too_large" | "wrong_type" | "unrecognized_bytes" | "retired" | "size_mismatch" | "checksum_mismatch";

export type RecordMediaResult =
  | { status: "READY"; mediaId: string; memoryId: string; sizeBytes: number }
  /** `verifying`: the bytes are there, but the connector upload's hash did not finish before the caller's deadline. */
  | { status: "PENDING"; mediaId: string; memoryId: string; verifying?: true }
  | { status: "FAILED"; mediaId: string; memoryId: string; reason: FailedReason }
  | { status: "NOT_FOUND"; mediaId: string };

function isPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

/** True when `error` is the caller's own deadline or cancellation firing, not a failure of the store. */
function isCallerAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true && (error === signal.reason || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")));
}

/**
 * SHA-256 of a stored blob, streamed; null when the blob is missing. The
 * caller's `signal` aborts the request and also ends the read between chunks,
 * so a body that stalls (no further chunk ever arrives) is abandoned at the
 * deadline instead of holding the function open. On abort it rejects with the
 * signal's reason (a `TimeoutError` for `AbortSignal.timeout`).
 */
async function hashStoredBlob(storageKey: string, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted();
  const storage = createStorageService();
  const file = signal ? await storage.get(storageKey, { signal }) : await storage.get(storageKey);
  if (!file) {
    return null;
  }
  const hash = createHash("sha256");
  const reader = (file.stream as ReadableStream<Uint8Array>).getReader();
  let onAbort: (() => void) | undefined;
  const aborted = signal
    ? new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      })
    : undefined;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await (aborted ? Promise.race([reader.read(), aborted]) : reader.read());
      if (done) {
        return hash.digest("hex");
      }
      hash.update(value);
    }
  } catch (error) {
    // Stop the transfer; the read already failed, so a cancel failure adds nothing and must not replace the cause.
    reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    if (onAbort) {
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

/**
 * Move a Media row from PENDING to READY (or FAILED) from what is actually
 * in the store. The row's own `storageKey`, `mimeType` and `maxBytes` are
 * the expectations; the blob is looked up by that pathname, never by a URL
 * from the client, and its first bytes must match the declared type.
 * Idempotent: READY rows return as they are (rows recorded before the byte
 * check are never re-read), FAILED rows return early (the cron's orphan
 * handling relies on that), a lost race against a concurrent writer re-reads
 * the row instead of throwing. A connector upload (`addedVia = ADMIN`) must
 * also arrive at exactly its declared size and, up to INLINE_HASH_MAX_BYTES,
 * match its declared SHA-256 before READY; its READY writes an ADMIN revision
 * (plan 2026-11-06-mcp-attach-media §8.3, D10). `signal` bounds that hash: when
 * it fires the row stays PENDING (`verifying`) with nothing written.
 */
export async function recordMedia({ mediaId, signal }: { mediaId: string; signal?: AbortSignal }): Promise<RecordMediaResult> {
  const db = getDb();
  const row = await db.media.findUnique({
    where: { id: mediaId },
    include: { memory: { select: { deletedAt: true } } },
  });
  if (!row || row.memory.deletedAt !== null) {
    return { status: "NOT_FOUND", mediaId };
  }
  if (row.status === "READY") {
    return { status: "READY", mediaId, memoryId: row.memoryId, sizeBytes: row.sizeBytes ?? 0 };
  }
  if (row.status === "FAILED") {
    return { status: "FAILED", mediaId, memoryId: row.memoryId, reason: "wrong_type" };
  }

  const storage = createStorageService();
  const head = await storage.head(row.storageKey);
  if (!head) {
    return { status: "PENDING", mediaId, memoryId: row.memoryId };
  }

  const tooLarge = head.size > row.maxBytes;
  const wrongType = head.contentType !== row.mimeType || !isAllowedMime(head.contentType);
  const reject = async (reason: "too_large" | "wrong_type" | "size_mismatch" | "checksum_mismatch", check: "size" | "label" | "bytes" | "checksum"): Promise<RecordMediaResult> => {
    await storage.del(row.storageKey);
    await transition(row, { status: "FAILED" });
    log.warn({ action: "reject", mediaId, memoryId: row.memoryId, reason, check, size: head.size }, "upload rejected");
    return { status: "FAILED", mediaId, memoryId: row.memoryId, reason };
  };
  if (tooLarge || wrongType) {
    return reject(tooLarge ? "too_large" : "wrong_type", tooLarge ? "size" : "label");
  }
  // The declared type is a claim made by the uploading client (the Blob token only pins it to the
  // ticket); the first bytes are the evidence (issue #45). Bounded read, never the file. Bytes of
  // another allowed type of the same kind relabel the row (a JPEG saved as .heic is still a photo).
  // Bytes nobody recognises make the row FAILED, never READY and never served, but the bytes are
  // KEPT: a verdict read from 128 bytes must not destroy a family's file (an AIFF named .wav, a
  // TIFF named .jpg). `blobUrl` records that they exist, so a later purge can find them.
  const keepUnrecognised = async (): Promise<RecordMediaResult> => {
    await transition(row, { status: "FAILED", blobUrl: head.url });
    log.warn({ action: "reject", mediaId, memoryId: row.memoryId, reason: "unrecognized_bytes", check: "bytes", size: head.size }, "upload not recognised; bytes kept");
    return { status: "FAILED", mediaId, memoryId: row.memoryId, reason: "unrecognized_bytes" };
  };
  if (head.size === 0) {
    // Nothing to look at, and a byte range on an empty object is a 416, not a prefix.
    return keepUnrecognised();
  }
  const prefix = await storage.readPrefix(row.storageKey, SIGNATURE_PREFIX_BYTES);
  if (!prefix) {
    return { status: "PENDING", mediaId, memoryId: row.memoryId };
  }
  const actualType = detectMediaType(row.mimeType, prefix);
  if (actualType === null) {
    return keepUnrecognised();
  }
  if (actualType !== row.mimeType) {
    log.info({ action: "relabel", mediaId, memoryId: row.memoryId, declared: row.mimeType, actual: actualType }, "upload relabelled from its bytes");
  }

  // A file attached through the MCP connector (plan 2026-11-06-mcp-attach-media §8.3, D3, D10): it was
  // reserved at exactly its declared size and carries the SHA-256 the session declared. Whoever completes
  // it (finalize_upload or cron step (a)) runs these checks, before READY. Above INLINE_HASH_MAX_BYTES the
  // hash cannot fit a request's budget; cron step (b) hashes it later and warns on a mismatch.
  let checksumSha256: string | undefined;
  if (row.addedVia === "ADMIN") {
    if (head.size !== row.maxBytes) {
      return reject("size_mismatch", "size");
    }
    if (head.size <= INLINE_HASH_MAX_BYTES) {
      let digest: string | null;
      try {
        digest = await hashStoredBlob(row.storageKey, signal);
      } catch (error) {
        if (isCallerAbort(error, signal)) {
          // Out of time, not wrong: nothing is written, and the next finalize or cron run hashes it again.
          log.info({ action: "hash_deferred", mediaId, memoryId: row.memoryId }, "connector upload hash did not finish before the deadline");
          return { status: "PENDING", mediaId, memoryId: row.memoryId, verifying: true };
        }
        throw error;
      }
      if (digest === null) {
        return { status: "PENDING", mediaId, memoryId: row.memoryId };
      }
      if (digest !== row.declaredSha256) {
        return reject("checksum_mismatch", "checksum");
      }
      checksumSha256 = digest;
    }
  }

  const updated = await transition(row, { status: "READY", sizeBytes: head.size, blobUrl: head.url, mimeType: actualType, ...(checksumSha256 !== undefined && { checksumSha256 }) });
  if (updated === "retired") {
    // The bytes are recorded (purge deletes them) but the file was cancelled or its target removed: not a live file.
    log.info({ action: "retired", mediaId, memoryId: row.memoryId }, "upload recorded for a retired replacement");
    return { status: "FAILED", mediaId, memoryId: row.memoryId, reason: "retired" };
  }
  if (updated === "lost_race") {
    // Another writer transitioned the row first; report what it decided.
    const current = await db.media.findUnique({ where: { id: mediaId } });
    if (!current || current.status === "PENDING") {
      return { status: "PENDING", mediaId, memoryId: row.memoryId };
    }
    return current.status === "READY"
      ? { status: "READY", mediaId, memoryId: row.memoryId, sizeBytes: current.sizeBytes ?? head.size }
      : { status: "FAILED", mediaId, memoryId: row.memoryId, reason: "wrong_type" };
  }
  log.info({ action: "ready", mediaId, memoryId: row.memoryId, sizeBytes: head.size }, "upload recorded");
  return { status: "READY", mediaId, memoryId: row.memoryId, sizeBytes: head.size };
}

/**
 * Conditional PENDING → next-state update inside a transaction that holds the
 * memory lock; P2025 (no row matched) means another writer got there first.
 * Also recomputes `Memory.type`, and when a replacement reaches READY retires
 * its target (or cancels itself if the target was removed meanwhile). A
 * connector upload (`addedVia = ADMIN`) reaching READY appends one ADMIN
 * revision of the memory's READY files in the same transaction (D10), so the
 * revision exists exactly once whoever wins: a lost race rolls back with it.
 */
async function transition(
  row: { id: string; memoryId: string; replacesMediaId: string | null; addedVia?: string | null },
  data: { status: "READY"; sizeBytes: number; blobUrl: string; mimeType: string; checksumSha256?: string } | { status: "FAILED"; blobUrl?: string }
): Promise<"done" | "lost_race" | "retired"> {
  try {
    return await getDb().$transaction(async (tx) => {
      await lockMemory(tx, row.memoryId);
      // Everything the swap and the type depend on is read after the lock, never from the pre-lock row.
      // A replacement that fails validation is retired at once so it never lingers on its target's card.
      const retireFailedReplacement = data.status === "FAILED" && row.replacesMediaId !== null;
      const adminReady = data.status === "READY" && row.addedVia === "ADMIN";
      const readyBefore = adminReady ? await readyLiveMediaIds(tx, row.memoryId, row.id) : [];
      const current = await tx.media.update({
        where: { id: row.id, status: "PENDING" },
        data: retireFailedReplacement ? { ...data, deletedAt: new Date() } : data,
      });
      const memory = await tx.memory.findUniqueOrThrow({ where: { id: row.memoryId }, select: { contributorNote: true, consentVersion: true } });
      let outcome: "done" | "retired" = "done";
      if (adminReady) {
        const readyAfter = await readyLiveMediaIds(tx, row.memoryId);
        await appendRevision(tx, { memoryId: row.memoryId, changedVia: "ADMIN", before: { readyMediaIds: readyBefore }, after: { readyMediaIds: readyAfter, addedMediaId: row.id }, consentVersion: memory.consentVersion });
      }
      if (data.status === "READY" && row.replacesMediaId !== null) {
        if (current.deletedAt !== null) {
          // Cancelled while the upload was in flight: recorded (so purge can delete the blob) but never swapped in.
          outcome = "retired";
        } else {
          const before = { mediaIds: await visibleMediaIds(tx, row.memoryId) };
          const now = new Date();
          const retired = await tx.media.updateMany({ where: { id: row.replacesMediaId, deletedAt: null }, data: { deletedAt: now } });
          if (retired.count === 1) {
            // The replacement takes the target's place; clearing the pointer makes it a visible file.
            await tx.media.update({ where: { id: row.id }, data: { replacesMediaId: null } });
            const after = { mediaIds: await visibleMediaIds(tx, row.memoryId) };
            await appendClaimRevision(tx, { memoryId: row.memoryId, before, after, consentVersion: memory.consentVersion });
          } else {
            // The target was removed while this upload ran: the replacement must not resurrect it.
            await tx.media.update({ where: { id: row.id }, data: { deletedAt: now } });
            log.info({ action: "replacement_cancelled", mediaId: row.id, memoryId: row.memoryId }, "replacement target already removed");
            outcome = "retired";
          }
        }
      }
      await recomputeMemoryType(tx, row.memoryId, memory.contributorNote);
      return outcome;
    }, TX_OPTIONS);
  } catch (error) {
    if (isPrismaCode(error, "P2025")) {
      return "lost_race";
    }
    throw error;
  }
}

/**
 * SHA-256 of a READY blob, streamed from the store; stored on the row. A
 * caller with a deadline passes `signal`; when it fires the read stops and
 * this rejects with its reason, storing nothing.
 */
export async function computeChecksum({ mediaId, signal }: { mediaId: string; signal?: AbortSignal }): Promise<string | null> {
  const db = getDb();
  const row = await db.media.findUnique({ where: { id: mediaId } });
  if (!row || row.status !== "READY") {
    return null;
  }
  if (row.checksumSha256) {
    return row.checksumSha256;
  }
  const digest = await hashStoredBlob(row.storageKey, signal);
  if (digest === null) {
    return null;
  }
  try {
    await db.media.update({ where: { id: mediaId }, data: { checksumSha256: digest } });
  } catch (error) {
    logError("checksum could not be stored", error, { category: "upload", mediaId });
  }
  return digest;
}

export type FinalizeResult =
  | { status: "READY" | "PENDING" | "FAILED"; claimLink: string; emailed: boolean }
  | { status: "REJECTED"; reason: "malformed" | "bad_signature" | "expired" | "not_found" };

/**
 * Follow-up work for a committed READY file. A caller's absolute deadline
 * leaves 3 s for the response/flush; derive needs at least 5 s, otherwise
 * cron step (g) backfills it. Choose its budget after the checksum finishes.
 * GPS chooses its budget when its own task starts; under 1 s, cron step (h)
 * backfills the undecided photo instead.
 */
export function scheduleReadyFollowUps({ mediaId, mimeType, sizeBytes, deadlineAt }: {
  mediaId: string;
  mimeType: string;
  sizeBytes: number;
  deadlineAt?: number;
}): void {
  afterWithFlush("finalize.checksum_and_derive", async () => {
    if (sizeBytes <= INLINE_HASH_MAX_BYTES) {
      await computeChecksum({ mediaId });
    }
    const deadlineMs = deadlineAt === undefined
      ? DERIVE_DEADLINE_FINALIZE_MS
      : Math.min(DERIVE_DEADLINE_FINALIZE_MS, deadlineAt - Date.now() - 3_000);
    if (deadlineMs >= 5_000) {
      await deriveMedia({ mediaId, deadlineMs });
    }
  });
  // A photo's GPS, read from the original in a task of its own: never through the derived copies, which are
  // stripped (plan 2026-11-06-photo-gps-places B3). Photos only (the ticket's type; recordMedia relabels only within
  // a kind), so a video or a voice note schedules nothing (final review, item 4); cron step (h) retries.
  if (mimeType.startsWith("image/")) {
    afterWithFlush("finalize.photo_gps", async () => {
      if (deadlineAt === undefined) {
        await extractPhotoGps({ mediaId });
        return;
      }
      const deadlineMs = Math.min(GPS_READ_DEADLINE_MS, deadlineAt - Date.now() - 3_000);
      if (deadlineMs >= 1_000) {
        await extractPhotoGps({ mediaId, deadlineMs });
      }
    });
  }
}

/**
 * Called by the browser after `upload()` resolves. Verifies the ticket and
 * that the claim token belongs to the ticket's memory, records the media
 * from `head()`, and, for files small enough to hash inside the page's
 * `maxDuration`, computes the checksum in `after()`. Larger files are hashed
 * by the reconcile cron. Task 8 adds the confirmation email here.
 */
export async function finalizeUpload({
  ticket,
  claimToken,
}: {
  ticket: UploadTicket;
  claimToken: string;
}): Promise<FinalizeResult> {
  // The expiry bounds the token exchange, not this step: a 500 MB upload can
  // take longer than 15 minutes and the claim token (checked below) is the
  // authority here. The signature still has to match.
  const verified = verifyUploadTicket(ticket, { ignoreExpiry: true });
  if (!verified.ok) {
    return { status: "REJECTED", reason: verified.reason };
  }
  const memory = await getDb().memory.findUnique({ where: { claimTokenHash: hashClaimToken(claimToken) } });
  if (!memory || memory.deletedAt !== null || memory.id !== verified.claims.memoryId) {
    return { status: "REJECTED", reason: "not_found" };
  }
  tagIds({ memoryId: memory.id, mediaId: verified.claims.mediaId });
  const outcome = await recordMedia({ mediaId: verified.claims.mediaId });
  if (outcome.status === "NOT_FOUND") {
    return { status: "REJECTED", reason: "not_found" };
  }
  uploadFinalized(outcome.status);
  let emailed = false;
  if (outcome.status === "READY") {
    // A memory sent with others is confirmed and announced by completeSubmission,
    // once every file of the send has landed (Task 15, D18); never per file here.
    if (memory.submissionId === null) {
      emailed = await confirmQuietly(memory.id, claimToken);
      // After the response: the admin alert, then the checksum (small files) and
      // the web copy and thumbnail (photos; other kinds return not_eligible at once).
      afterWithFlush("finalize.admin_alert", async () => {
        await notifyAdminsQuietly(memory.id);
      });
    }
    scheduleReadyFollowUps({ mediaId: outcome.mediaId, mimeType: verified.claims.mimeType, sizeBytes: outcome.sizeBytes });
  }
  return { status: outcome.status, claimLink: `${getSiteUrl()}/m/${claimToken}`, emailed };
}

/**
 * The save is already committed; an email problem must never turn it into an
 * error for the contributor. Failures are reported and left to the cron.
 */
export async function confirmQuietly(memoryId: string, claimToken: string): Promise<boolean> {
  try {
    return (await confirmMemory({ memoryId, claimToken })).sent;
  } catch (error) {
    await logErrorAndFlush("confirmation email failed after save", error, { category: "email", memoryId });
    return false;
  }
}

/** Same contract for the family-admin alert: reported, never thrown, left to the cron on failure. */
export async function notifyAdminsQuietly(memoryId: string, options: { settleNow?: boolean } = {}): Promise<boolean> {
  try {
    return (await notifyAdminsOfMemory({ memoryId, ...options })).sent;
  } catch (error) {
    await logErrorAndFlush("admin alert failed after save", error, { category: "email", memoryId });
    return false;
  }
}
