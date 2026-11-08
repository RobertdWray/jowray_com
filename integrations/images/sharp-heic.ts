import "server-only";

import type { Sharp } from "sharp";

import { decodeHeicInWorker } from "@/lib/heic-worker";
import { ImageDeriveError } from "@/lib/image-derive-error";
import type { DeriveOptions, DerivedSet, DeriveSlot, Encoded, ImageService, ThumbnailOptions, ThumbnailSet } from "@/services/images/types";

type Family = "jpeg" | "png" | "webp" | "gif";

/** What the shared decode step reads; `DeriveOptions` and `ThumbnailOptions` both carry it. */
type DecodeOptions = Pick<DeriveOptions, "sourceMime" | "deadlineMs" | "maxPixels">;

/**
 * An original whose bytes matched its label and whose frame is within the
 * pixel ceiling. Each builder returns a new pipeline over it, so an encoder
 * never pays for a pipeline it does not use.
 */
interface Decoded {
  family: Family;
  /** Upright dimensions of one frame of the original. */
  sourceWidth: number;
  sourceHeight: number;
  /** The whole original, for the web copy. A GIF stays animated only within `maxFrames` and the pixel ceiling (issue #45). */
  full(maxFrames: number): Sharp;
  /** One upright still frame, for the thumbnail. */
  still(): Sharp;
}

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
    if (deadlineMs <= 0) {
      return Promise.reject(new ImageDeriveError("timeout"));
    }
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
    // A released slot refuses every kind of work: the next holder may already be decoding.
    const whileHeld = <T>(work: () => Promise<T>): Promise<T> => (released ? Promise.reject(new Error("derive slot already released")) : work());
    return {
      derive: (input, options) => whileHeld(() => this.deriveNow(input, options)),
      thumbnail: (input, options) => whileHeld(() => this.thumbnailNow(input, options)),
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

  private deriveNow(input: Buffer, options: DeriveOptions): Promise<DerivedSet> {
    return this.decode(input, options, async (decoded) => {
      const { sourceWidth, sourceHeight } = decoded;
      const web = await this.encodeWeb(decoded.full(options.maxFrames), decoded.family, options.web, { width: sourceWidth, height: sourceHeight });
      const thumb = await this.encodeThumb(decoded.still(), options.thumb);
      return { sourceWidth, sourceHeight, web, thumb };
    });
  }

  /** The thumbnail alone: the web pipeline is never built, so no web copy is decoded or encoded. */
  private thumbnailNow(input: Buffer, options: ThumbnailOptions): Promise<ThumbnailSet> {
    return this.decode(input, options, async (decoded) => {
      const thumb = await this.encodeThumb(decoded.still(), options.thumb);
      return { sourceWidth: decoded.sourceWidth, sourceHeight: decoded.sourceHeight, thumb };
    });
  }

  /**
   * The step `derive` and `thumbnail` share: check the label, then the bytes
   * and the size, and hand `encode` builders for the pipelines it needs.
   * Anything libvips or the HEIC worker throws, here or in `encode`, becomes
   * a typed `ImageDeriveError`.
   */
  private async decode<T>(input: Buffer, { sourceMime, deadlineMs, maxPixels }: DecodeOptions, encode: (decoded: Decoded) => Promise<T>): Promise<T> {
    const family = FAMILY[sourceMime];
    if (!family) {
      throw new ImageDeriveError("unsupported_type");
    }
    // Lazy: no route, prerender or build ever loads libvips until a copy is made.
    const sharp = (await import("sharp")).default;

    // libvips stops a pipeline that runs past this (native formats; HEIC has the worker's own deadline).
    const timeout = { seconds: Math.max(1, Math.ceil(deadlineMs / 1000)) };
    try {
      let decoded: Decoded;
      if (sourceMime === "image/heic" || sourceMime === "image/heif") {
        const rgba = await decodeHeicInWorker(input, { deadlineMs, maxPixels });
        const raw = { width: rgba.width, height: rgba.height, channels: 4 as const };
        const pixels = Buffer.from(rgba.data.buffer, rgba.data.byteOffset, rgba.data.byteLength);
        const pipeline = () => sharp(pixels, { raw }).timeout(timeout);
        decoded = { family, sourceWidth: rgba.width, sourceHeight: rgba.height, full: pipeline, still: pipeline };
      } else {
        // The declared type chooses the output; the bytes choose libvips's loader. They must agree,
        // or an SVG/TIFF/anything-else file labelled as a photo would reach a loader we never meant to expose.
        const meta = await sharp(input, { limitInputPixels: maxPixels }).metadata();
        if (meta.format !== family) {
          throw new ImageDeriveError("unsupported_type");
        }
        if (family === "gif") {
          // Decided from the header, before any frame is decoded (issue #45): an animation whose
          // frame count or whole strip (width × frame height × frames, what libvips builds for
          // `animated: true`) is over the ceiling is served as a still of its first frame. The
          // contributor still gets an inline picture and an email thumbnail; the download keeps
          // the animation. One frame over the pixel ceiling is a refusal, as for any photo.
          const frames = meta.pages ?? 1;
          const frameHeight = meta.pageHeight ?? meta.height;
          if (meta.width * frameHeight > maxPixels) {
            throw new ImageDeriveError("too_many_pixels", { limit: maxPixels });
          }
          decoded = {
            family,
            sourceWidth: meta.width,
            sourceHeight: frameHeight,
            full: (maxFrames) => {
              const animate = frames <= maxFrames && meta.width * frameHeight * frames <= maxPixels;
              return sharp(input, { animated: animate, limitInputPixels: maxPixels }).timeout(timeout);
            },
            still: () => sharp(input, { page: 0, limitInputPixels: maxPixels }).timeout(timeout),
          };
        } else {
          const pipeline = () => sharp(input, { limitInputPixels: maxPixels }).rotate().timeout(timeout);
          const swapped = (meta.orientation ?? 1) >= 5;
          decoded = {
            family,
            sourceWidth: swapped ? meta.height : meta.width,
            sourceHeight: swapped ? meta.width : meta.height,
            full: pipeline,
            still: pipeline,
          };
        }
      }
      return await encode(decoded);
    } catch (error) {
      if (error instanceof ImageDeriveError) {
        throw error;
      }
      if (isPixelLimitError(error)) {
        throw new ImageDeriveError("too_many_pixels", { limit: maxPixels, cause: error });
      }
      throw new ImageDeriveError("decode_failed", { cause: error });
    }
  }

  private async encodeWeb(base: Sharp, family: Family, web: DeriveOptions["web"], source: { width: number; height: number }): Promise<Encoded> {
    let pipeline = base;
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

  /** The THUMBNAIL spec (`DERIVE_DEFAULTS.thumb`), shared by photos and video posters. */
  private async encodeThumb(source: Sharp, thumb: DeriveOptions["thumb"]): Promise<Encoded | { failed: "too_large" }> {
    // Decode, flatten and resize once; the quality retry re-encodes the small raw result, not the original.
    const { data: raw, info } = await source
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
