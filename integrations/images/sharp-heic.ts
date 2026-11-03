import "server-only";

import type { Sharp } from "sharp";

import { decodeHeicInWorker } from "@/lib/heic-worker";
import { ImageDeriveError } from "@/lib/image-derive-error";
import type { DeriveOptions, DerivedSet, Encoded, ImageService } from "@/services/images/types";

type Family = "jpeg" | "png" | "webp" | "gif";

const FAMILY: Record<string, Family> = {
  "image/jpeg": "jpeg",
  "image/heic": "jpeg",
  "image/heif": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const EXTENSION: Record<Family, string> = { jpeg: "jpg", png: "png", webp: "webp", gif: "gif" };
const MIME: Record<Family, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

function isPixelLimitError(error: unknown): boolean {
  return error instanceof Error && /pixel limit/i.test(error.message);
}

/**
 * sharp for everything it can decode (JPEG, PNG, WebP, GIF) and for every
 * encode; HEIC/HEIF pixels come from libheif in a worker thread. One
 * derivation at a time per process: a Fluid instance shares one heap and a
 * 24 MP decode peaks near 0.8 GB.
 */
export class SharpHeicImageService implements ImageService {
  private queue: Promise<unknown> = Promise.resolve();
  private running = 0;

  inFlight(): number {
    return this.running;
  }

  derive(input: Buffer, options: DeriveOptions): Promise<DerivedSet> {
    const run = this.queue.then(() => {
      this.running += 1;
      return this.deriveNow(input, options).finally(() => {
        this.running -= 1;
      });
    });
    // Keep the chain alive whatever this derivation does.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async deriveNow(input: Buffer, options: DeriveOptions): Promise<DerivedSet> {
    const family = FAMILY[options.sourceMime];
    if (!family) {
      throw new ImageDeriveError("unsupported_type");
    }
    // Lazy: no route, prerender or build ever loads libvips until a copy is made.
    const sharp = (await import("sharp")).default;

    let base: Sharp;
    let thumbSource: Sharp;
    let sourceWidth: number;
    let sourceHeight: number;
    try {
      if (options.sourceMime === "image/heic" || options.sourceMime === "image/heif") {
        const rgba = await decodeHeicInWorker(input, { deadlineMs: options.deadlineMs, maxPixels: options.maxPixels });
        const raw = { width: rgba.width, height: rgba.height, channels: 4 as const };
        const pixels = Buffer.from(rgba.data.buffer, rgba.data.byteOffset, rgba.data.byteLength);
        base = sharp(pixels, { raw });
        thumbSource = sharp(pixels, { raw });
        sourceWidth = rgba.width;
        sourceHeight = rgba.height;
      } else if (family === "gif") {
        base = sharp(input, { animated: true, limitInputPixels: options.maxPixels });
        thumbSource = sharp(input, { page: 0, limitInputPixels: options.maxPixels });
        const meta = await base.metadata();
        sourceWidth = meta.width;
        sourceHeight = meta.pageHeight ?? meta.height;
      } else {
        base = sharp(input, { limitInputPixels: options.maxPixels }).rotate();
        thumbSource = sharp(input, { limitInputPixels: options.maxPixels }).rotate();
        const meta = await sharp(input, { limitInputPixels: options.maxPixels }).metadata();
        const swapped = (meta.orientation ?? 1) >= 5;
        sourceWidth = swapped ? meta.height : meta.width;
        sourceHeight = swapped ? meta.width : meta.height;
      }

      const web = await this.encodeWeb(base, family, options);
      const thumb = await this.encodeThumb(thumbSource, options);
      return { sourceWidth, sourceHeight, web, thumb };
    } catch (error) {
      if (error instanceof ImageDeriveError) {
        throw error;
      }
      if (isPixelLimitError(error)) {
        throw new ImageDeriveError("too_many_pixels", { limit: options.maxPixels, cause: error });
      }
      throw new ImageDeriveError("decode_failed", { cause: error });
    }
  }

  private async encodeWeb(base: Sharp, family: Family, { web }: DeriveOptions): Promise<Encoded> {
    let pipeline = base.clone();
    if (family === "gif") {
      // Animated: constrain the width only; every page keeps its aspect.
      pipeline = pipeline.resize({ width: web.maxEdge, withoutEnlargement: true }).gif();
    } else {
      pipeline = pipeline.resize({ width: web.maxEdge, height: web.maxEdge, fit: "inside", withoutEnlargement: true });
      pipeline = family === "jpeg" ? pipeline.jpeg({ quality: web.quality }) : family === "png" ? pipeline.png() : pipeline.webp({ quality: web.quality });
    }
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { data, mimeType: MIME[family], extension: EXTENSION[family], width: info.width, height: info.pageHeight ?? info.height };
  }

  private async encodeThumb(source: Sharp, { thumb }: DeriveOptions): Promise<Encoded | { failed: "too_large" }> {
    const resized = source
      .clone()
      .flatten({ background: thumb.background })
      .resize({ width: thumb.maxEdge, height: thumb.maxEdge, fit: "inside", withoutEnlargement: true });
    for (const quality of [thumb.quality, thumb.fallbackQuality]) {
      const { data, info } = await resized.clone().jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      if (data.byteLength <= thumb.maxBytes) {
        return { data, mimeType: "image/jpeg", extension: "jpg", width: info.width, height: info.height };
      }
    }
    return { failed: "too_large" };
  }
}
