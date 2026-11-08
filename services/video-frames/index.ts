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
 * `ffmpeg-static`'s override: when it is set as the package loads, the package returns its value instead of its own
 * binary's path (`binary-path-env-var` in its `package.json`). The package loads with this module, and the process's
 * environment is fixed from its start (Vercel's and `next dev`'s alike), so reading it at call time sees what the
 * package saw.
 */
const BINARY_OVERRIDE_ENV = "FFMPEG_BIN";

/**
 * The process's frame service on the `ffmpeg-static` binary (D9 pins 5.3.0). Only the poster feature imports this,
 * and only `/api/upload`, `/api/mcp` and the reconcile cron reach that feature, so the binary is traced into those
 * three functions alone (D1; `scripts/check-traces.ts` enforces it).
 *
 * Throws while `FFMPEG_BIN` is set, in every environment (TCR B1-1): `check-traces` verifies the package's own binary
 * against its pinned SHA-256, and an override would run a file nobody verified or traced. The refusal is never cached;
 * derivePoster reports it and defers without claiming, so posters wait until the variable is removed.
 */
export function createVideoFrameService(): VideoFrameService {
  if (process.env[BINARY_OVERRIDE_ENV]) {
    throw new Error(
      `${BINARY_OVERRIDE_ENV} is set, so ffmpeg-static would hand the poster code that file instead of its own binary, the one check-traces verifies against its pinned SHA-256. Unset ${BINARY_OVERRIDE_ENV} (docs/dependencies.md); posters are deferred until then.`,
    );
  }
  instance ??= new FfmpegVideoFrameService({ binaryPath: ffmpegPath });
  return instance;
}
