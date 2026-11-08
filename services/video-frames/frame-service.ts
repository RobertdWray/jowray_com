import "server-only";

import { access, constants } from "node:fs/promises";

import { buildFrameArgs, detectZscale, runFfmpeg, type FfmpegRunOutcome } from "@/integrations/video-frames/ffmpeg";
import { FrameSourceError, startFrameServer, type FrameRequestInfo, type FrameServer } from "@/integrations/video-frames/frame-server";
import { MAX_VIDEO_PIXELS, tooManyPixelsCode } from "@/lib/video-frames";
import type { ExtractPosterInput, ExtractPosterResult, PosterWarning, VideoFrameService } from "@/services/video-frames/types";

export interface FfmpegVideoFrameServiceOptions {
  /** The ffmpeg executable; `null` when `ffmpeg-static` has no binary for this platform. */
  binaryPath: string | null;
  /** Defaults to `WINDOW_BYTES`. */
  windowBytes?: number;
  /** Defaults to `MAX_SOURCE_BYTES`. */
  maxSourceBytes?: number;
  /** Defaults to `MAX_VIDEO_PIXELS`. */
  maxPixels?: number;
  /** Diagnostics: every request the frame server answers. */
  onRequest?: (info: FrameRequestInfo) => void;
}

type Failure = Extract<ExtractPosterResult, { ok: false }>;

/** The filter check gets at most this long, within the caller's budget. */
const FILTER_CHECK_MS = 5000;

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Poster frames through the loopback frame server and the ffmpeg runner (video-posters plan D2, D3, D5).
 *
 * One call starts one frame server for the original, runs ffmpeg at `-ss 1` and, when that exits cleanly with no
 * frame, once more at `-ss 0`; both runs share the server, so the source cap and `sourceBytesRead` cover both. The
 * server is closed, its sockets destroyed and its reads aborted on every path out. Failures map to codes:
 * - the source cap → `source_limit`; a failed `read`, or an exception answering a request → `decode_failed` with the
 *   error; the loopback server's own error after listening (an `accept` failure) → `deferred` with the error;
 * - the deadline or the caller's signal → `timeout` (the child is SIGKILLed);
 * - no binary, or a spawn or listen failure → `deferred`;
 * - ffmpeg's pixel refusal → `too_many_pixels:<maxPixels>`; no video stream → `no_video_stream`;
 * - any other non-zero exit, an oversized or non-PNG stdout → `decode_failed`; two empty runs → `no_frame`.
 */
export class FfmpegVideoFrameService implements VideoFrameService {
  readonly binaryPath: string | null;
  readonly maxPixels: number;
  private readonly windowBytes: number | undefined;
  private readonly maxSourceBytes: number | undefined;
  private readonly onRequest: ((info: FrameRequestInfo) => void) | undefined;

  constructor(options: FfmpegVideoFrameServiceOptions) {
    this.binaryPath = options.binaryPath;
    this.maxPixels = options.maxPixels ?? MAX_VIDEO_PIXELS;
    this.windowBytes = options.windowBytes;
    this.maxSourceBytes = options.maxSourceBytes;
    this.onRequest = options.onRequest;
  }

  async available(): Promise<boolean> {
    if (this.binaryPath === null) {
      return false;
    }
    try {
      await access(this.binaryPath, constants.X_OK);
      return true;
    } catch {
      // Missing or not executable: exactly what this method reports.
      return false;
    }
  }

  async extractPoster(input: ExtractPosterInput): Promise<ExtractPosterResult> {
    const deadline = performance.now() + input.deadlineMs;
    const remaining = () => Math.floor(deadline - performance.now());
    const fail = (code: Failure["code"], detail: string, extra: Partial<Failure> = {}): Failure => ({ ok: false, code, detail, sourceBytesRead: 0, ...extra });

    const binary = this.binaryPath;
    if (binary === null) {
      return fail("deferred", "ffmpeg-static has no binary for this platform");
    }
    if (input.signal?.aborted) {
      return fail("timeout", `aborted before the run: ${messageOf(input.signal.reason)}`);
    }
    const budget = remaining();
    if (!Number.isFinite(budget) || budget <= 0) {
      return fail("timeout", `no time left before the run (deadlineMs ${input.deadlineMs})`);
    }
    if (!Number.isSafeInteger(input.size) || input.size <= 0) {
      return fail("decode_failed", `the original's size ${input.size} cannot be served`);
    }

    let toneMap = false;
    let warning: PosterWarning | undefined;
    if (input.transferKind === "hlg" || input.transferKind === "pq") {
      const check = await detectZscale(binary, { timeoutMs: Math.min(FILTER_CHECK_MS, remaining()), signal: input.signal });
      if (check.kind === "exited") {
        // Listing filters cannot fail on a sound binary: an environment problem, not this video's.
        return fail("deferred", `ffmpeg -filters failed (${check.signal ? `signal ${check.signal}` : `exit ${check.exitCode}`})`, { stderrTail: check.stderrTail || undefined });
      }
      if (check.kind !== "known") {
        return this.failedRun(check, "filter check", fail);
      }
      toneMap = check.zscale;
      warning = check.zscale ? undefined : "hdr_untonemapped";
    }

    let server: FrameServer;
    try {
      server = await startFrameServer({
        size: input.size,
        read: input.read,
        signal: input.signal,
        windowBytes: this.windowBytes,
        maxSourceBytes: this.maxSourceBytes,
        onRequest: this.onRequest,
      });
    } catch (error) {
      return fail("deferred", `the frame server could not listen: ${messageOf(error)}`, { error: error instanceof Error ? error : new Error(String(error)) });
    }

    try {
      const signal = input.signal ? AbortSignal.any([input.signal, server.failure]) : server.failure;
      for (const seekSeconds of [1, 0] as const) {
        const timeoutMs = remaining();
        if (timeoutMs <= 0) {
          return fail("timeout", `the deadline passed before the run at ${seekSeconds} s`, { sourceBytesRead: server.bytesRead });
        }
        const args = buildFrameArgs({ url: server.url, container: input.container, seekSeconds, toneMap, maxPixels: this.maxPixels });
        const outcome = await runFfmpeg(binary, args, { timeoutMs, signal });
        const sourceBytesRead = server.bytesRead;
        if (server.failure.aborted) {
          // The source's own failure explains whatever ffmpeg did after it.
          const reason: unknown = server.failure.reason;
          const stderrTail = "stderrTail" in outcome && outcome.stderrTail ? outcome.stderrTail : undefined;
          if (reason instanceof FrameSourceError && reason.kind === "source_limit") {
            return fail("source_limit", reason.message, { sourceBytesRead, stderrTail });
          }
          if (reason instanceof FrameSourceError && reason.kind === "server_error") {
            // The loopback server itself failed (EMFILE on accept, …): this instance's trouble, not the video's.
            return fail("deferred", reason.message, { sourceBytesRead, stderrTail, error: reason });
          }
          const error = reason instanceof Error ? reason : new Error(String(reason));
          return fail("decode_failed", `the frame source failed: ${error.message}`, { sourceBytesRead, stderrTail, error });
        }
        if (outcome.kind === "frame") {
          return { ok: true, png: outcome.png, sourceBytesRead, toneMapped: toneMap, seekSeconds, ...(warning ? { warning } : {}) };
        }
        if (outcome.kind !== "empty") {
          return { ...this.failedRun(outcome, `run at ${seekSeconds} s`, fail), sourceBytesRead };
        }
      }
      return fail("no_frame", "ffmpeg wrote no frame at 1 s or at 0 s", { sourceBytesRead: server.bytesRead });
    } finally {
      await server.close();
    }
  }

  private failedRun(outcome: Exclude<FfmpegRunOutcome, { kind: "frame" | "empty" }>, step: string, fail: (code: Failure["code"], detail: string, extra?: Partial<Failure>) => Failure): Failure {
    const stderrTail = "stderrTail" in outcome && outcome.stderrTail ? outcome.stderrTail : undefined;
    switch (outcome.kind) {
      case "spawn_failed":
        return fail("deferred", `ffmpeg could not start (${outcome.code}) for the ${step}: ${outcome.message}`);
      case "timed_out":
        return fail("timeout", `ffmpeg passed the deadline in the ${step} and was killed`, { stderrTail });
      case "aborted":
        return fail("timeout", `the caller aborted the ${step}: ${messageOf(outcome.reason)}`, { stderrTail });
      case "exited": {
        const how = outcome.signal ? `signal ${outcome.signal}` : `exit ${outcome.exitCode}`;
        switch (outcome.reason) {
          case "pixel_limit":
            return fail(tooManyPixelsCode(this.maxPixels), `ffmpeg refused a frame over ${this.maxPixels} pixels (${how})`, { stderrTail });
          case "no_video_stream":
            return fail("no_video_stream", `the input has no video stream (${how})`, { stderrTail });
          case "output_limit":
            return fail("decode_failed", `the frame overflowed ffmpeg's output buffer (${how})`, { stderrTail });
          case "not_png":
            return fail("decode_failed", "ffmpeg wrote something other than a PNG", { stderrTail });
          case "error":
            return fail("decode_failed", `ffmpeg failed in the ${step} (${how})`, { stderrTail });
        }
      }
    }
  }
}
