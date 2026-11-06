import "server-only";

import * as Sentry from "@sentry/nextjs";

import { createLogger } from "@/lib/logger";
import { type GpsRead, jpegMetadataComplete, readGpsFromBytes } from "@/lib/photo-gps";
import { storagePrefix } from "@/lib/site-url";
import { getDb } from "@/server/db/client";
import { createStorageService } from "@/services/storage";

const log = createLogger({ category: "upload" });

export type PhotoGpsOutcome = "found" | "absent" | "failed" | "skipped";

/** Reads a photo may claim (D3). A row left undecided at the cap is never read again; cron step (h) selects below it. */
export const MAX_GPS_ATTEMPTS = 3;
/** A JPEG's EXIF almost always sits in its first 128 KiB, so that is read first [C50]; ExifReader's own first read is the same size. */
export const GPS_PREFIX_BYTES = 128 * 1024;
/** Bound on a whole-original read (photos are at most 25 MB, MAX_BYTES.PHOTO); cron step (h) passes what is left of its run when that is less. */
export const GPS_READ_DEADLINE_MS = 15_000;

class OriginalMissingError extends Error {
  constructor() {
    super("photo GPS: the original is not in the store");
    this.name = "OriginalMissingError";
  }
}

/**
 * Read a photo's GPS from its stored original and record the outcome (plan 2026-11-06-photo-gps-places B3).
 *
 * Runs on its own, never through the derived copies: those are stripped, and cron step (g) never revisits a photo
 * that has them [C41, C48]. The outcome is durable on the row: `gpsCheckedAt` set means decided (found or absent),
 * null means not yet, and `gpsAttempts` counts claimed reads up to MAX_GPS_ATTEMPTS (D3).
 *
 * 1. Eligible: READY, `image/*`, not removed, its memory not deleted, undecided, under the cap, and stored by this
 *    environment (`storagePrefix()`). Anything else is `skipped`.
 * 2. Claim an attempt with a conditional update on the count just read; losing it means another worker has the row.
 * 3. Read: a JPEG's 128 KiB prefix first, the whole original only when the prefix found nothing and its metadata
 *    continues past it; any other image whole.
 * 4. Record: found sets the pair and the stamp, absent only the stamp; both only while the row is still undecided.
 *    A failure (unreadable bytes, a missing original, any throw) leaves the row undecided for a later attempt and is
 *    reported to Sentry with `step: photo_gps` [C32].
 * 5. Log the outcome and the attempt, never a coordinate [C44].
 *
 * Never throws.
 */
export async function extractPhotoGps({ mediaId, deadlineMs = GPS_READ_DEADLINE_MS }: { mediaId: string; deadlineMs?: number }): Promise<PhotoGpsOutcome> {
  let attempt: number | undefined;
  try {
    const db = getDb();
    const row = await db.media.findUnique({
      where: { id: mediaId },
      select: { status: true, mimeType: true, storageKey: true, deletedAt: true, gpsCheckedAt: true, gpsAttempts: true, memory: { select: { deletedAt: true } } },
    });
    if (
      !row ||
      row.status !== "READY" ||
      !row.mimeType.startsWith("image/") ||
      row.deletedAt !== null ||
      row.memory.deletedAt !== null ||
      row.gpsCheckedAt !== null ||
      row.gpsAttempts >= MAX_GPS_ATTEMPTS ||
      !row.storageKey.startsWith(storagePrefix())
    ) {
      return skipped(mediaId, "not_eligible");
    }

    // Equality with the count read (already under the cap) makes the claim a compare-and-set: of two workers that read
    // the same row, exactly one moves the count and reads the bytes.
    const claimed = await db.media.updateMany({
      where: { id: mediaId, gpsCheckedAt: null, gpsAttempts: row.gpsAttempts },
      data: { gpsAttempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
      return skipped(mediaId, "claimed_elsewhere");
    }
    attempt = row.gpsAttempts + 1;

    const read = await readGps(row.storageKey, row.mimeType, deadlineMs);
    if (read.status === "failed") {
      return failed(mediaId, attempt, read.error);
    }
    const decided = await db.media.updateMany({
      where: { id: mediaId, gpsCheckedAt: null },
      data: read.status === "found" ? { ...read.coordinates, gpsCheckedAt: new Date() } : { gpsCheckedAt: new Date() },
    });
    if (decided.count === 0) {
      // Another worker decided while this one read; its decision stands.
      return skipped(mediaId, "decided_elsewhere", attempt);
    }
    log.info({ action: "photo_gps", mediaId, outcome: read.status, attempt }, "photo GPS recorded");
    return read.status;
  } catch (error) {
    return failed(mediaId, attempt, error);
  }
}

/** The GPS in the stored original; a missing original is a failure (the row is READY, so its bytes should be there). */
async function readGps(storageKey: string, mimeType: string, deadlineMs: number): Promise<GpsRead> {
  if (mimeType === "image/jpeg") {
    const prefix = await createStorageService().readPrefix(storageKey, GPS_PREFIX_BYTES);
    if (prefix === null) {
      return { status: "failed", error: new OriginalMissingError() };
    }
    const fromPrefix = readGpsFromBytes(prefix);
    if (fromPrefix.status === "found" || jpegMetadataComplete(prefix)) {
      return fromPrefix;
    }
  }
  const whole = await readWhole(storageKey, deadlineMs);
  return whole === null ? { status: "failed", error: new OriginalMissingError() } : readGpsFromBytes(whole);
}

/** The whole original, or null when it is missing. The deadline aborts the fetch, body included, rather than waiting on a stalled download. */
async function readWhole(storageKey: string, deadlineMs: number): Promise<Uint8Array | null> {
  const file = await createStorageService().get(storageKey, { signal: AbortSignal.timeout(deadlineMs) });
  return file === null ? null : new Uint8Array(await new Response(file.stream).arrayBuffer());
}

function skipped(mediaId: string, reason: "not_eligible" | "claimed_elsewhere" | "decided_elsewhere", attempt?: number): PhotoGpsOutcome {
  log.debug({ action: "photo_gps", mediaId, outcome: "skipped", reason, attempt }, "photo GPS skipped");
  return "skipped";
}

/**
 * Swallowed, so reported [C32]. Sentry gets the error itself (Rob's telemetry ruling keeps coordinates there, D14);
 * the log line names only its type, because a database error's message can quote the row it refused.
 */
function failed(mediaId: string, attempt: number | undefined, error: unknown): PhotoGpsOutcome {
  Sentry.captureException(error, { tags: { step: "photo_gps", media_id: mediaId }, extra: { attempt } });
  log.warn({ action: "photo_gps", mediaId, outcome: "failed", attempt, errorType: error instanceof Error ? error.name : typeof error }, "photo GPS could not be read");
  return "failed";
}
