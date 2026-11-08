import "server-only";

import * as Sentry from "@sentry/nextjs";

import { createLogger } from "@/lib/logger";
import { hasLocationReader, isMp4Container } from "@/lib/media-location";
import { type GpsRead, jpegMetadataComplete, readGpsFromBytes } from "@/lib/photo-gps";
import { storagePrefix } from "@/lib/site-url";
import { readVideoLocation } from "@/lib/video-gps";
import { getDb } from "@/server/db/client";
import { createStorageService } from "@/services/storage";

const log = createLogger({ category: "upload" });

export type PhotoGpsOutcome = "found" | "absent" | "failed" | "skipped";

/**
 * Video absence carries a deterministic parser reason to the committed decision's log, and whether the reader parsed
 * the whole movie box (`complete`, TCR round 1 B1-1); photo absence carries neither.
 */
type MediaGpsRead = Exclude<GpsRead, { status: "absent" }> | { status: "absent"; reason?: string; complete?: boolean };

/** Reads a media row may claim (D3). A row left undecided at the cap is never read again; cron step (h) selects below it. */
export const MAX_GPS_ATTEMPTS = 3;
/** A JPEG's EXIF almost always sits in its first 128 KiB, so that is read first [C50]; ExifReader's own first read is the same size. */
export const GPS_PREFIX_BYTES = 128 * 1024;
/**
 * Bound on all reads together: the prefix and any whole-original photo read (at most 25 MB, MAX_BYTES.PHOTO),
 * or a video's head and bounded ranges. Cron step (h) starts only when this much of its run is left, plus
 * GPS_DB_MARGIN_MS, so running out of run time never costs a file one of its attempts.
 */
export const GPS_READ_DEADLINE_MS = 15_000;
/**
 * Room for the database work around the read, which GPS_READ_DEADLINE_MS does not cover: the row read and the claim
 * before it, the decision write after it (Team Code Review #7). Each is one statement on one row, normally a few
 * milliseconds on the cron's warm connection; the margin lets a slow database take seconds without the function's
 * hard limit cutting off a file whose attempt is already spent. Cron step (h) starts a file only with this plus the
 * read deadline left in its run.
 */
export const GPS_DB_MARGIN_MS = 5_000;
/**
 * A GPS claim (`gpsClaimedAt`) older than this is presumed abandoned (the function died mid-read) and may be taken
 * over, as with deriveMedia's STALE_CLAIM_MS. It outlasts a whole read (GPS_READ_DEADLINE_MS) plus the claim and the
 * decision writes, so a live worker's claim is never taken over; cron step (h) runs every 10 minutes anyway.
 */
export const GPS_STALE_CLAIM_MS = 60_000;

class OriginalMissingError extends Error {
  constructor() {
    super("media GPS: the original is not in the store");
    this.name = "OriginalMissingError";
  }
}

/**
 * Read a photo or video's GPS from its stored original and record the outcome (photo GPS plan B3; media plan §9).
 *
 * Runs on its own, never through the derived copies: those are stripped, and cron step (g) never revisits a photo
 * that has them [C41, C48]. The outcome is durable on the row: `gpsCheckedAt` set means decided (found or absent),
 * null means not yet, and `gpsAttempts` counts claimed reads up to MAX_GPS_ATTEMPTS (D3). `gpsClaimedAt` is the read's
 * lease, like deriveMedia's `claimedAt` (final review, item 2).
 *
 * 1. Eligible: READY, a supported photo or video type, not removed, its memory not deleted, undecided, under the cap, stored by this
 *    environment (`storagePrefix()`), and not under a live claim (`gpsClaimedAt` null or older than
 *    GPS_STALE_CLAIM_MS). Anything else is `skipped`, with no read and no attempt spent.
 * 2. Claim: one conditional update that moves `gpsAttempts` from the count just read and sets `gpsClaimedAt`, only
 *    while the row is undecided and unclaimed (or its claim is stale). While a claim is live no other worker reads the
 *    bytes; one that loses the update is `skipped`.
 * 3. Read: a JPEG's 128 KiB prefix first, the whole original only when the prefix found nothing and its metadata
 *    continues past it; any other image whole. MOV/MP4 use head for size and bounded range reads for metadata.
 * 4. Record: found sets the pair and the stamp, absent only the stamp, and both clear the claim; an MP4-family file
 *    also records `gpsScanComplete` (true for found and for a complete parse with no location, false when the reader
 *    stopped early), so a give-up never counts as clean on See memories (TCR round 1, B1-1); only while the row is
 *    still undecided, the file not removed and its memory not deleted, so a file removed while it was read keeps no
 *    point (final review, item 5). A failure (unreadable bytes, a missing original, any throw) leaves the row
 *    undecided and its claim in place to expire, for a later attempt, and is reported to Sentry with `step: photo_gps`
 *    [C32].
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
      select: { status: true, mimeType: true, storageKey: true, deletedAt: true, gpsCheckedAt: true, gpsAttempts: true, gpsClaimedAt: true, memory: { select: { deletedAt: true } } },
    });
    const now = new Date();
    const staleBefore = new Date(now.getTime() - GPS_STALE_CLAIM_MS);
    if (
      !row ||
      row.status !== "READY" ||
      !hasLocationReader(row.mimeType) ||
      row.deletedAt !== null ||
      row.memory.deletedAt !== null ||
      row.gpsCheckedAt !== null ||
      row.gpsAttempts >= MAX_GPS_ATTEMPTS ||
      !row.storageKey.startsWith(storagePrefix())
    ) {
      return skipped(mediaId, "not_eligible");
    }
    if (row.gpsClaimedAt !== null && row.gpsClaimedAt >= staleBefore) {
      // Another worker holds a live claim and is reading the bytes: no read here, no attempt spent.
      return skipped(mediaId, "claimed_elsewhere");
    }

    // A compare-and-set on the count read (already under the cap) and on the claim being free or stale: of two workers
    // that read the same row, exactly one moves the count and sets the claim. While that claim is live, no other worker
    // reads the bytes; it lapses only after GPS_STALE_CLAIM_MS, when the holder is presumed dead.
    const claimed = await db.media.updateMany({
      where: { id: mediaId, gpsCheckedAt: null, gpsAttempts: row.gpsAttempts, OR: [{ gpsClaimedAt: null }, { gpsClaimedAt: { lt: staleBefore } }] },
      data: { gpsAttempts: { increment: 1 }, gpsClaimedAt: now },
    });
    if (claimed.count === 0) {
      return skipped(mediaId, "claimed_elsewhere");
    }
    attempt = row.gpsAttempts + 1;

    const read = await readGps(row.storageKey, row.mimeType, deadlineMs);
    if (read.status === "failed") {
      return failed(mediaId, attempt, read.error);
    }
    // The decision clears the claim. A file removed (or whose memory was deleted) while it was read keeps no point.
    // An MP4-family decision also records whether the scan was complete: only a complete one with no location lets the
    // original play on See memories (plan 2026-11-08 D16, TCR round 1 B1-1). Photos never stream their original.
    const scan = isMp4Container(row.mimeType) ? { gpsScanComplete: read.status === "found" || read.complete === true } : {};
    const decided = await db.media.updateMany({
      where: { id: mediaId, gpsCheckedAt: null, deletedAt: null, memory: { deletedAt: null } },
      data: read.status === "found" ? { ...read.coordinates, gpsCheckedAt: new Date(), gpsClaimedAt: null, ...scan } : { gpsCheckedAt: new Date(), gpsClaimedAt: null, ...scan },
    });
    if (decided.count === 0) {
      // Another worker decided while this one read (its decision stands), or the file was removed meanwhile.
      return skipped(mediaId, "decided_elsewhere_or_removed", attempt);
    }
    log.info({ action: "photo_gps", mediaId, outcome: read.status, attempt, ...(read.status === "absent" && read.reason !== undefined ? { reason: read.reason } : {}), ...(read.status === "absent" && read.complete !== undefined ? { complete: read.complete } : {}) }, "media GPS recorded");
    return read.status;
  } catch (error) {
    return failed(mediaId, attempt, error);
  }
}

/**
 * The GPS in the stored original; a missing original is a failure (the row is READY, so its bytes should be there).
 * One deadline covers every read: its signal aborts a stalled head, prefix, range or download, body included, and the abort
 * surfaces as a failure that leaves the row undecided.
 */
async function readGps(storageKey: string, mimeType: string, deadlineMs: number): Promise<MediaGpsRead> {
  const signal = AbortSignal.timeout(deadlineMs);
  const storage = createStorageService();
  if (isMp4Container(mimeType)) {
    const head = await storage.head(storageKey, { signal });
    if (head === null) {
      throw new OriginalMissingError();
    }
    return readVideoLocation(async (offset, length) => {
      const bytes = await storage.readRange(storageKey, offset, length, { signal });
      if (bytes === null) {
        throw new OriginalMissingError();
      }
      return bytes;
    }, head.size);
  }
  if (mimeType === "image/jpeg") {
    const prefix = await storage.readPrefix(storageKey, GPS_PREFIX_BYTES, { signal });
    if (prefix === null) {
      return { status: "failed", error: new OriginalMissingError() };
    }
    const fromPrefix = readGpsFromBytes(prefix);
    if (fromPrefix.status === "found" || jpegMetadataComplete(prefix)) {
      return fromPrefix;
    }
  }
  const whole = await readWhole(storageKey, signal);
  return whole === null ? { status: "failed", error: new OriginalMissingError() } : readGpsFromBytes(whole);
}

/** The whole original, or null when it is missing. */
async function readWhole(storageKey: string, signal: AbortSignal): Promise<Uint8Array | null> {
  const file = await createStorageService().get(storageKey, { signal });
  return file === null ? null : new Uint8Array(await new Response(file.stream).arrayBuffer());
}

function skipped(mediaId: string, reason: "not_eligible" | "claimed_elsewhere" | "decided_elsewhere_or_removed", attempt?: number): PhotoGpsOutcome {
  log.debug({ action: "photo_gps", mediaId, outcome: "skipped", reason, attempt }, "media GPS skipped");
  return "skipped";
}

/**
 * Swallowed, so reported [C32]. Sentry gets the error itself (Rob's telemetry ruling keeps coordinates there, D14);
 * the log line names only its type, because a database error's message can quote the row it refused.
 */
function failed(mediaId: string, attempt: number | undefined, error: unknown): PhotoGpsOutcome {
  Sentry.captureException(error, { tags: { step: "photo_gps", media_id: mediaId }, extra: { attempt } });
  log.warn({ action: "photo_gps", mediaId, outcome: "failed", attempt, errorType: error instanceof Error ? error.name : typeof error }, "media GPS could not be read");
  return "failed";
}
