import "server-only";

import { extractPhotoGps } from "@/features/media/extract-photo-gps";
import { reservePendingMedia, resolveFile, TX_OPTIONS } from "@/features/memories/create-memory";
import { derivePoster } from "@/features/memories/derive-poster";
import { recordMedia, scheduleReadyFollowUps, type FailedReason } from "@/features/memories/ingest-upload";
import { renewPendingReservation } from "@/features/memories/issue-upload-ticket";
import { BudgetBusyError, lockMemory, type Tx } from "@/features/memories/lock";
import { hasWords, type MemoryType } from "@/features/memories/media-state";
import { renewUploadLease } from "@/features/memories/upload-lease";
import type { Memory } from "@/generated/prisma/client";
import { createLogger } from "@/lib/logger";
import { hasLocationReader } from "@/lib/media-location";
import { memoryTypeFor } from "@/lib/media-types";
import { afterWithFlush } from "@/lib/sentry/after-flush";
import { tagIds } from "@/lib/sentry/user";
import { BLOB_TOKEN_LIFETIME_MS, TICKET_TTL_MS } from "@/lib/upload-ticket";
import { adminFinalizeUploadSchema, adminRequestUploadSchema } from "@/lib/validations/admin";
import { getDb } from "@/server/db/client";
import { createStorageService } from "@/services/storage";

const log = createLogger({ category: "upload" });
const RESERVATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type RequestRefusal =
  | { ok: false; code: "invalid" | "not_found" | "not_ready" | "unsupported_type" | "too_large" | "too_many_files" | "budget_exceeded" }
  | { ok: false; code: "conflict"; mediaId: string };
type AlreadyAttached = { ok: true; status: "READY"; mediaId: string; alreadyAttached: true; metadataIgnored?: true };
export type RequestUploadResult = RequestRefusal | AlreadyAttached
  | { ok: true; status: "PENDING"; mediaId: string; uploaded: true }
  | { ok: true; status: "PENDING"; mediaId: string; upload: { method: "PUT"; presignedUrl: string; headers: Record<string, string>; expiresAt: Date } };
type Reservation = { ok: true; status: "PENDING"; mediaId: string; storageKey: string; mimeType: string; now: number; reused: boolean };

/** D7: an admin file must not be what first makes a shared memory eligible for confirmation. */
async function acceptsUpload(tx: Tx, memory: Memory | null): Promise<"not_found" | "not_ready" | null> {
  if (!memory || memory.deletedAt !== null) { return "not_found"; }
  if (memory.status === "DRAFT" || memory.type === "TEXT" || hasWords(memory.contributorNote)) { return null; }
  const ready = await tx.media.findFirst({ where: { memoryId: memory.id, status: "READY", deletedAt: null }, select: { id: true } });
  return ready ? null : "not_ready";
}

/**
 * Reserve by file identity under lease → memory → budget locks, in one transaction.
 * READY identity uses the verified checksum first and the actual size (a site upload's
 * maxBytes is a kind ceiling). Storage calls happen only after commit. A lost response
 * or presign failure is retried by the same declared hash, without a second row.
 */
export async function requestUploadAsAdmin(raw: unknown): Promise<RequestUploadResult> {
  const parsed = adminRequestUploadSchema.safeParse(raw);
  if (!parsed.success) { return { ok: false, code: "invalid" }; }
  const { memoryId, file: declared, caption, approxDateText, place, durationSeconds } = parsed.data;
  const file = resolveFile({ ...declared, caption, approxDateText, place, durationSeconds });
  if (typeof file === "string") { return { ok: false, code: file }; }
  const metadataIgnored = caption !== undefined || approxDateText !== undefined || place !== undefined || durationSeconds !== undefined;
  let result: RequestRefusal | AlreadyAttached | Reservation;
  try {
    result = await getDb().$transaction(async (tx): Promise<RequestRefusal | AlreadyAttached | Reservation> => {
      const memory = await tx.memory.findUnique({ where: { id: memoryId } });
      const refusal = await acceptsUpload(tx, memory);
      if (refusal) { return { ok: false, code: refusal }; }
      // acceptsUpload established the row; keep the guard explicit for type narrowing.
      if (!memory) { return { ok: false, code: "not_found" }; }
      await renewUploadLease(tx, memory);
      await lockMemory(tx, memoryId);
      // A delete or Share may have won while we waited for the lock.
      const freshRefusal = await acceptsUpload(tx, await tx.memory.findUnique({ where: { id: memoryId } }));
      if (freshRefusal) { return { ok: false, code: freshRefusal }; }
      const ready = await tx.media.findFirst({
        where: { memoryId, deletedAt: null, status: "READY", OR: [
          { checksumSha256: declared.sha256 },
          { checksumSha256: null, declaredSha256: declared.sha256 },
        ] },
      });
      if (ready) {
        if (ready.sizeBytes !== declared.size || memoryTypeFor(ready.mimeType) !== memoryTypeFor(file.mimeType)) {
          return { ok: false, code: "conflict", mediaId: ready.id };
        }
        return { ok: true, status: "READY", mediaId: ready.id, alreadyAttached: true, ...(metadataIgnored && { metadataIgnored: true }) };
      }
      const pending = await tx.media.findFirst({
        where: { memoryId, deletedAt: null, status: "PENDING", declaredSha256: declared.sha256, createdAt: { gt: new Date(Date.now() - RESERVATION_MAX_AGE_MS) } },
      });
      if (pending) {
        if (pending.maxBytes !== declared.size || memoryTypeFor(pending.mimeType) !== memoryTypeFor(file.mimeType)) {
          return { ok: false, code: "conflict", mediaId: pending.id };
        }
        const renewed = await renewPendingReservation(tx, pending);
        if (renewed === "budget_exceeded") { return { ok: false, code: "budget_exceeded" }; }
        if (renewed === "not_pending") { return { ok: false, code: "conflict", mediaId: pending.id }; }
        if (renewed !== "expired") {
          // Do not change the words when renewal is refused. The existing pathname and type stay pinned.
          await tx.media.update({ where: { id: pending.id }, data: { caption: file.caption, approxDateText: file.approxDateText, place: file.place, durationSeconds: file.durationSeconds } });
          return { ok: true, status: "PENDING", mediaId: pending.id, storageKey: renewed.row.storageKey, mimeType: renewed.row.mimeType, now: renewed.now, reused: true };
        }
        // The 24-hour boundary passed while waiting on the budget lock: this is now a new reservation.
      }
      const grant = await reservePendingMedia(tx, { memoryId, file, maxBytes: declared.size, addedVia: "ADMIN", declaredSha256: declared.sha256 });
      if (typeof grant === "string") { return { ok: false, code: grant }; }
      return { ok: true, status: "PENDING", mediaId: grant.ticket.mediaId, storageKey: grant.pathname, mimeType: file.mimeType, now: grant.ticket.expiresAt - TICKET_TTL_MS, reused: false };
    }, TX_OPTIONS);
  } catch (error) {
    if (!(error instanceof BudgetBusyError)) { throw error; }
    return { ok: false, code: "budget_exceeded" };
  }
  if (!result.ok) { return result; }
  tagIds({ memoryId, mediaId: result.mediaId });
  log.info({ action: "admin_upload_requested", memoryId, mediaId: result.mediaId }, "admin upload requested");
  if (result.status === "READY") { return result; }
  const storage = createStorageService();
  if (result.reused && await storage.head(result.storageKey)) {
    return { ok: true, status: "PENDING", mediaId: result.mediaId, uploaded: true };
  }
  const signed = await storage.presignPut({ pathname: result.storageKey, contentType: result.mimeType, maxBytes: declared.size, validUntil: result.now + BLOB_TOKEN_LIFETIME_MS, signal: AbortSignal.timeout(15_000) });
  return { ok: true, status: "PENDING", mediaId: result.mediaId, upload: { method: "PUT", presignedUrl: signed.url, headers: signed.headers, expiresAt: signed.expiresAt } };
}

type Gps = "found" | "none" | "pending" | "not_applicable";
export type FinalizeAdminUploadResult =
  | { ok: false; code: "invalid" | "not_found" }
  | { ok: true; status: "PENDING"; uploaded: boolean; verifying?: true }
  | { ok: true; status: "FAILED"; reason?: FailedReason }
  | { ok: true; status: "READY"; mediaId: string; memoryType: MemoryType; gps: Gps };

function decidedGps(row: { gpsCheckedAt: Date | null; latitude: number | null; longitude: number | null }): "found" | "none" | "pending" {
  if (row.gpsCheckedAt === null) { return "pending"; }
  return row.latitude !== null && row.longitude !== null ? "found" : "none";
}

/** Complete through the cron's shared path. Never confirm, notify, or change consent/status. */
export async function finalizeUploadAsAdmin(raw: unknown): Promise<FinalizeAdminUploadResult> {
  const deadlineAt = Date.now() + 25_000;
  const parsed = adminFinalizeUploadSchema.safeParse(raw);
  if (!parsed.success) { return { ok: false, code: "invalid" }; }
  const { memoryId, mediaId } = parsed.data;
  const db = getDb();
  const row = await db.media.findUnique({ where: { id: mediaId }, include: { memory: true } });
  if (!row || row.memoryId !== memoryId || row.addedVia !== "ADMIN" || row.deletedAt !== null || row.memory.deletedAt !== null) {
    return { ok: false, code: "not_found" };
  }
  tagIds({ memoryId, mediaId });
  // Even an exhausted call can read an already READY result. Abort synchronously
  // when there is no hash budget: timeout(0) would still allow a download to start.
  const hashBudget = Math.min(15_000, deadlineAt - Date.now() - 5_000);
  const signal = hashBudget <= 0
    ? AbortSignal.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"))
    : AbortSignal.timeout(hashBudget);
  const outcome = await recordMedia({ mediaId, signal });
  if (outcome.status === "NOT_FOUND") { return { ok: false, code: "not_found" }; }
  if (outcome.status === "FAILED") {
    // The reason is not durable; recordMedia's legacy early return invents wrong_type on repeats.
    return { ok: true, status: "FAILED", ...(row.status !== "FAILED" && { reason: outcome.reason }) };
  }
  if (outcome.status === "PENDING") {
    let uploaded = outcome.verifying === true;
    const remaining = deadlineAt - Date.now();
    if (!uploaded && remaining > 0) {
      const headSignal = AbortSignal.timeout(remaining);
      try {
        uploaded = await createStorageService().head(row.storageKey, { signal: headSignal }) !== null;
      } catch (error) {
        if (!(headSignal.aborted && (error === headSignal.reason || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))))) {
          throw error;
        }
        // Unknown after a timeout: request_upload can re-check the committed row's blob.
      }
    }
    return { ok: true, status: "PENDING", uploaded, ...(outcome.verifying && { verifying: true }) };
  }
  const ready = await db.media.findUnique({ where: { id: mediaId }, include: { memory: true } });
  if (!ready || ready.deletedAt !== null || ready.memory.deletedAt !== null) { return { ok: false, code: "not_found" }; }
  let gps: Gps = "not_applicable";
  if (hasLocationReader(ready.mimeType)) {
    gps = decidedGps(ready);
    const deadlineMs = Math.min(5_000, deadlineAt - Date.now() - 3_000);
    if (gps === "pending" && deadlineMs > 0) {
      const extracted = await extractPhotoGps({ mediaId, deadlineMs });
      if (extracted === "found") { gps = "found"; }
      else if (extracted === "absent") { gps = "none"; }
      else {
        // A concurrent extractor, or a lost response after its stamp, may have decided already.
        const current = await db.media.findUnique({ where: { id: mediaId } });
        if (current) { gps = decidedGps(current); }
      }
    }
  }
  // Repeated finalize calls only report the durable result; cron backfills any missed follow-ups.
  if (row.status !== "READY") {
    scheduleReadyFollowUps({ mediaId, mimeType: ready.mimeType, sizeBytes: outcome.sizeBytes, deadlineAt });
    // A video's poster, scheduled here and never in scheduleReadyFollowUps: the contributor pages import that, and the
    // ffmpeg binary must stay out of them (video-posters plan D1, ruling R2). Only `/api/mcp` imports this module. The
    // task gets what is left of this call's deadline when it runs, after the hash and the inline GPS read; derivePoster
    // defers below its own floor, and cron (g2) backstops a deferral or a retryable failure.
    if (ready.mimeType.startsWith("video/")) {
      afterWithFlush("mcp.finalize.poster", async () => {
        await derivePoster({ mediaId, deadlineMs: deadlineAt - Date.now() });
      });
    }
  }
  return { ok: true, status: "READY", mediaId, memoryType: ready.memory.type, gps };
}
