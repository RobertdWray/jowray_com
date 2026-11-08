import "server-only";

import * as Sentry from "@sentry/nextjs";

import type { DeriveOutcome } from "@/features/memories/derive-media";
import { claimKind, type DerivedClaim, failClaims, isEligible, publishClaims } from "@/features/memories/derived-claims";
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
 * The least budget a poster is started with. Below it nothing is claimed, so no attempt is spent (premortem #5):
 * reading the headers, one or two ffmpeg runs and the re-encode need a few seconds, and a run that times out
 * costs the row one of its three attempts.
 */
export const POSTER_MIN_BUDGET_MS = 6_000;

/**
 * Kept back from ffmpeg for sharp. Re-encoding a frame of at most 1000 px takes tens of milliseconds, but libvips's
 * timeout counts whole seconds, so a frame that arrives with less than this left could not be encoded in time.
 */
const ENCODE_RESERVE_MS = 1_000;

/** A row's verdict, recorded by `failClaims`; `isEligible` alone decides which are retried (`decode_failed`, `timeout`). */
type PosterFailureCode = VideoFrameErrorCode;

/** What the original's first bytes and movie box say, read before anything is claimed. */
type Inspection =
  | { ok: true; size: number; container: PosterContainer; transferKind: TransferKind; track?: { codec: string; width: number; height: number } }
  | { ok: false; code: PosterFailureCode; detail: string; error?: Error };

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
 * Size, container and (for `mov`) the first video track. Never throws: a missing original or a store error is a
 * retryable `decode_failed`, a read cut off by `signal` (the deadline) is `timeout`, and the track reader's verdicts
 * map by ruling R6: `failed` (a malformed box) → retryable `decode_failed` with its error, `absent` → `no_video_stream`.
 * A declared track over MAX_VIDEO_PIXELS is refused before ffmpeg; a non-positive width or height is unknown, and
 * ffmpeg's own `-max_pixels` guards it (ruling R7).
 */
async function inspect(storage: StorageService, storageKey: string, signal: AbortSignal): Promise<Inspection> {
  const timedOut = (): Inspection => ({ ok: false, code: "timeout", detail: "reading the original's headers passed the deadline" });
  try {
    const head = await storage.head(storageKey, { signal });
    const prefix = head === null ? null : await storage.readPrefix(storageKey, SIGNATURE_PREFIX_BYTES, { signal });
    if (head === null || prefix === null) {
      return { ok: false, code: "decode_failed", detail: "the original is not in the store" };
    }
    const container = containerOf(prefix);
    if (container === null) {
      return { ok: false, code: "unsupported_type", detail: "the bytes are neither QuickTime/ISO BMFF nor Matroska/WebM" };
    }
    if (container === "matroska") {
      return { ok: true, size: head.size, container, transferKind: "unknown" };
    }
    const info = await readVideoTrackInfo((offset, length) => readOriginal(storage, storageKey, head.size, offset, length, signal), head.size);
    if (info.status === "failed") {
      return signal.aborted ? timedOut() : { ok: false, code: "decode_failed", detail: info.reason, error: info.error };
    }
    if (info.status === "absent") {
      return { ok: false, code: "no_video_stream", detail: info.reason };
    }
    const { codec, width, height, transferKind } = info.track;
    if (width > 0 && height > 0 && width * height > MAX_VIDEO_PIXELS) {
      return { ok: false, code: tooManyPixelsCode(MAX_VIDEO_PIXELS), detail: `the ${codec} track declares ${width}×${height}` };
    }
    return { ok: true, size: head.size, container, transferKind, track: { codec, width, height } };
  } catch (error) {
    return signal.aborted ? timedOut() : { ok: false, code: "decode_failed", detail: toError(error).message, error: toError(error) };
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
 *    `claimed_elsewhere` for a live claim), with nothing read.
 * 2. Preflight, before any claim: the binary is available, the image slot is ours, and at least
 *    POSTER_MIN_BUDGET_MS is left. A miss is `deferred`: nothing is claimed, so no attempt is spent, and the cron
 *    comes back. The slot is held from here through ffmpeg AND sharp: a 4K frame costs ffmpeg about 280 MB, so one
 *    heavy decode runs per process.
 * 3. Inspect: `storage.head` for the size, the first 128 bytes for the container and, for `mov`, the first video
 *    track (pixel ceiling, HDR transfer). If that leaves less than the floor, `deferred` again, still unclaimed.
 * 4. Claim the POSTER row with a fresh `.jpg` key ([C35], the shared protocol). An inspection verdict is recorded on
 *    the claim; otherwise ffmpeg extracts the frame inside a `media.poster` span [C24], within the budget less the
 *    encoder's reserve, reading the original only through bounded range reads (D2).
 * 5. sharp re-encodes the frame at the thumbnail spec [C21] (D4), the slot is released, the JPEG is written to the
 *    claimed key, and the claim is published under the memory lock with no `whileLocked`: a poster never writes the
 *    Media row, whose `updatedAt` feeds `reviewVersion` (D6, [C36]). A video removed meanwhile is not resurrected.
 *
 * Failures: `no_video_stream`, `no_frame`, `source_limit`, `unsupported_type`, `too_many_pixels:<n>` and `too_large`
 * are final; `decode_failed` and `timeout` are retried up to MAX_DECODE_ATTEMPTS (`isEligible`). When ffmpeg cannot
 * run after the claim (the binary vanished, the loopback server failed), our PENDING row is deleted and the result is
 * `deferred`. Never throws.
 */
export async function derivePoster({ mediaId, deadlineMs, now = new Date() }: { mediaId: string; deadlineMs: number; now?: Date }): Promise<DeriveOutcome> {
  const startedAt = Date.now();
  const deadlineAt = startedAt + deadlineMs;
  const remainingMs = () => deadlineAt - Date.now();
  let slot: DeriveSlot | null = null;
  let claim: DerivedClaim<"POSTER"> | null = null;
  let inspectTimer: ReturnType<typeof setTimeout> | undefined;
  /** What every log line of this run carries, filled in as it is learnt. */
  const run: Record<string, unknown> = { mediaId };

  const deferred = (code: string, message: string): DeriveOutcome => {
    log.info({ action: "poster_deferred", ...run, code, durationMs: Date.now() - startedAt }, message);
    return "deferred";
  };

  /** Record a verdict on our claim (conditionally; only the candidate still ours is deleted) and log it. */
  const fail = async (held: DerivedClaim<"POSTER">, code: PosterFailureCode, details: { detail: string; error?: Error; stderrTail?: string }): Promise<DeriveOutcome> => {
    await failClaims([held], { mediaId, now, error: code });
    const fields = { action: "poster_failed", ...run, code, detail: details.detail, stderrTail: details.stderrTail, durationMs: Date.now() - startedAt };
    if (details.error) {
      logError("video poster failed", details.error, { category: "upload", ...fields });
    } else {
      log.warn(fields, "video poster could not be made");
    }
    return "failed";
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
    const verdict = isEligible(existing, now, MAX_VIDEO_PIXELS);
    if (verdict === "not_eligible" || verdict === "claimed_elsewhere") {
      return verdict;
    }

    // 2. Preflight: nothing below is claimed until all three hold.
    const frames = createVideoFrameService();
    if (!(await frames.available())) {
      // A deployment defect (a trace-key miss, a skipped install script, a lost exec bit): reported every time.
      logError("video poster deferred", new PosterEnvironmentError("the ffmpeg binary is missing or not executable"), { category: "upload", action: "poster_deferred", ...run });
      return "deferred";
    }
    try {
      slot = await createImageService().acquire(remainingMs());
    } catch (error) {
      if (isImageDeriveError(error) && (error.code === "busy" || error.code === "timeout")) {
        return deferred(error.code, "image slot not available; left to the cron");
      }
      throw error;
    }
    if (remainingMs() < POSTER_MIN_BUDGET_MS) {
      return deferred("budget", "too little budget left to start a poster; left to the cron");
    }

    // 3. Inspect, within the deadline; a stalled read is aborted, not waited for.
    const controller = new AbortController();
    inspectTimer = setTimeout(() => controller.abort(), Math.max(0, remainingMs()));
    const inspection = await inspect(storage, row.storageKey, controller.signal);
    clearTimeout(inspectTimer);
    if (inspection.ok) {
      Object.assign(run, { container: inspection.container, transferKind: inspection.transferKind, ...inspection.track });
      if (remainingMs() < POSTER_MIN_BUDGET_MS) {
        return deferred("budget", "reading the headers left too little budget; left to the cron");
      }
    }

    // 4. Claim; the claim must exist before any verdict can be recorded.
    const claimed = await claimKind({ mediaId, kind: "POSTER", existing, originalKey: row.storageKey, extension: "jpg", now, maxPixels: MAX_VIDEO_PIXELS });
    if (!("claim" in claimed)) {
      if (claimed.outcome === "failed") {
        log.warn({ action: "poster_abandoned", ...run }, "stale poster claim had used up its attempts");
      }
      return claimed.outcome;
    }
    claim = claimed.claim;
    if (!inspection.ok) {
      const { code, detail, error } = inspection;
      claim = null;
      return await fail(claimed.claim, code, { detail, error });
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
    run.sourceBytesRead = extraction.sourceBytesRead;

    if (!extraction.ok) {
      if (extraction.code === "deferred") {
        // ffmpeg could not run here after all: give the row back as we found it, with no attempt spent.
        const held = claim;
        claim = null;
        await releaseClaim(held, { mediaId, now });
        logError("video poster deferred", extraction.error ?? new PosterEnvironmentError(extraction.detail), { category: "upload", action: "poster_deferred", ...run, detail: extraction.detail, stderrTail: extraction.stderrTail, durationMs: Date.now() - startedAt });
        return "deferred";
      }
      const held = claim;
      claim = null;
      return await fail(held, extraction.code, { detail: extraction.detail, error: extraction.error, stderrTail: extraction.stderrTail });
    }
    Object.assign(run, { toneMapped: extraction.toneMapped, seekSeconds: extraction.seekSeconds, warning: extraction.warning });

    // 5. Re-encode while the slot is still ours (the slot does not refuse a spent deadline, so check first).
    if (remainingMs() <= 0) {
      const held = claim;
      claim = null;
      return await fail(held, "timeout", { detail: "ffmpeg used the whole budget; none was left to re-encode the frame" });
    }
    const { thumb } = await slot.thumbnail(extraction.png, { sourceMime: "image/png", deadlineMs: remainingMs(), maxPixels: MAX_VIDEO_PIXELS, thumb: DERIVE_DEFAULTS.thumb });
    slot.release();
    slot = null;

    if (!("failed" in thumb)) {
      await storage.put(claim.storageKey, thumb.data, thumb.mimeType);
    }
    // Under the memory lock, conditional on this exact claim; no `whileLocked`, so the Media row is never written (D6).
    const outcomes = await publishClaims({ mediaId, memoryId: row.memoryId, claims: [claim], now, encodedFor: () => thumb });
    const published = outcomes.POSTER;
    if (published === undefined) {
      throw new Error("publishClaims returned no POSTER outcome for the claim it was given");
    }
    claim = null;
    const fields = { ...run, outcome: published, durationMs: Date.now() - startedAt };
    if (published === "derived") {
      log.info({ action: "poster_derived", ...fields }, "video poster recorded");
    } else if (published === "failed") {
      log.warn({ action: "poster_failed", ...fields, code: "too_large" }, "video poster is over the thumbnail budget even at the fallback quality");
    } else {
      log.info({ action: "poster_dropped", ...fields }, "video removed or poster claim taken over while it was made; nothing published");
    }
    return published;
  } catch (error) {
    if (claim !== null) {
      const code = frameVerdict(error);
      if (code !== null) {
        return await fail(claim, code, { detail: toError(error).message });
      }
      return await fail(claim, "decode_failed", { detail: toError(error).message, error: toError(error) });
    }
    // Nothing claimed, so nothing spent: the cron comes back.
    logError("video poster failed before its claim", error, { category: "upload", ...run, durationMs: Date.now() - startedAt });
    return "deferred";
  } finally {
    clearTimeout(inspectTimer);
    slot?.release();
  }
}

/**
 * Delete our PENDING row, only while it is still exactly our claim, so the next run starts from no row. Never throws:
 * a row that cannot be deleted lapses as a stale claim and is reclaimed.
 */
async function releaseClaim(claim: DerivedClaim<"POSTER">, { mediaId, now }: { mediaId: string; now: Date }): Promise<void> {
  try {
    await getDb().derivedMedia.deleteMany({ where: { id: claim.id, status: "PENDING", claimedAt: now, attempts: claim.attempts } });
  } catch (error) {
    logError("video poster claim could not be released", error, { category: "upload", mediaId });
  }
}
