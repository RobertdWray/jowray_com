import type { PosterContainer, VideoFrameErrorCode } from "@/lib/video-frames";
import type { TransferKind } from "@/lib/video-track";

export type { PosterContainer, TransferKind, VideoFrameErrorCode };

/** Reads exactly `length` bytes of the original at `offset`; `signal` fires when the bytes are no longer wanted. */
export type FrameSourceRead = (offset: number, length: number, signal: AbortSignal) => Promise<Uint8Array>;

export interface ExtractPosterInput {
  /** The original's exact byte size (from `storage.head`); `read` is never asked past it. */
  size: number;
  read: FrameSourceRead;
  /** The demuxer to force, from the caller's own sniff of the first bytes. */
  container: PosterContainer;
  /** From `readVideoTrackInfo`; `hlg` and `pq` are tone-mapped to SDR, anything else is left as decoded (D5). */
  transferKind: TransferKind;
  /** The whole call's budget, filter detection and the retry at 0 s included. */
  deadlineMs: number;
  /** Aborting it kills ffmpeg; the result is `timeout`. */
  signal?: AbortSignal;
}

/** `hdr_untonemapped`: the input is HLG or PQ but this binary has no `zscale`, so the frame was left untouched. */
export type PosterWarning = "hdr_untonemapped";

export type ExtractPosterResult =
  | {
      ok: true;
      /** One PNG frame, its long edge ≤ 1000 px (never upscaled), autorotated. */
      png: Buffer;
      /** Every byte asked of `read`, across every request and both seeks. */
      sourceBytesRead: number;
      toneMapped: boolean;
      /** 1 when the keyframe at or before 1 s decoded, 0 when that gave nothing and the retry at 0 s did (D3). */
      seekSeconds: 1 | 0;
      warning?: PosterWarning;
    }
  | {
      ok: false;
      /** `deferred`: ffmpeg could not be run here (no binary, spawn or listen failure); no attempt should be spent. */
      code: VideoFrameErrorCode | "deferred";
      /** One line for the log; it never holds a bearer value (the only URL is the loopback nonce). */
      detail: string;
      sourceBytesRead: number;
      /** The end of ffmpeg's stderr, when it wrote any. */
      stderrTail?: string;
      /** What was thrown, when something threw: a failed `read`, a listen error. Log it with its stack. */
      error?: Error;
    };

export interface VideoFrameService {
  /** Whether the ffmpeg binary exists and is executable (`fs.access(path, X_OK)`). Never throws. */
  available(): Promise<boolean>;
  /** One poster frame from a private original, read only through `read`. Never rejects. */
  extractPoster(input: ExtractPosterInput): Promise<ExtractPosterResult>;
}
