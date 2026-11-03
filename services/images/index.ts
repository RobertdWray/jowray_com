import { SharpHeicImageService } from "@/integrations/images/sharp-heic";
import type { DeriveOptions, ImageService } from "@/services/images/types";

export type { DeriveOptions, DerivedSet, Encoded, ImageService } from "@/services/images/types";

/** Plan P2/P3 and the email plan's thumbnail spec (≤ 1000 px, JPEG q72 mozjpeg, ≤ 350 KB, #fffdf8). */
export const DERIVE_DEFAULTS: Omit<DeriveOptions, "sourceMime" | "deadlineMs"> = {
  maxPixels: 30_000_000,
  web: { maxEdge: 2048, quality: 85 },
  thumb: { maxEdge: 1000, quality: 72, fallbackQuality: 60, maxBytes: 350_000, background: "#fffdf8" },
};

let instance: ImageService | null = null;

export function createImageService(): ImageService {
  instance ??= new SharpHeicImageService();
  return instance;
}
