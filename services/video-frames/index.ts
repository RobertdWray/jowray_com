import "server-only";

import ffmpegPath from "ffmpeg-static";

import { FfmpegVideoFrameService } from "@/services/video-frames/frame-service";
import type { VideoFrameService } from "@/services/video-frames/types";

export { FfmpegVideoFrameService, type FfmpegVideoFrameServiceOptions } from "@/services/video-frames/frame-service";
export type {
  ExtractPosterInput, ExtractPosterResult, FrameSourceRead, PosterContainer, PosterWarning, TransferKind, VideoFrameErrorCode, VideoFrameService,
} from "@/services/video-frames/types";

let instance: VideoFrameService | null = null;

/**
 * The process's frame service on the `ffmpeg-static` binary (D9 pins 5.3.0). Only the poster feature imports this,
 * and only `/api/upload`, `/api/mcp` and the reconcile cron reach that feature, so the binary is traced into those
 * three functions alone (D1; `scripts/check-traces.ts` enforces it).
 */
export function createVideoFrameService(): VideoFrameService {
  instance ??= new FfmpegVideoFrameService({ binaryPath: ffmpegPath });
  return instance;
}
