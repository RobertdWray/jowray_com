import "server-only";

import type { Sharp } from "sharp";

import { decodeHeicInWorker } from "@/lib/heic-worker";
import { ImageDeriveError } from "@/lib/image-derive-error";
import type { DeriveOptions, DerivedSet, DeriveSlot, Encoded, ImageService } from "@/services/images/types";

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

interface Waiter {
  grant: () => void;
  fail: (error: ImageDeriveError) => void;
}

/**
 * sharp for everything it can decode (JPEG, PNG, WebP, GIF) and for every
 * encode; HEIC/HEIF pixels come from libheif in a worker thread. One
 * derivation at a time per process: a Fluid instance shares one heap and a
 * 24 MP decode peaks near 0.8 GB. The slot is acquired *before* the original
 * is downloaded (issue #45) and the waiting line is short, so a burst of
 * finalizations holds at most `1 + maxWaiting` originals in memory; the rest
 * are answered `busy` at once and left to the cron.
 */
export class SharpHeicImageService implements ImageService {
  private running = 0;
  private readonly waiters: Waiter[] = [];

  constructor(private readonly maxWaiting: number = 2) {}

  inFlight(): number {
    return this.running;
  }

  waiting(): number {
    return this.waiters.length;
  }

  acquire(deadlineMs: number): Promise<DeriveSlot> {
    if (this.running === 0 && this.waiters.length === 0) {
      this.running = 1;
      return Promise.resolve(this.slot());
    }
    if (this.waiters.length >= this.maxWaiting) {
      return Promise.reject(new ImageDeriveError("busy"));
    }
    return new Promise<DeriveSlot>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) {
          this.waiters.splice(index, 1);
        }
        reject(new ImageDeriveError("timeout"));
      }, Math.max(0, deadlineMs));
      const waiter: Waiter = {
        grant: () => {
          clearTimeout(timer);
          this.running = 1;
          resolve(this.slot());
        },
        fail: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.waiters.push(waiter);
    });
  }

  private slot(): DeriveSlot {
    let released = false;
    return {
      derive: (input, options) => {
        if (released) {
          return Promise.reject(new Error("derive slot already released"));
        }
        return this.deriveNow(input, options);
      },
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.running = 0;
        const next = this.waiters.shift();
        if (next) {
          next.grant();
        }
      },
    };
  }

  async derive(input: Buffer, options: DeriveOptions): Promise<DerivedSet> {
    // The deadline is absolute from the call: time spent waiting for the slot counts.
    const deadlineAt = Date.now() + options.deadlineMs;
    const slot = await this.acquire(options.deadlineMs);
    try {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        throw new ImageDeriveError("timeout");
      }
      return await slot.derive(input, { ...options, deadlineMs: remainingMs });
    } finally {
      slot.release();
    }
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
    // libvips stops a pipeline that runs past this (native formats; HEIC has the worker's own deadline).
    const timeout = { seconds: Math.max(1, Math.ceil(options.deadlineMs / 1000)) };
    try {
      if (options.sourceMime === "image/heic" || options.sourceMime === "image/heif") {
        const rgba = await decodeHeicInWorker(input, { deadlineMs: options.deadlineMs, maxPixels: options.maxPixels });
        const raw = { width: rgba.width, height: rgba.height, channels: 4 as const };
        const pixels = Buffer.from(rgba.data.buffer, rgba.data.byteOffset, rgba.data.byteLength);
        base = sharp(pixels, { raw }).timeout(timeout);
        thumbSource = sharp(pixels, { raw }).timeout(timeout);
        sourceWidth = rgba.width;
        sourceHeight = rgba.height;
      } else {
        // The declared type chooses the output; the bytes choose libvips's loader. They must agree,
        // or an SVG/TIFF/anything-else file labelled as a photo would reach a loader we never meant to expose.
        const meta = await sharp(input, { limitInputPixels: options.maxPixels }).metadata();
        if (meta.format !== family) {
          throw new ImageDeriveError("unsupported_type");
        }
        if (family === "gif") {
          // Header-only checks before any frame is decoded (issue #45): the frame count, and the
          // pixel ceiling applied to the whole strip libvips will build for `animated: true`.
          const frames = meta.pages ?? 1;
          const frameHeight = meta.pageHeight ?? meta.height;
          if (frames > options.maxFrames) {
            throw new ImageDeriveError("too_many_frames", { limit: options.maxFrames });
          }
          if (meta.width * frameHeight * frames > options.maxPixels) {
            throw new ImageDeriveError("too_many_pixels", { limit: options.maxPixels });
          }
          base = sharp(input, { animated: true, limitInputPixels: options.maxPixels }).timeout(timeout);
          thumbSource = sharp(input, { page: 0, limitInputPixels: options.maxPixels }).timeout(timeout);
          sourceWidth = meta.width;
          sourceHeight = frameHeight;
        } else {
          base = sharp(input, { limitInputPixels: options.maxPixels }).rotate().timeout(timeout);
          thumbSource = sharp(input, { limitInputPixels: options.maxPixels }).rotate().timeout(timeout);
          const swapped = (meta.orientation ?? 1) >= 5;
          sourceWidth = swapped ? meta.height : meta.width;
          sourceHeight = swapped ? meta.width : meta.height;
        }
      }

      const web = await this.encodeWeb(base, family, options, { width: sourceWidth, height: sourceHeight });
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

  private async encodeWeb(base: Sharp, family: Family, { web }: DeriveOptions, source: { width: number; height: number }): Promise<Encoded> {
    let pipeline = base.clone();
    if (family === "gif") {
      // Animated: libvips resizes the whole frame strip, so the long edge is capped through the width
      // using the per-frame height; never enlarged.
      const scale = Math.min(1, web.maxEdge / Math.max(source.width, source.height));
      pipeline = pipeline.resize({ width: Math.max(1, Math.round(source.width * scale)) }).gif();
    } else {
      pipeline = pipeline.resize({ width: web.maxEdge, height: web.maxEdge, fit: "inside", withoutEnlargement: true });
      pipeline = family === "jpeg" ? pipeline.jpeg({ quality: web.quality }) : family === "png" ? pipeline.png() : pipeline.webp({ quality: web.quality });
    }
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { data, mimeType: MIME[family], extension: EXTENSION[family], width: info.width, height: info.pageHeight ?? info.height };
  }

  private async encodeThumb(source: Sharp, { thumb }: DeriveOptions): Promise<Encoded | { failed: "too_large" }> {
    // Decode, flatten and resize once; the quality retry re-encodes the small raw result, not the original.
    const { data: raw, info } = await source
      .clone()
      .flatten({ background: thumb.background })
      .resize({ width: thumb.maxEdge, height: thumb.maxEdge, fit: "inside", withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const sharp = (await import("sharp")).default;
    for (const quality of [thumb.quality, thumb.fallbackQuality]) {
      const data = await sharp(raw, { raw: { width: info.width, height: info.height, channels: info.channels } }).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (data.byteLength <= thumb.maxBytes) {
        return { data, mimeType: "image/jpeg", extension: "jpg", width: info.width, height: info.height };
      }
    }
    return { failed: "too_large" };
  }
}
