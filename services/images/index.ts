import "server-only";

import { SharpHeicImageService } from "@/integrations/images/sharp-heic";
import type { DeriveOptions, ImageService } from "@/services/images/types";

export type { DeriveOptions, DerivedSet, DeriveSlot, Encoded, ImageService } from "@/services/images/types";

/**
 * Plan P2/P3 and the email plan's thumbnail spec (≤ 1000 px, JPEG q72 mozjpeg, ≤ 350 KB, #fffdf8).
 * `maxFrames` (issue #45): a 30 MP ceiling bounds an animation's pixels, but GIF
 * re-encoding costs far more CPU per pixel than a photo, so frames are capped too;
 * over either, the copies are a still of the first frame, never a failure.
 */
export const DERIVE_DEFAULTS: Omit<DeriveOptions, "sourceMime" | "deadlineMs"> = {
  maxPixels: 30_000_000,
  maxFrames: 300,
  web: { maxEdge: 2048, quality: 85 },
  thumb: { maxEdge: 1000, quality: 72, fallbackQuality: 60, maxBytes: 350_000, background: "#fffdf8" },
};

/**
 * Callers that may wait for the decode slot at once (issue #45). Beyond this
 * `acquire` answers `busy` and the caller leaves the photo to cron step (g),
 * so a burst of finalizations never piles originals up in one instance's heap.
 */
export const MAX_WAITING_DERIVATIONS = 2;

let instance: ImageService | null = null;

export function createImageService(): ImageService {
  instance ??= new SharpHeicImageService(MAX_WAITING_DERIVATIONS);
  return instance;
}

/** File extension of the web copy for an original's MIME (the thumbnail is always `jpg`). */
export function webExtensionFor(sourceMime: string): "jpg" | "png" | "webp" | "gif" {
  switch (sourceMime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "jpg";
  }
}
