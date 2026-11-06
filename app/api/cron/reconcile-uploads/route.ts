import * as Sentry from "@sentry/nextjs";
import { type NextRequest, NextResponse } from "next/server";

import { extractPhotoGps, GPS_READ_DEADLINE_MS, GPS_STALE_CLAIM_MS, MAX_GPS_ATTEMPTS, type PhotoGpsOutcome } from "@/features/media/extract-photo-gps";
import { confirmSubmission } from "@/features/memories/complete-submission";
import { confirmMemory } from "@/features/memories/confirm";
import { DERIVED_KINDS, deriveMedia, MAX_DECODE_ATTEMPTS, MAX_PIXELS, STALE_CLAIM_MS } from "@/features/memories/derive-media";
import { TX_OPTIONS } from "@/features/memories/create-memory";
import { computeChecksum, recordMedia } from "@/features/memories/ingest-upload";
import { lockMemory } from "@/features/memories/lock";
import { ADMIN_ALERT_SINCE, notifyAdminsOfMemory } from "@/features/memories/notify-admins";
import { ADMIN_ALERT_WHERE, SITE_EMAIL_WHERE } from "@/features/memories/site-email";
import { safeEqualHex } from "@/lib/claim-token";
import { posterStagingKeyFor } from "@/lib/derived-keys";
import { createLogger, logError } from "@/lib/logger";
import { reconcileRun } from "@/lib/sentry/metrics";
import { storagePrefix } from "@/lib/site-url";
import { UPLOAD_WINDOW_MS } from "@/lib/upload-ticket";
import { getCronEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { createStorageService } from "@/services/storage";

export const maxDuration = 60;

const log = createLogger({ category: "cron" });

/** The schedule vercel.json runs this on; `__tests__/api/reconcile.test.ts` pins the two together. */
export const RECONCILE_SCHEDULE = "*/10 * * * *";
const MONITOR_SLUG = "reconcile-uploads";
/**
 * Sentry cron monitor (plan 2026-11-04 §8.8), created from code with the
 * first check-in. Explicit check-ins rather than `withMonitor`, which answers
 * `ok` whenever the callback resolves while this job swallows per-item
 * failures into `counts.errors`: here `error` means any item failed, the run
 * threw, or it overran `maxRuntime`. Production only: previews and manual
 * runs never create or miss a monitor.
 */
const MONITOR = {
  schedule: { type: "crontab", value: RECONCILE_SCHEDULE },
  checkinMargin: 5,
  maxRuntime: 2,
  timezone: "UTC",
  failureIssueThreshold: 2,
  recoveryThreshold: 1,
} as const;

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const CHECKSUM_BATCH = 20;
/** Shared budget for every step; the function's maxDuration is 60 s. */
const RUN_DEADLINE_MS = 50_000;
/** Step (b) stops starting new files after this. */
const CHECKSUM_DEADLINE_MS = 40_000;
/** Steps (e), (e2) and (e3) leave very new memories to the request path (finalize or completion may still be running). */
const CONFIRM_MIN_AGE_MS = 30 * MINUTE_MS;
/** Step (e3): sends of several memories whose receipt never went out; the lease check keeps it from racing an open browser. */
const SUBMISSION_BATCH = 10;
const EMAIL_MAX_ATTEMPTS = 5;
const EVENT_MAX_ATTEMPTS = 3;
/**
 * A reservation may still receive bytes until its ticket (15 min) and Blob client
 * token (1 h) have both expired. Rows record that moment as `reservedUntil` at
 * every mint (issue #44); this grace from `createdAt` is the fallback for rows
 * the old code wrote before the column existed.
 */
const CANCELLED_RESERVATION_GRACE_MS = UPLOAD_WINDOW_MS;
/** Step (a) gives up on a reservation this long after it was made, once its window has also closed. */
const RESERVATION_MAX_AGE_MS = 24 * HOUR_MS;
/**
 * Step (a0) keeps deleting the pathname of a row the cron retired for this long
 * after the claim: a Blob upload request that began before its token expired may
 * finish after it (the token is checked when each request starts), so one delete
 * at the window's end is not a guarantee. Every delete is idempotent (TCR #14).
 */
const LATE_ARRIVAL_SWEEP_MS = 2 * HOUR_MS;

/** True once no Blob token minted for the row can still land bytes (issue #44, Oscar #18). */
function uploadWindowClosed(row: { reservedUntil: Date | null; createdAt: Date }, now: number): boolean {
  return row.reservedUntil !== null ? row.reservedUntil.getTime() < now : row.createdAt.getTime() < now - CANCELLED_RESERVATION_GRACE_MS;
}
/** The same test as a `where` fragment. */
function uploadWindowClosedWhere(now: number): { OR: Array<{ reservedUntil: { lt: Date } } | { reservedUntil: null; createdAt: { lt: Date } }> } {
  return { OR: [{ reservedUntil: { lt: new Date(now) } }, { reservedUntil: null, createdAt: { lt: new Date(now - CANCELLED_RESERVATION_GRACE_MS) } }] };
}
/** Step (f): a memory deleted from the admin page keeps its files this long, so a Restore within 30 days brings everything back. */
const DELETED_MEMORY_GRACE_MS = 30 * 24 * HOUR_MS;
/** Step (g): a few photos per run, each decode bounded; the shared run deadline still applies. */
const DERIVE_BATCH = 3;
const DERIVE_DEADLINE_MS = 30_000;
/** Step (h): photos per run. On the 10-minute schedule that is about 60 an hour, which is also the backfill rate. */
const PHOTO_GPS_BATCH = 10;
/** What purge (f) writes over a photo's GPS: a purged photo keeps no location and no GPS claim (final review, item 5). */
const PURGED_GPS = { latitude: null, longitude: null, gpsClaimedAt: null } as const;
/** Step (h): the count each extraction outcome adds to. */
const GPS_COUNT: Record<PhotoGpsOutcome, "gpsFound" | "gpsAbsent" | "gpsFailed" | "gpsSkipped"> = {
  found: "gpsFound",
  absent: "gpsAbsent",
  failed: "gpsFailed",
  skipped: "gpsSkipped",
};

interface Counts {
  pendingRechecked: number;
  orphansFailed: number;
  checksumsComputed: number;
  eventsReplayed: number;
  emailsRetried: number;
  confirmationsSent: number;
  adminAlertsSent: number;
  submissionReceiptsSent: number;
  deletedBlobsRemoved: number;
  lateSweeps: number;
  derived: number;
  gpsFound: number;
  gpsAbsent: number;
  gpsFailed: number;
  gpsSkipped: number;
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

  const monitored = process.env.VERCEL_ENV === "production";
  const checkInId = monitored ? Sentry.captureCheckIn({ monitorSlug: MONITOR_SLUG, status: "in_progress" }, MONITOR) : null;
  const finish = (status: "ok" | "error"): void => {
    if (checkInId !== null) {
      Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status });
    }
  };
  try {
    const counts: Counts = {
      pendingRechecked: 0,
      orphansFailed: 0,
      checksumsComputed: 0,
      eventsReplayed: 0,
      emailsRetried: 0,
      confirmationsSent: 0,
      adminAlertsSent: 0,
      submissionReceiptsSent: 0,
      deletedBlobsRemoved: 0,
      lateSweeps: 0,
      derived: 0,
      gpsFound: 0,
      gpsAbsent: 0,
      gpsFailed: 0,
      gpsSkipped: 0,
      errors: 0,
    };
    const db = getDb();
    const storage = createStorageService();
    const now = Date.now();

    // (a) PENDING media older than an hour: re-record; after 24 h with no blob, give up,
    // but only once the row's upload window has closed, so no token can still land bytes
    // on a FAILED row (ingest ignores FAILED rows, and nothing would ever purge them;
    // issue #44, Oscar #18 / George #3). Claim first, delete second (step (f)'s durable
    // marker, TCR #1/#12): the conditional update to FAILED + purgedAt proves the row was
    // still PENDING with the window we read; only then is the pathname deleted (this
    // environment's blobs only). A finalize that landed after the head() check, or a
    // re-ticket that moved the window, makes the claim match nothing and nothing is
    // deleted. Step (a0) repeats the delete for a while in case a request that began
    // before the token expired finishes after it.
    const outOfTime = (): boolean => Date.now() - now > RUN_DEADLINE_MS;

    // (a0) Rows this environment retired in earlier runs ((a), (f2), or (f) with nothing
    // left to point at): delete their pathname again. A Blob request that started before
    // its token expired can finish after it, so a straggler may land after the first
    // delete; repeating the idempotent delete for LATE_ARRIVAL_SWEEP_MS bounds how long
    // such bytes can exist. A FAILED row can never serve again, so nothing of value is
    // lost. First in the run so a row retired by this run is swept from the next one on.
    const retired = await db.media.findMany({
      where: {
        status: "FAILED",
        blobUrl: null,
        purgedAt: { gt: new Date(now - LATE_ARRIVAL_SWEEP_MS) },
        storageKey: { startsWith: storagePrefix() },
      },
      select: { id: true, storageKey: true },
      orderBy: { id: "asc" },
      take: 100,
    });
    for (const row of retired) {
      if (outOfTime()) {
        break;
      }
      try {
        await storage.del(row.storageKey);
        counts.lateSweeps += 1;
      } catch (error) {
        counts.errors += 1;
        logError("reconcile: late-arrival sweep failed", error, { category: "cron", mediaId: row.id });
      }
    }

    const stale = await db.media.findMany({
      where: { status: "PENDING", deletedAt: null, createdAt: { lt: new Date(now - HOUR_MS) }, memory: { deletedAt: null } },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    for (const row of stale) {
      if (outOfTime()) {
        break;
      }
      // Each item in its own isolation scope: an identity set by a shared feature cannot leak into the next item.
      await Sentry.withIsolationScope(async () => {
        try {
          const outcome = await recordMedia({ mediaId: row.id });
          counts.pendingRechecked += 1;
          if (outcome.status === "PENDING" && row.createdAt.getTime() < now - RESERVATION_MAX_AGE_MS && uploadWindowClosed(row, now)) {
            // recordMedia also answers PENDING for a blob that EXISTS but whose first bytes it could not
            // read (issue #45's prefix check), the same word as "no blob". Only the store's own answer
            // may license a delete: a blob that is there is left alone, whatever its bytes turn out to be.
            if (await storage.head(row.storageKey)) {
              return;
            }
            const claimed = await db.media.updateMany({
              where: { id: row.id, status: "PENDING", deletedAt: null, reservedUntil: row.reservedUntil },
              data: { status: "FAILED", purgedAt: new Date(now) },
            });
            if (claimed.count === 1) {
              if (row.storageKey.startsWith(storagePrefix())) {
                await storage.del(row.storageKey);
              }
              counts.orphansFailed += 1;
            }
          }
        } catch (error) {
          counts.errors += 1;
          logError("reconcile: recordMedia failed", error, { category: "cron", mediaId: row.id });
        }
      });
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
      // Each item in its own isolation scope: an identity set by a shared feature cannot leak into the next item.
      await Sentry.withIsolationScope(async () => {
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
      });
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
      // Each item in its own isolation scope: an identity set by a shared feature cannot leak into the next item.
      await Sentry.withIsolationScope(async () => {
        try {
          // Each email type has its own sender; the row says which one owns it. A send's
          // receipt answers `leased` while its anchor's upload lease is live and is retried later.
          const result =
            row.emailType === "ADMIN_NEW_MEMORY"
              ? await notifyAdminsOfMemory({ memoryId: row.memoryId })
              : row.emailType === "SUBMISSION_CONFIRMATION"
                ? await confirmSubmission({ anchorId: row.memoryId })
                : await confirmMemory({ memoryId: row.memoryId });
          if (result.sent) {
            counts.emailsRetried += 1;
          }
        } catch (error) {
          counts.errors += 1;
          logError("reconcile: email retry failed", error, { category: "cron", memoryId: row.memoryId, emailType: row.emailType });
        }
      });
    }

    // (e) Memories with an address and something READY (or TEXT) that were never
    // emailed and are old enough that no request-path confirm is still running.
    // `none` is filtered by type: an admin-alert row alone must not count as "emailed".
    // Admin-drafted memories are excluded (SITE_EMAIL_WHERE): a confirmation here
    // would also rotate the token and kill the link the admin sent by hand.
    // Memories that belong to a send are confirmed by (e3), never one by one.
    const ready = [{ type: "TEXT" as const }, { contributorNote: { not: null } }, { media: { some: { status: "READY" as const, deletedAt: null } } }];
    const unconfirmed = await db.memory.findMany({
      where: {
        ...SITE_EMAIL_WHERE,
        deletedAt: null,
        submissionId: null,
        createdAt: { lt: new Date(now - CONFIRM_MIN_AGE_MS) },
        contributor: { email: { not: null } },
        emails: { none: { emailType: "MEMORY_CONFIRMATION" } },
        AND: [leaseClosed, { OR: ready }],
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    for (const memory of unconfirmed) {
      if (outOfTime()) {
        break;
      }
      // Each item in its own isolation scope: an identity set by a shared feature cannot leak into the next item.
      await Sentry.withIsolationScope(async () => {
        try {
          const result = await confirmMemory({ memoryId: memory.id });
          if (result.sent) {
            counts.confirmationsSent += 1;
          }
        } catch (error) {
          counts.errors += 1;
          logError("reconcile: confirmation failed", error, { category: "cron", memoryId: memory.id });
        }
      });
    }

    // (e2) The same for the family-admin alert: no contributor address needed,
    // only memories created since the alert existed (never a backfill of old
    // ones), and not while an upload younger than an hour is still in flight
    // (the request path alerts the moment it lands; step (a) gives up on older ones).
    // Not while a memory is a DRAFT the admin made; once shared it is alerted like any
    // other, and without the 30-minute wait: a Share has no request-path alert to race.
    const unalerted = await db.memory.findMany({
      where: {
        ...ADMIN_ALERT_WHERE,
        deletedAt: null,
        createdAt: { gte: ADMIN_ALERT_SINCE },
        emails: { none: { emailType: "ADMIN_NEW_MEMORY" } },
        AND: [
          leaseClosed,
          { OR: ready },
          { OR: [{ createdAt: { lt: new Date(now - CONFIRM_MIN_AGE_MS) } }, { source: { not: "WEB_UPLOAD" } }] },
        ],
        NOT: { media: { some: { status: "PENDING", deletedAt: null, createdAt: { gt: new Date(now - HOUR_MS) } } } },
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    // A memory sent with others waits until its send's lease has run out, so the
    // alert lists every file rather than "still uploading" (Task 15, D18). One
    // anchor read per send, in code, keeps the main query simple.
    const leasedSends = new Set<string>();
    const sendIds = [...new Set(unalerted.map((m) => m.submissionId).filter((id): id is string => id !== null))];
    if (sendIds.length > 0) {
      const anchors = await db.memory.findMany({
        where: { submissionId: { in: sendIds }, submissionIndex: 0, uploadLeaseUntil: { gt: new Date(now) } },
        select: { submissionId: true },
      });
      for (const anchor of anchors) {
        if (anchor.submissionId !== null) {
          leasedSends.add(anchor.submissionId);
        }
      }
    }
    for (const memory of unalerted) {
      if (outOfTime()) {
        break;
      }
      if (memory.submissionId !== null && leasedSends.has(memory.submissionId)) {
        continue;
      }
      // Each item in its own isolation scope: an identity set by a shared feature cannot leak into the next item.
      await Sentry.withIsolationScope(async () => {
        try {
          const result = await notifyAdminsOfMemory({ memoryId: memory.id });
          if (result.sent) {
            counts.adminAlertsSent += 1;
          }
        } catch (error) {
          counts.errors += 1;
          logError("reconcile: admin alert failed", error, { category: "cron", memoryId: memory.id });
        }
      });
    }

    // (e3) Sends of several memories whose receipt never went out: the browser
    // closed before completion, or completion's send failed without a row. Only
    // anchors (index 0) with an address, old enough, and with no live lease; the
    // `none` is filtered by type because the anchor's own admin-alert row must
    // not count as the send's receipt. confirmSubmission re-checks PENDING files,
    // names the missing ones and rotates every live token (Task 15).
    const unreceipted = await db.memory.findMany({
      where: {
        submissionIndex: 0,
        submissionId: { not: null },
        createdAt: { lt: new Date(now - CONFIRM_MIN_AGE_MS) },
        contributor: { email: { not: null } },
        emails: { none: { emailType: "SUBMISSION_CONFIRMATION" } },
        OR: [{ uploadLeaseUntil: null }, { uploadLeaseUntil: { lt: new Date(now) } }],
      },
      orderBy: { createdAt: "asc" },
      take: SUBMISSION_BATCH,
    });
    for (const anchor of unreceipted) {
      if (outOfTime()) {
        break;
      }
      // Each item in its own isolation scope: an identity set by a shared feature cannot leak into the next item.
      await Sentry.withIsolationScope(async () => {
        try {
          const result = await confirmSubmission({ anchorId: anchor.id });
          if (result.sent) {
            counts.submissionReceiptsSent += 1;
          }
        } catch (error) {
          counts.errors += 1;
          logError("reconcile: send receipt failed", error, { category: "cron", memoryId: anchor.id });
        }
      });
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
      // Each item in its own isolation scope: an identity set by a shared feature cannot leak into the next item.
      await Sentry.withIsolationScope(async () => {
        try {
          if (await computeChecksum({ mediaId: row.id })) {
            counts.checksumsComputed += 1;
          }
        } catch (error) {
          counts.errors += 1;
          logError("reconcile: checksum failed", error, { category: "cron", mediaId: row.id });
        }
      });
    }

    // (f) Purge: blobs of soft-deleted memories (after a 30-day grace, so a
    // Restore keeps the files) and of files removed through the claim page, only
    // those this environment uploaded (preview/dev Neon branches hold copies of
    // production rows and share the store). Only rows with outstanding work are
    // selected (a recorded blob, or derived copies that are not a fresh in-flight
    // claim), so a finished row is never re-selected and a worker is never raced
    // for a key it is still writing. Three phases per row (admin-page plan §3.6):
    //   1. claim, in a transaction under lockMemory: re-check eligibility, set
    //      `purgedAt`, flip READY → FAILED and clear the photo's GPS (the point
    //      and any GPS claim: a purged photo keeps no location), commit. No
    //      storage call inside the lock, so TX_OPTIONS is never at the mercy of
    //      the network.
    //   2. bytes, no lock: delete the original, the copies and the poster staging
    //      key; every delete is idempotent.
    //   3. pointer: drop the derived rows and null `blobUrl`.
    // A row whose phase 2 or 3 failed (or whose process died) is re-selected by
    // `purgedAt` until nothing is left; a Restore after the claim cannot undo it,
    // which is why the mark is written before the first byte goes.
    const staleClaimBefore = new Date(now - STALE_CLAIM_MS);
    const deletedMemoryBefore = new Date(now - DELETED_MEMORY_GRACE_MS);
    const orphanedBlobs = await db.media.findMany({
      where: {
        OR: [
          { purgedAt: { not: null } },
          { memory: { deletedAt: { lt: deletedMemoryBefore } } },
          // A cancelled file's Blob token may still be valid; wait for its window to close so the freed pathname cannot be refilled.
          { deletedAt: { not: null }, ...uploadWindowClosedWhere(now) },
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
    for (const row of orphanedBlobs) {
      if (outOfTime()) {
        break;
      }
      // Each item in its own isolation scope: an identity set by a shared feature cannot leak into the next item.
      await Sentry.withIsolationScope(async () => {
        try {
          // Phase 1: claim. The locked re-read decides; a Restore that committed first makes the row ineligible.
          const claimed = await db.$transaction(async (tx) => {
            await lockMemory(tx, row.memoryId);
            const fresh = await tx.media.findUniqueOrThrow({
              where: { id: row.id },
              select: { purgedAt: true, status: true, deletedAt: true, createdAt: true, reservedUntil: true, latitude: true, gpsClaimedAt: true, memory: { select: { deletedAt: true } } },
            });
            if (fresh.purgedAt !== null) {
              // Already claimed. A READY row with the mark must never serve again, and a purged photo keeps no point,
              // whoever left it that way.
              const holdsGps = fresh.latitude !== null || fresh.gpsClaimedAt !== null;
              if (fresh.status === "READY" || holdsGps) {
                await tx.media.update({ where: { id: row.id }, data: { ...(fresh.status === "READY" && { status: "FAILED" as const }), ...(holdsGps && PURGED_GPS) } });
              }
              return true;
            }
            const memoryGone = fresh.memory.deletedAt !== null && fresh.memory.deletedAt < deletedMemoryBefore;
            const fileRemoved = fresh.deletedAt !== null && uploadWindowClosed(fresh, now);
            if (!memoryGone && !fileRemoved) {
              return false;
            }
            await tx.media.update({ where: { id: row.id }, data: { purgedAt: new Date(now), ...(fresh.status === "READY" && { status: "FAILED" as const }), ...PURGED_GPS } });
            return true;
          }, TX_OPTIONS);
          if (!claimed) {
            return; // next row (this body runs inside the isolation-scope callback)
          }
          // Phase 2: bytes. Idempotent deletes, outside any lock.
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
          // Phase 3: pointer.
          if (copies.length > 0) {
            await db.derivedMedia.deleteMany({ where: { mediaId: row.id, storageKey: { in: copies.map((c) => c.storageKey) } } });
          }
          if (row.blobUrl !== null) {
            await db.media.update({ where: { id: row.id }, data: { blobUrl: null } });
          }
          counts.deletedBlobsRemoved += 1;
        } catch (error) {
          counts.errors += 1;
          logError("reconcile: blob deletion failed", error, { category: "cron", mediaId: row.id });
        }
      });
    }

    // (f2) Reservations cancelled on the claim page whose upload might have landed
    // without a callback or finalize: once the row's upload window has closed (its
    // last token has expired; issue #44), claim it (FAILED + purgedAt, conditional on
    // the state we read) and then delete the pathname (idempotent). A cancelled row
    // cannot be re-ticketed, so its window is final; a row whose bytes were recorded
    // meanwhile (ingest's "retired" path sets blobUrl and FAILED) belongs to step (f).
    const cancelled = await db.media.findMany({
      where: {
        status: "PENDING",
        deletedAt: { not: null },
        ...uploadWindowClosedWhere(now),
        storageKey: { startsWith: storagePrefix() },
      },
      orderBy: { id: "asc" },
      take: 50,
    });
    for (const row of cancelled) {
      if (outOfTime()) {
        break;
      }
      // Each item in its own isolation scope: an identity set by a shared feature cannot leak into the next item.
      await Sentry.withIsolationScope(async () => {
        try {
          const claimed = await db.media.updateMany({
            where: { id: row.id, status: "PENDING", reservedUntil: row.reservedUntil },
            data: { status: "FAILED", blobUrl: null, purgedAt: new Date(now) },
          });
          if (claimed.count === 1) {
            await storage.del(row.storageKey);
            counts.deletedBlobsRemoved += 1;
          }
        } catch (error) {
          counts.errors += 1;
          logError("reconcile: cancelled reservation purge failed", error, { category: "cron", mediaId: row.id });
        }
      });
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
      // Each item in its own isolation scope: an identity set by a shared feature cannot leak into the next item.
      await Sentry.withIsolationScope(async () => {
        try {
          const outcome = await deriveMedia({ mediaId: row.id, deadlineMs: remainingMs });
          if (Object.values(outcome).includes("derived")) {
            counts.derived += 1;
          }
        } catch (error) {
          counts.errors += 1;
          logError("reconcile: derive failed", error, { category: "cron", mediaId: row.id });
        }
      });
    }

    // (h) Photo GPS (plan 2026-11-06-photo-gps-places B3): READY photos of this environment whose GPS is not decided
    // yet, that have attempts left and that no worker holds a live claim on (final review, item 2), oldest first. Its own state, never (g)'s: a photo with its copies made is never
    // revisited by (g), so a failed GPS read needs this step to be retried, whatever its copies are doing [C48].
    // Also the backfill for photos stored before the feature. extractPhotoGps claims its own attempt and never throws;
    // a failed read is reported there and counted here, not as a run error (like (g)'s refusals).
    const undecided = await db.media.findMany({
      where: {
        status: "READY",
        deletedAt: null,
        mimeType: { startsWith: "image/" },
        storageKey: { startsWith: storagePrefix() },
        memory: { deletedAt: null },
        gpsCheckedAt: null,
        gpsAttempts: { lt: MAX_GPS_ATTEMPTS },
        OR: [{ gpsClaimedAt: null }, { gpsClaimedAt: { lt: new Date(now - GPS_STALE_CLAIM_MS) } }],
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: PHOTO_GPS_BATCH,
    });
    for (const row of undecided) {
      // A photo starts only when its whole read deadline fits in what is left of the run: a run running out of time
      // must never cost a photo one of its three attempts (the rest wait for the next run).
      if (RUN_DEADLINE_MS - (Date.now() - now) < GPS_READ_DEADLINE_MS) {
        break;
      }
      // Each item in its own isolation scope: an identity set by a shared feature cannot leak into the next item.
      await Sentry.withIsolationScope(async () => {
        try {
          const outcome = await extractPhotoGps({ mediaId: row.id, deadlineMs: GPS_READ_DEADLINE_MS });
          counts[GPS_COUNT[outcome]] += 1;
        } catch (error) {
          counts.errors += 1;
          logError("reconcile: photo GPS failed", error, { category: "cron", mediaId: row.id });
        }
      });
    }

    log.info({ action: "reconcile", ...counts }, "reconcile run finished");
    reconcileRun(Date.now() - now, counts.errors);
    finish(counts.errors > 0 ? "error" : "ok");
    return NextResponse.json({ success: true, data: counts });
  } catch (error) {
    finish("error");
    throw error;
  }
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
