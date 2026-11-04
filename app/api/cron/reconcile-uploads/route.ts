import { type NextRequest, NextResponse } from "next/server";

import { confirmMemory } from "@/features/memories/confirm";
import { DERIVED_KINDS, deriveMedia, MAX_DECODE_ATTEMPTS, MAX_PIXELS, STALE_CLAIM_MS } from "@/features/memories/derive-media";
import { computeChecksum, recordMedia } from "@/features/memories/ingest-upload";
import { safeEqualHex } from "@/lib/claim-token";
import { posterStagingKeyFor } from "@/lib/derived-keys";
import { createLogger, logError } from "@/lib/logger";
import { storagePrefix } from "@/lib/site-url";
import { getCronEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { createStorageService } from "@/services/storage";

export const maxDuration = 60;

const log = createLogger({ category: "cron" });

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const CHECKSUM_BATCH = 20;
/** Shared budget for every step; the function's maxDuration is 60 s. */
const RUN_DEADLINE_MS = 50_000;
/** Step (b) stops starting new files after this. */
const CHECKSUM_DEADLINE_MS = 40_000;
/** Step (e) leaves very new memories to the request path (finalize may still be running). */
const CONFIRM_MIN_AGE_MS = 30 * MINUTE_MS;
const EMAIL_MAX_ATTEMPTS = 5;
const EVENT_MAX_ATTEMPTS = 3;
/** A cancelled reservation may still receive bytes until its Blob client token (1 h) expires; purge it after that plus a margin. */
const CANCELLED_RESERVATION_GRACE_MS = 75 * MINUTE_MS;
/** Step (g): a few photos per run, each decode bounded; the shared run deadline still applies. */
const DERIVE_BATCH = 3;
const DERIVE_DEADLINE_MS = 30_000;

interface Counts {
  pendingRechecked: number;
  orphansFailed: number;
  checksumsComputed: number;
  eventsReplayed: number;
  emailsRetried: number;
  confirmationsSent: number;
  deletedBlobsRemoved: number;
  derived: number;
  errors: number;
}

/**
 * Reconcile job (every 10 minutes on Vercel Cron). Every step is idempotent
 * because cron delivery can duplicate or skip runs and Vercel never retries.
 */
export async function GET(request: NextRequest): Promise<Response> {
  // Request-time read first so Cache Components never prerenders a static
  // error body for a build that has no secret; then fail closed.
  const authorization = request.headers.get("authorization") ?? "";
  const secret = getCronEnv().CRON_SECRET;
  if (!secret || !safeEqualHex(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
  }

  const counts: Counts = {
    pendingRechecked: 0,
    orphansFailed: 0,
    checksumsComputed: 0,
    eventsReplayed: 0,
    emailsRetried: 0,
    confirmationsSent: 0,
    deletedBlobsRemoved: 0,
    derived: 0,
    errors: 0,
  };
  const db = getDb();
  const now = Date.now();

  // (a) PENDING media older than an hour: re-record; after 24 h with no blob, give up.
  const outOfTime = (): boolean => Date.now() - now > RUN_DEADLINE_MS;
  const stale = await db.media.findMany({
    where: { status: "PENDING", deletedAt: null, createdAt: { lt: new Date(now - HOUR_MS) }, memory: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  for (const row of stale) {
    if (outOfTime()) {
      break;
    }
    try {
      const outcome = await recordMedia({ mediaId: row.id });
      counts.pendingRechecked += 1;
      if (outcome.status === "PENDING" && row.createdAt.getTime() < now - 24 * HOUR_MS) {
        await db.media.update({ where: { id: row.id }, data: { status: "FAILED" } });
        counts.orphansFailed += 1;
      }
    } catch (error) {
      counts.errors += 1;
      logError("reconcile: recordMedia failed", error, { category: "cron", mediaId: row.id });
    }
  }

  // (c) Upload-completed events that never finished processing.
  const events = await db.webhookEvent.findMany({
    where: { processedAt: null, attempts: { lt: EVENT_MAX_ATTEMPTS } },
    orderBy: { receivedAt: "asc" },
    take: 50,
  });
  for (const event of events) {
    if (outOfTime()) {
      break;
    }
    const attempts = event.attempts + 1;
    try {
      const mediaId = mediaIdFromPayload(event.payload);
      if (!mediaId) {
        throw new Error("event has no mediaId");
      }
      const outcome = await recordMedia({ mediaId });
      await db.webhookEvent.update({
        where: { id: event.id },
        data: outcome.status === "PENDING" ? { attempts, error: "blob not visible yet" } : { processedAt: new Date(), attempts, error: null },
      });
      counts.eventsReplayed += 1;
    } catch (error) {
      counts.errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      await db.webhookEvent.update({ where: { id: event.id }, data: { attempts, error: message.slice(0, 1000) } });
      if (attempts >= EVENT_MAX_ATTEMPTS) {
        logError("reconcile: webhook event abandoned", error, { category: "cron", eventId: event.id });
      }
    }
  }

  // (d) Emails that failed (with retries left and due) or stalled in PENDING.
  // A memory whose submission lease is open is still receiving files; its one
  // email waits (confirmMemory would answer `leased` anyway).
  const leaseClosed = { OR: [{ uploadLeaseUntil: null }, { uploadLeaseUntil: { lt: new Date(now) } }] };
  const retryable = await db.emailLog.findMany({
    where: {
      memory: { deletedAt: null, ...leaseClosed },
      OR: [
        { status: "FAILED", attempts: { lt: EMAIL_MAX_ATTEMPTS }, nextAttemptAt: { lte: new Date(now) } },
        { status: "PENDING", createdAt: { lt: new Date(now - 15 * MINUTE_MS) } },
        // A claim abandoned by a crashed function; the email service reclaims it.
        { status: "SENDING", updatedAt: { lt: new Date(now - 15 * MINUTE_MS) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  for (const row of retryable) {
    if (outOfTime()) {
      break;
    }
    try {
      const result = await confirmMemory({ memoryId: row.memoryId });
      if (result.sent) {
        counts.emailsRetried += 1;
      }
    } catch (error) {
      counts.errors += 1;
      logError("reconcile: email retry failed", error, { category: "cron", memoryId: row.memoryId });
    }
  }

  // (e) Memories with an address and something READY (or TEXT) that were never
  // emailed and are old enough that no request-path confirm is still running.
  const unconfirmed = await db.memory.findMany({
    where: {
      deletedAt: null,
      createdAt: { lt: new Date(now - CONFIRM_MIN_AGE_MS) },
      contributor: { email: { not: null } },
      emails: { none: {} },
      AND: [leaseClosed, { OR: [{ type: "TEXT" }, { contributorNote: { not: null } }, { media: { some: { status: "READY", deletedAt: null } } }] }],
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  for (const memory of unconfirmed) {
    if (outOfTime()) {
      break;
    }
    try {
      const result = await confirmMemory({ memoryId: memory.id });
      if (result.sent) {
        counts.confirmationsSent += 1;
      }
    } catch (error) {
      counts.errors += 1;
      logError("reconcile: confirmation failed", error, { category: "cron", memoryId: memory.id });
    }
  }

  // (b) READY media without a checksum, oldest first, bounded per run and by
  // the deadline; it runs after the email steps so a backlog of large files
  // never starves them.
  const unhashed = await db.media.findMany({
    where: { status: "READY", deletedAt: null, checksumSha256: null, memory: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    take: CHECKSUM_BATCH,
  });
  for (const row of unhashed) {
    if (Date.now() - now > CHECKSUM_DEADLINE_MS || outOfTime()) {
      break;
    }
    try {
      if (await computeChecksum({ mediaId: row.id })) {
        counts.checksumsComputed += 1;
      }
    } catch (error) {
      counts.errors += 1;
      logError("reconcile: checksum failed", error, { category: "cron", mediaId: row.id });
    }
  }

  // (f) Purge: blobs of soft-deleted memories and of files removed through the
  // claim page, only those this environment uploaded (preview/dev Neon branches
  // hold copies of production rows and share the store). Only rows with a blob
  // still recorded are selected, so a purged row is never re-selected.
  // Only rows with outstanding work are selected (a recorded blob, or derived
  // copies that are not a fresh in-flight claim), so a purged row is never
  // re-selected and a worker is never raced for a key it is still writing.
  const staleClaimBefore = new Date(now - STALE_CLAIM_MS);
  const orphanedBlobs = await db.media.findMany({
    where: {
      // A cancelled file's Blob token may still be valid; wait for it to expire so the freed pathname cannot be refilled.
      OR: [
        { memory: { deletedAt: { not: null } } },
        { deletedAt: { not: null }, createdAt: { lt: new Date(now - CANCELLED_RESERVATION_GRACE_MS) } },
      ],
      AND: [
        {
          OR: [
            { blobUrl: { not: null } },
            { derivatives: { some: { status: { not: "PENDING" } } } },
            { derivatives: { some: { status: "PENDING", OR: [{ claimedAt: null }, { claimedAt: { lt: staleClaimBefore } }] } } },
          ],
        },
      ],
      storageKey: { startsWith: storagePrefix() },
    },
    include: { derivatives: { select: { id: true, status: true, claimedAt: true, storageKey: true } } },
    orderBy: { id: "asc" },
    take: 50,
  });
  const storage = createStorageService();
  for (const row of orphanedBlobs) {
    if (outOfTime()) {
      break;
    }
    try {
      if (row.blobUrl !== null) {
        await storage.del(row.storageKey);
      }
      // Derived copies (not a fresh claim: that worker deletes its own candidate) and the poster staging pathname.
      const copies = row.derivatives.filter((d) => d.status !== "PENDING" || d.claimedAt === null || d.claimedAt < staleClaimBefore);
      for (const copy of copies) {
        await storage.del(copy.storageKey);
      }
      if (row.mimeType.startsWith("video/")) {
        await storage.del(posterStagingKeyFor(row.storageKey));
      }
      if (copies.length > 0) {
        await db.derivedMedia.deleteMany({ where: { mediaId: row.id, storageKey: { in: copies.map((c) => c.storageKey) } } });
      }
      await db.media.update({ where: { id: row.id }, data: { blobUrl: null } });
      counts.deletedBlobsRemoved += 1;
    } catch (error) {
      counts.errors += 1;
      logError("reconcile: blob deletion failed", error, { category: "cron", mediaId: row.id });
    }
  }

  // (f2) Reservations cancelled on the claim page whose upload might have landed
  // without a callback or finalize: once the Blob token has expired, delete the
  // pathname (idempotent) and mark the row FAILED so it is never selected again.
  const cancelled = await db.media.findMany({
    where: {
      status: "PENDING",
      deletedAt: { not: null },
      createdAt: { lt: new Date(now - CANCELLED_RESERVATION_GRACE_MS) },
      storageKey: { startsWith: storagePrefix() },
    },
    orderBy: { id: "asc" },
    take: 50,
  });
  for (const row of cancelled) {
    if (outOfTime()) {
      break;
    }
    try {
      await storage.del(row.storageKey);
      await db.media.update({ where: { id: row.id }, data: { status: "FAILED", blobUrl: null } });
      counts.deletedBlobsRemoved += 1;
    } catch (error) {
      counts.errors += 1;
      logError("reconcile: cancelled reservation purge failed", error, { category: "cron", mediaId: row.id });
    }
  }

  // (g) Derived copies (web image + email thumbnail) for READY photos of this
  // environment that have none, a stale claim, or a retryable failure. This is
  // the backfill for photos stored before the pipeline existed and the retry
  // path for finalize/callback runs that died. Same eligibility as deriveMedia.
  const candidates = await db.media.findMany({
    where: {
      status: "READY",
      deletedAt: null,
      mimeType: { startsWith: "image/" },
      storageKey: { startsWith: storagePrefix() },
      memory: { deletedAt: null },
      OR: [
        { derivatives: { none: { kind: "WEB_IMAGE" } } },
        { derivatives: { none: { kind: "THUMBNAIL" } } },
        // Stale claims (a null claimedAt is treated as stale; exhausted ones are retired by deriveMedia).
        { derivatives: { some: { kind: { in: [...DERIVED_KINDS] }, status: "PENDING", OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now - STALE_CLAIM_MS) } }] } } },
        { derivatives: { some: { kind: { in: [...DERIVED_KINDS] }, status: "FAILED", error: { in: ["decode_failed", "timeout"] }, attempts: { lt: MAX_DECODE_ATTEMPTS } } } },
        // A refusal made under a ceiling other than today's: one retry converges the row.
        { derivatives: { some: { kind: { in: [...DERIVED_KINDS] }, status: "FAILED", error: { startsWith: "too_many_pixels:", not: `too_many_pixels:${MAX_PIXELS}` } } } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: DERIVE_BATCH,
  });
  const deriveStart = Date.now();
  for (const row of candidates) {
    // Each candidate gets only what is left of the step and of the run, never a fresh budget.
    const remainingMs = Math.min(DERIVE_DEADLINE_MS - (Date.now() - deriveStart), RUN_DEADLINE_MS - (Date.now() - now));
    if (remainingMs <= 0) {
      break;
    }
    try {
      const outcome = await deriveMedia({ mediaId: row.id, deadlineMs: remainingMs });
      if (Object.values(outcome).includes("derived")) {
        counts.derived += 1;
      }
    } catch (error) {
      counts.errors += 1;
      logError("reconcile: derive failed", error, { category: "cron", mediaId: row.id });
    }
  }

  log.info({ action: "reconcile", ...counts }, "reconcile run finished");
  return NextResponse.json({ success: true, data: counts });
}

function mediaIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const tokenPayload = (payload as { tokenPayload?: unknown }).tokenPayload;
  if (typeof tokenPayload !== "string") {
    return null;
  }
  try {
    const id = (JSON.parse(tokenPayload) as { mediaId?: unknown }).mediaId;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}
