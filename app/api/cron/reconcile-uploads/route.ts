import { type NextRequest, NextResponse } from "next/server";

import { confirmMemory } from "@/features/memories/confirm";
import { computeChecksum, recordMedia } from "@/features/memories/ingest-upload";
import { safeEqualHex } from "@/lib/claim-token";
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

interface Counts {
  pendingRechecked: number;
  orphansFailed: number;
  checksumsComputed: number;
  eventsReplayed: number;
  emailsRetried: number;
  confirmationsSent: number;
  deletedBlobsRemoved: number;
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
  const retryable = await db.emailLog.findMany({
    where: {
      memory: { deletedAt: null },
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
      OR: [{ type: "TEXT" }, { contributorNote: { not: null } }, { media: { some: { status: "READY", deletedAt: null } } }],
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
  const orphanedBlobs = await db.media.findMany({
    where: {
      OR: [{ memory: { deletedAt: { not: null } } }, { deletedAt: { not: null } }],
      blobUrl: { not: null },
      storageKey: { startsWith: storagePrefix() },
    },
    orderBy: { id: "asc" },
    take: 50,
  });
  const storage = createStorageService();
  for (const row of orphanedBlobs) {
    if (outOfTime()) {
      break;
    }
    try {
      await storage.del(row.storageKey);
      await db.media.update({ where: { id: row.id }, data: { blobUrl: null } });
      counts.deletedBlobsRemoved += 1;
    } catch (error) {
      counts.errors += 1;
      logError("reconcile: blob deletion failed", error, { category: "cron", mediaId: row.id });
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
