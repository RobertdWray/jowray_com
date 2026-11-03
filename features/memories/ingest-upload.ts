import "server-only";

import { createHash } from "node:crypto";

import { confirmMemory } from "@/features/memories/confirm";
import { lockMemory } from "@/features/memories/lock";
import { recomputeMemoryType, visibleMediaIds } from "@/features/memories/media-state";
import { hashClaimToken } from "@/lib/claim-token";
import { createLogger, logError, logErrorAndFlush } from "@/lib/logger";
import { isAllowedMime } from "@/lib/media-types";
import { afterWithFlush } from "@/lib/sentry/after-flush";
import { getSiteUrl } from "@/lib/site-url";
import { type UploadTicket, verifyUploadTicket } from "@/lib/upload-ticket";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { createStorageService } from "@/services/storage";

const log = createLogger({ category: "upload" });
/** Neon computes can take a couple of seconds to wake; Prisma's defaults (2 s / 5 s) are too tight. */
const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/** Files at or under this size are hashed inline in `after()`; larger ones by the cron. */
export const INLINE_HASH_MAX_BYTES = 50 * 1024 * 1024;

export type RecordMediaResult =
  | { status: "READY"; mediaId: string; memoryId: string; sizeBytes: number }
  | { status: "PENDING"; mediaId: string; memoryId: string }
  | { status: "FAILED"; mediaId: string; memoryId: string; reason: "too_large" | "wrong_type" }
  | { status: "NOT_FOUND"; mediaId: string };

function isPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

/**
 * Move a Media row from PENDING to READY (or FAILED) from what is actually
 * in the store. The row's own `storageKey`, `mimeType` and `maxBytes` are
 * the expectations; the blob is looked up by that pathname, never by a URL
 * from the client. Idempotent: READY rows return as they are, a lost race
 * against a concurrent writer re-reads the row instead of throwing.
 */
export async function recordMedia({ mediaId }: { mediaId: string }): Promise<RecordMediaResult> {
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
  if (tooLarge || wrongType) {
    const reason = tooLarge ? "too_large" : "wrong_type";
    await storage.del(row.storageKey);
    await transition(row, { status: "FAILED" });
    log.warn({ action: "reject", mediaId, memoryId: row.memoryId, reason, size: head.size }, "upload rejected");
    return { status: "FAILED", mediaId, memoryId: row.memoryId, reason };
  }

  const updated = await transition(row, { status: "READY", sizeBytes: head.size, blobUrl: head.url });
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
 * its target (or cancels itself if the target was removed meanwhile).
 */
async function transition(
  row: { id: string; memoryId: string; replacesMediaId: string | null },
  data: { status: "READY"; sizeBytes: number; blobUrl: string } | { status: "FAILED" }
): Promise<"done" | "lost_race"> {
  try {
    await getDb().$transaction(async (tx) => {
      await lockMemory(tx, row.memoryId);
      // Everything the swap and the type depend on is read after the lock, never from the pre-lock row.
      const current = await tx.media.update({ where: { id: row.id, status: "PENDING" }, data });
      const memory = await tx.memory.findUniqueOrThrow({ where: { id: row.memoryId }, select: { contributorNote: true } });
      // A replacement cancelled while its upload was in flight is recorded (so purge can delete the blob) but never swaps in.
      if (data.status === "READY" && row.replacesMediaId !== null && current.deletedAt === null) {
        const before = { mediaIds: await visibleMediaIds(tx, row.memoryId) };
        const now = new Date();
        const retired = await tx.media.updateMany({ where: { id: row.replacesMediaId, deletedAt: null }, data: { deletedAt: now } });
        if (retired.count === 1) {
          // The replacement takes the target's place; clearing the pointer makes it a visible file.
          await tx.media.update({ where: { id: row.id }, data: { replacesMediaId: null } });
          const after = { mediaIds: await visibleMediaIds(tx, row.memoryId) };
          await tx.memoryRevision.create({
            data: { memoryId: row.memoryId, changedVia: "CLAIM_LINK", before: before as Prisma.InputJsonValue, after: after as Prisma.InputJsonValue },
          });
        } else {
          // The target was removed while this upload ran: the replacement must not resurrect it.
          await tx.media.update({ where: { id: row.id }, data: { deletedAt: now } });
          log.info({ action: "replacement_cancelled", mediaId: row.id, memoryId: row.memoryId }, "replacement target already removed");
        }
      }
      await recomputeMemoryType(tx, row.memoryId, memory.contributorNote);
    }, TX_OPTIONS);
    return "done";
  } catch (error) {
    if (isPrismaCode(error, "P2025")) {
      return "lost_race";
    }
    throw error;
  }
}

/** SHA-256 of a READY blob, streamed from the store; stored on the row. */
export async function computeChecksum({ mediaId }: { mediaId: string }): Promise<string | null> {
  const db = getDb();
  const row = await db.media.findUnique({ where: { id: mediaId } });
  if (!row || row.status !== "READY") {
    return null;
  }
  if (row.checksumSha256) {
    return row.checksumSha256;
  }
  const file = await createStorageService().get(row.storageKey);
  if (!file) {
    return null;
  }
  const hash = createHash("sha256");
  for await (const chunk of file.stream as unknown as AsyncIterable<Uint8Array>) {
    hash.update(chunk);
  }
  const digest = hash.digest("hex");
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
  const outcome = await recordMedia({ mediaId: verified.claims.mediaId });
  if (outcome.status === "NOT_FOUND") {
    return { status: "REJECTED", reason: "not_found" };
  }
  let emailed = false;
  if (outcome.status === "READY") {
    emailed = await confirmQuietly(memory.id, claimToken);
    if (outcome.sizeBytes <= INLINE_HASH_MAX_BYTES) {
      afterWithFlush(async () => {
        await computeChecksum({ mediaId: outcome.mediaId });
      });
    }
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
