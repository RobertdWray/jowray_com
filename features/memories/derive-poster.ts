import "server-only";

import * as Sentry from "@sentry/nextjs";

import type { DeriveOutcome } from "@/features/memories/derive-media";
import { claimKind, type DerivedClaim, failClaims, isEligible, publishClaims, type PublishOutcome, quietDel } from "@/features/memories/derived-claims";
import { isImageDeriveError } from "@/lib/image-derive-error";
import { createLogger, logError, toError } from "@/lib/logger";
import { isAllowedMime, matchesSignature, SIGNATURE_PREFIX_BYTES } from "@/lib/media-types";
import { storagePrefix } from "@/lib/site-url";
import { MAX_VIDEO_PIXELS, type PosterContainer, tooManyPixelsCode, type VideoFrameErrorCode } from "@/lib/video-frames";
import { readVideoTrackInfo, type TransferKind } from "@/lib/video-track";
import { getDb } from "@/server/db/client";
import { createImageService, DERIVE_DEFAULTS, type DeriveSlot } from "@/services/images";
import { createStorageService, type StorageService } from "@/services/storage";
import { createVideoFrameService } from "@/services/video-frames";

const log = createLogger({ category: "upload" });

/**
 * The budget ffmpeg and sharp are guaranteed when a poster is claimed. Nothing is claimed with less, so no attempt is
 * spent (premortem #5): one or two ffmpeg runs and the re-encode need a few seconds, and a run that times out costs
 * the row one of its three attempts. Waiting for the image slot and reading the headers both stop while this much,
 * and the claim's margin, is still left.
 */
export const POSTER_MIN_BUDGET_MS = 6_000;

/**
 * Kept on top of POSTER_MIN_BUDGET_MS by every step before the claim, for the claim's own latency (a reclaim deletes
 * the previous candidate first). Reads that end just inside their window therefore still hold the whole floor once
 * the row is claimed; without it they would pass the inspection check, then trip the post-claim floor and give the
 * claim back (T6 re-review). The post-claim check stays at the floor, for a claim slower than this.
 */
export const CLAIM_MARGIN_MS = 1_000;

/** What a run must still have at every step before the claim: the poster's own budget and the claim's margin. */
const PRE_CLAIM_BUDGET_MS = POSTER_MIN_BUDGET_MS + CLAIM_MARGIN_MS;

/**
 * An inspection window at least this long that still runs out is a stalled object, not a busy run, and is reported
 * to Sentry; a shorter one is only warned. The cron's qualifies (its 20 s step less the floor and the margin: up to
 * 13 s), and MCP finalize's when the call left it at least 17 s; the upload callback's never does (15 s less them: at
 * most 8 s). Without the report, a video whose reads stall in every window would be deferred on every run with no
 * signal.
 */
export const INSPECT_STALL_REPORT_MS = 10_000;

/**
 * Kept back from ffmpeg for sharp. Re-encoding a frame of at most 1000 px takes tens of milliseconds, but libvips's
 * timeout counts whole seconds, so a frame that arrives with less than this left could not be encoded in time.
 */
const ENCODE_RESERVE_MS = 1_000;

/** A row's verdict, recorded by `failClaims`; `isEligible` alone decides which are retried (`decode_failed`, `timeout`). */
type PosterFailureCode = VideoFrameErrorCode;

/**
 * What the original's first bytes and movie box say, read before anything is claimed. `bytesRead` counts every byte
 * the reads returned (the 128-byte prefix and the track reader's ranges; `head` returns none).
 * - `ok`: ready to claim and extract.
 * - `verdict`: something to record on the row (final, or retryable within the attempts).
 * - `out_of_time`: the reads were cut off with only the poster budget left. That is the store's doing, not the
 *   video's: the reads are bounded (128 bytes, then at most 16 range reads and 16.5 MiB in `readVideoTrackInfo`), so
 *   it is deferred and spends no attempt.
 */
type Inspection = { bytesRead: number } & (
  | { kind: "ok"; size: number; container: PosterContainer; transferKind: TransferKind; track?: { codec: string; width: number; height: number } }
  | { kind: "verdict"; code: PosterFailureCode; detail: string; error?: Error }
  | { kind: "out_of_time" }
);

/** The environment, not the video, stopped the run (no binary, a loopback server failure); reported, never recorded. */
class PosterEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PosterEnvironmentError";
  }
}

class OriginalMissingError extends Error {
  constructor() {
    super("video poster: the original is not in the store");
    this.name = "OriginalMissingError";
  }
}

/** The slot's refusals that are verdicts on this frame; anything else is unexpected and reported. */
function frameVerdict(error: unknown): PosterFailureCode | null {
  if (!isImageDeriveError(error)) {
    return null;
  }
  switch (error.code) {
    case "too_many_pixels":
      return tooManyPixelsCode(error.limit ?? MAX_VIDEO_PIXELS);
    case "decode_failed":
    case "timeout":
    case "unsupported_type":
      return error.code;
    default:
      return null;
  }
}

/**
 * The demuxer ffmpeg is forced to use, from the first bytes (never probed from the upload): any QuickTime / ISO BMFF
 * top-level atom (an `ftyp` of any brand, MP4, 3GP or `qt  `, or the `moov`/`wide`/`mdat` starts of older QuickTime
 * files, as the upload byte check accepts them) → `mov`; the EBML magic (WebM, Matroska) → `matroska`.
 */
function containerOf(prefix: Uint8Array): PosterContainer | null {
  if (matchesSignature("video/webm", prefix)) {
    return "matroska";
  }
  if (matchesSignature("video/quicktime", prefix)) {
    return "mov";
  }
  return null;
}

/**
 * Exactly `length` bytes of the original at `offset`. A request outside the original is refused here rather than
 * sent to the store (which answers 416 past the end); a missing original throws.
 */
async function readOriginal(storage: StorageService, storageKey: string, size: number, offset: number, length: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 || offset + length > size) {
    throw new RangeError(`read of ${length} bytes at ${offset} is outside the original's ${size} bytes`);
  }
  const bytes = await storage.readRange(storageKey, offset, length, { signal });
  if (bytes === null) {
    throw new OriginalMissingError();
  }
  return bytes;
}

/**
 * Size, container and (for `mov`) the first video track; never throws.
 * - A read cut off by `signal` is `out_of_time`, whatever the reader made of it.
 * - A missing original, or a store error, is a retryable `decode_failed` (bounded by the attempts, as a failed
 *   download is for photos: a store error can be specific to this object).
 * - The track reader's verdicts map by ruling R6: `failed` (a malformed box) → retryable `decode_failed` with its
 *   error, `absent` → `no_video_stream`.
 * - A declared track over MAX_VIDEO_PIXELS is refused before ffmpeg; a non-positive width or height is unknown, and
 *   ffmpeg's own `-max_pixels` guards it (ruling R7).
 */
async function inspect(storage: StorageService, storageKey: string, signal: AbortSignal): Promise<Inspection> {
  let bytesRead = 0;
  const counted = (bytes: Uint8Array): Uint8Array => {
    bytesRead += bytes.byteLength;
    return bytes;
  };
  const verdict = (code: PosterFailureCode, detail: string, error?: Error): Inspection => ({ kind: "verdict", code, detail, error, bytesRead });
  const outOfTime = (): Inspection => ({ kind: "out_of_time", bytesRead });
  try {
    const head = await storage.head(storageKey, { signal });
    const prefix = head === null ? null : await storage.readPrefix(storageKey, SIGNATURE_PREFIX_BYTES, { signal });
    if (head === null || prefix === null) {
      return verdict("decode_failed", "the original is not in the store");
    }
    const container = containerOf(counted(prefix));
    if (container === null) {
      return verdict("unsupported_type", "the bytes are neither QuickTime/ISO BMFF nor Matroska/WebM");
    }
    if (container === "matroska") {
      return { kind: "ok", size: head.size, container, transferKind: "unknown", bytesRead };
    }
    const info = await readVideoTrackInfo(async (offset, length) => counted(await readOriginal(storage, storageKey, head.size, offset, length, signal)), head.size);
    if (info.status === "failed") {
      return signal.aborted ? outOfTime() : verdict("decode_failed", info.reason, info.error);
    }
    if (info.status === "absent") {
      return verdict("no_video_stream", info.reason);
    }
    const { codec, width, height, transferKind } = info.track;
    if (width > 0 && height > 0 && width * height > MAX_VIDEO_PIXELS) {
      return verdict(tooManyPixelsCode(MAX_VIDEO_PIXELS), `the ${codec} track declares ${width}×${height}`);
    }
    return { kind: "ok", size: head.size, container, transferKind, track: { codec, width, height }, bytesRead };
  } catch (error) {
    if (signal.aborted) {
      return outOfTime();
    }
    const thrown = toError(error);
    return verdict("decode_failed", thrown.message, thrown);
  }
}

/**
 * Make the POSTER of one READY video: one clean frame at the thumbnail spec (video-posters plan T6, D3–D6).
 *
 * Only `/api/upload`, `/api/mcp` and the reconcile cron may import this module: it reaches the ffmpeg binary, which
 * is traced into those three functions alone (D1, `scripts/check-traces.ts`).
 *
 * 1. Gate: READY, an allowed `video/*` type, not removed, its memory not deleted, stored under `storagePrefix()`, and
 *    its POSTER row (if any) eligible under the video pixel ceiling. Anything else is `not_eligible` (or
 *    `claimed_elsewhere` for a live claim), with nothing read. A stale claim that has used up its attempts is retired
 *    as `abandoned` straight away: that needs no binary, slot or byte.
 * 2. Preflight, before any claim: at least POSTER_MIN_BUDGET_MS and CLAIM_MARGIN_MS left, the binary available, then
 *    the image slot, waited for only while both would remain. A miss is `deferred`: nothing is claimed, so no attempt
 *    is spent, and the cron comes back. The slot is held from here through ffmpeg AND sharp: a 4K frame costs ffmpeg
 *    about 280 MB, so one heavy decode runs per process.
 * 3. Inspect: `storage.head` for the size, the first 128 bytes for the container and, for `mov`, the first video
 *    track (pixel ceiling, HDR transfer). The reads are cut off when only the floor and the claim's margin are left, so
 *    they either finish in time to claim with the whole poster budget or are `deferred`, still unclaimed. A window that
 *    runs out is warned, and reported to Sentry when it was at least INSPECT_STALL_REPORT_MS long.
 * 4. Claim the POSTER row with a fresh `.jpg` key ([C35], the shared protocol). An inspection verdict is recorded on
 *    the claim. If the claim itself left less than POSTER_MIN_BUDGET_MS (it took longer than its margin), the claim is
 *    released (no attempt spent) and the run is `deferred`. Otherwise ffmpeg extracts the frame inside a
 *    `media.poster` span [C24], within the budget less the encoder's reserve, reading the original only through
 *    bounded range reads (D2).
 * 5. sharp re-encodes the frame at the thumbnail spec [C21] (D4), and the slot is released.
 * 6. The JPEG is written to the claimed key, and the claim is published under the memory lock with no `whileLocked`:
 *    a poster never writes the Media row, whose `updatedAt` feeds `reviewVersion` (D6, [C36]). A video removed
 *    meanwhile is not resurrected.
 *
 * Attempts: a condition of the video is recorded and bounded: `no_video_stream`, `no_frame`, `source_limit`,
 * `unsupported_type`, `too_many_pixels:<n>` and `too_large` are final; `decode_failed` and `timeout` are retried up
 * to MAX_DECODE_ATTEMPTS (`isEligible`). A condition of the environment spends none: when ffmpeg cannot run after the
 * claim (the binary vanished, the loopback server failed), or the store or database fails the write or the publish,
 * our row is given back (deleted while it is still exactly our PENDING claim, its candidate blob with it) and the
 * result is `deferred`, reported to Sentry. Never throws.
 */
export async function derivePoster({ mediaId, deadlineMs, now = new Date() }: { mediaId: string; deadlineMs: number; now?: Date }): Promise<DeriveOutcome> {
  const startedAt = Date.now();
  const deadlineAt = startedAt + deadlineMs;
  const remainingMs = () => deadlineAt - Date.now();
  const elapsedMs = () => Date.now() - startedAt;
  let slot: DeriveSlot | null = null;
  let claim: DerivedClaim<"POSTER"> | null = null;
  let inspectTimer: ReturnType<typeof setTimeout> | undefined;
  /** What every log line of this run carries, filled in as it is learnt. */
  const run: Record<string, unknown> = { mediaId };

  /** Nothing claimed and nothing spent: the cron comes back. */
  const deferred = (code: string, message: string): DeriveOutcome => {
    log.info({ action: "poster_deferred", ...run, code, durationMs: elapsedMs() }, message);
    return "deferred";
  };

  /** Our claim, handed over exactly once: to be failed or released. */
  const takeClaim = (): DerivedClaim<"POSTER"> => {
    if (claim === null) {
      throw new Error("derivePoster holds no claim");
    }
    const held = claim;
    claim = null;
    return held;
  };

  /** Record a verdict on our claim (conditionally; only the candidate still ours is deleted) and log it. */
  const fail = async (code: PosterFailureCode, details: { detail: string; error?: Error; stderrTail?: string }): Promise<DeriveOutcome> => {
    await failClaims([takeClaim()], { mediaId, now, error: code });
    const fields = { action: "poster_failed", ...run, code, detail: details.detail, stderrTail: details.stderrTail, durationMs: elapsedMs() };
    if (details.error) {
      logError("video poster failed", details.error, { category: "upload", ...fields });
    } else {
      log.warn(fields, "video poster could not be made");
    }
    return "failed";
  };

  /**
   * Give our claim back after it was taken: no attempt spent, `deferred`. `report` is the environment's failure, sent to
   * Sentry; without one (a claim that took too long) it is logged only.
   */
  const release = async (code: string, report: Error | null, extra: Record<string, unknown> = {}): Promise<DeriveOutcome> => {
    await releaseClaim(takeClaim(), { mediaId, now });
    const fields = { action: "poster_deferred", ...run, code, ...extra, durationMs: elapsedMs() };
    if (report) {
      logError("video poster deferred", report, { category: "upload", ...fields });
    } else {
      log.info(fields, "poster claim given back; left to the cron");
    }
    return "deferred";
  };

  try {
    const db = getDb();
    const storage = createStorageService();
    const row = await db.media.findUnique({
      where: { id: mediaId },
      include: { memory: { select: { deletedAt: true } }, derivatives: { where: { kind: "POSTER" } } },
    });
    if (
      !row ||
      row.status !== "READY" ||
      row.deletedAt !== null ||
      row.memory.deletedAt !== null ||
      !row.mimeType.startsWith("video/") ||
      !isAllowedMime(row.mimeType) ||
      !row.storageKey.startsWith(storagePrefix())
    ) {
      return "not_eligible";
    }
    run.memoryId = row.memoryId;
    const existing = row.derivatives[0] ?? null;
    const claimPoster = async () => {
      const claimed = await claimKind({ mediaId, kind: "POSTER", existing, originalKey: row.storageKey, extension: "jpg", now, maxPixels: MAX_VIDEO_PIXELS });
      if (!("claim" in claimed) && claimed.outcome === "failed") {
        log.warn({ action: "poster_abandoned", ...run }, "stale poster claim had used up its attempts");
      }
      return claimed;
    };

    // 1. Eligibility. An exhausted stale claim is retired here: that needs no binary, slot or byte.
    const verdict = isEligible(existing, now, MAX_VIDEO_PIXELS);
    if (verdict === "not_eligible" || verdict === "claimed_elsewhere") {
      return verdict;
    }
    if (verdict === "exhausted") {
      const retired = await claimPoster();
      if ("claim" in retired) {
        claim = retired.claim;
        throw new Error("claimKind returned a claim for an exhausted POSTER row");
      }
      return retired.outcome;
    }

    // 2. Preflight: nothing below is claimed until all of it holds.
    if (remainingMs() < PRE_CLAIM_BUDGET_MS) {
      return deferred("budget", "too little budget to start a poster; left to the cron");
    }
    const frames = createVideoFrameService();
    if (!(await frames.available())) {
      // A deployment defect (a trace-key miss, a skipped install script, a lost exec bit): reported every time.
      logError("video poster deferred", new PosterEnvironmentError("the ffmpeg binary is missing or not executable"), { category: "upload", action: "poster_deferred", ...run });
      return "deferred";
    }
    try {
      // Wait only while the poster's own budget and the claim's margin would still be whole afterwards.
      slot = await createImageService().acquire(remainingMs() - PRE_CLAIM_BUDGET_MS);
    } catch (error) {
      if (isImageDeriveError(error) && (error.code === "busy" || error.code === "timeout")) {
        return deferred(error.code, "image slot not available in time; left to the cron");
      }
      throw error;
    }
    // 3. Inspect, cut off when only the poster budget and the claim's margin are left: it finishes in time to claim
    //    with the whole floor, or it is deferred.
    const inspectWindowMs = remainingMs() - PRE_CLAIM_BUDGET_MS;
    if (inspectWindowMs <= 0) {
      return deferred("budget", "the image slot arrived with too little budget left; left to the cron");
    }
    const controller = new AbortController();
    inspectTimer = setTimeout(() => controller.abort(), inspectWindowMs);
    const inspection = await inspect(storage, row.storageKey, controller.signal);
    clearTimeout(inspectTimer);
    Object.assign(run, { inspectBytes: inspection.bytesRead, sourceBytesRead: inspection.bytesRead });
    if (inspection.kind === "out_of_time") {
      // The reads are bounded, so a window that runs out is the store's doing, and nothing is spent. Never silent: an
      // object that stalls in every window would otherwise be deferred on every run with no signal.
      const fields = { action: "poster_deferred", ...run, code: "inspect_time", inspectWindowMs, durationMs: elapsedMs() };
      log.warn(fields, "reading the headers did not finish while the poster budget was left; left to the cron");
      if (inspectWindowMs >= INSPECT_STALL_REPORT_MS) {
        Sentry.captureMessage("video poster: reading the original's headers stalled for a whole inspection window", {
          level: "warning",
          tags: { media_id: mediaId, memory_id: row.memoryId },
          extra: fields,
        });
      }
      return "deferred";
    }
    if (inspection.kind === "ok") {
      Object.assign(run, { container: inspection.container, transferKind: inspection.transferKind, ...inspection.track });
      if (remainingMs() < PRE_CLAIM_BUDGET_MS) {
        return deferred("budget", "reading the headers left too little budget; left to the cron");
      }
    }

    // 4. Claim; the claim must exist before any verdict can be recorded.
    const claimed = await claimPoster();
    if (!("claim" in claimed)) {
      return claimed.outcome;
    }
    claim = claimed.claim;
    if (inspection.kind === "verdict") {
      return await fail(inspection.code, { detail: inspection.detail, error: inspection.error });
    }
    if (remainingMs() < POSTER_MIN_BUDGET_MS) {
      // A slow claim (a reclaim deletes the previous candidate first) is not the video's fault.
      return await release("budget", null);
    }

    const { size, container, transferKind } = inspection;
    const extraction = await Sentry.startSpan(
      { name: "video poster", op: "media.poster", attributes: { media_id: mediaId, memory_id: row.memoryId, "poster.container": container, "poster.transfer_kind": transferKind } },
      async (span) => {
        const result = await frames.extractPoster({
          size,
          container,
          transferKind,
          deadlineMs: remainingMs() - ENCODE_RESERVE_MS,
          read: (offset, length, signal) => readOriginal(storage, row.storageKey, size, offset, length, signal),
        });
        span.setAttributes({
          "poster.outcome": result.ok ? "ok" : result.code,
          "poster.source_bytes_read": result.sourceBytesRead,
          ...(result.ok ? { "poster.seek_seconds": result.seekSeconds, "poster.tone_mapped": result.toneMapped } : {}),
        });
        return result;
      },
    );
    Object.assign(run, { frameBytes: extraction.sourceBytesRead, sourceBytesRead: inspection.bytesRead + extraction.sourceBytesRead });

    if (!extraction.ok) {
      if (extraction.code === "deferred") {
        // ffmpeg could not run here after all.
        return await release("ffmpeg", extraction.error ?? new PosterEnvironmentError(extraction.detail), { detail: extraction.detail, stderrTail: extraction.stderrTail });
      }
      return await fail(extraction.code, { detail: extraction.detail, error: extraction.error, stderrTail: extraction.stderrTail });
    }
    Object.assign(run, { toneMapped: extraction.toneMapped, seekSeconds: extraction.seekSeconds, warning: extraction.warning });

    // 5. Re-encode while the slot is still ours (the slot does not refuse a spent deadline, so check first).
    if (remainingMs() <= 0) {
      return await fail("timeout", { detail: "ffmpeg used the whole budget; none was left to re-encode the frame" });
    }
    const { thumb } = await slot.thumbnail(extraction.png, { sourceMime: "image/png", deadlineMs: remainingMs(), maxPixels: MAX_VIDEO_PIXELS, thumb: DERIVE_DEFAULTS.thumb });
    slot.release();
    slot = null;

    // 6. Write and publish. Both depend on the store and the database only, never on the video, so a failure gives the
    //    claim back. Under the memory lock, conditional on this exact claim; no `whileLocked`, so the Media row is never
    //    written (D6).
    let outcomes: Partial<Record<"POSTER", PublishOutcome>>;
    try {
      if (!("failed" in thumb)) {
        await storage.put(claim.storageKey, thumb.data, thumb.mimeType);
      }
      outcomes = await publishClaims({ mediaId, memoryId: row.memoryId, claims: [claim], now, encodedFor: () => thumb });
    } catch (error) {
      return await release("write", toError(error));
    }
    const published = outcomes.POSTER;
    if (published === undefined) {
      throw new Error("publishClaims returned no POSTER outcome for the claim it was given");
    }
    claim = null;
    const fields = { ...run, outcome: published, durationMs: elapsedMs() };
    if (published === "derived") {
      log.info({ action: "poster_derived", ...fields }, "video poster recorded");
    } else if (published === "failed") {
      log.warn({ action: "poster_failed", ...fields, code: "too_large" }, "video poster is over the thumbnail budget even at the fallback quality");
    } else {
      log.info({ action: "poster_dropped", ...fields }, "video removed or poster claim taken over while it was made; nothing published");
    }
    return published;
  } catch (error) {
    const thrown = toError(error);
    if (claim !== null) {
      const code = frameVerdict(error);
      return code === null ? await fail("decode_failed", { detail: thrown.message, error: thrown }) : await fail(code, { detail: thrown.message });
    }
    // Nothing claimed, so nothing spent: the cron comes back.
    logError("video poster failed before its claim", thrown, { category: "upload", ...run, durationMs: elapsedMs() });
    return "deferred";
  } finally {
    clearTimeout(inspectTimer);
    slot?.release();
  }
}

/**
 * Give a claim back: delete our PENDING row, only while it is still exactly our claim (so a publish that committed
 * despite an error, or another worker's reclaim, is left alone), and then its candidate blob. The next run starts
 * from no row, as if this one had not happened (ruling R8: a reclaimed row's history goes with it). Never throws: a
 * row that cannot be deleted lapses as a stale claim, and its reclaim deletes the candidate.
 */
async function releaseClaim(claim: DerivedClaim<"POSTER">, { mediaId, now }: { mediaId: string; now: Date }): Promise<void> {
  try {
    const released = await getDb().derivedMedia.deleteMany({ where: { id: claim.id, status: "PENDING", claimedAt: now, attempts: claim.attempts } });
    if (released.count === 1) {
      await quietDel(claim.storageKey, mediaId);
    }
  } catch (error) {
    logError("video poster claim could not be released", error, { category: "upload", mediaId });
  }
}
