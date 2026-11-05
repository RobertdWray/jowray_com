import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ImageDeriveError } from "@/lib/image-derive-error";
import { SharpHeicImageService } from "@/integrations/images/sharp-heic";
import { createImageService, DERIVE_DEFAULTS, type DeriveOptions } from "@/services/images";

const fixture = (name: string) => readFile(resolve(__dirname, "../fixtures", name));
const service = createImageService();
const opts = (sourceMime: string, over: Partial<DeriveOptions> = {}) => ({ ...DERIVE_DEFAULTS, deadlineMs: 20_000, ...over, sourceMime });

async function meta(buf: Buffer) {
  return sharp(buf).metadata();
}

describe("ImageService.derive", () => {
  it("makes a web copy and a thumbnail from one JPEG, upright, bounded, with every byte of metadata stripped", async () => {
    // 3000×1500 with EXIF orientation 6 (rotate 90° cw on display) → upright 1500×3000.
    const input = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#336699" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await service.derive(input, opts("image/jpeg"));
    // "source" dimensions are upright: what the contributor saw.
    expect([out.sourceWidth, out.sourceHeight]).toEqual([1500, 3000]);
    expect(out.web.mimeType).toBe("image/jpeg");
    expect([out.web.width, out.web.height]).toEqual([1024, 2048]);
    expect("failed" in out.thumb).toBe(false);
    if ("failed" in out.thumb) { return; }
    expect(out.thumb.mimeType).toBe("image/jpeg");
    expect([out.thumb.width, out.thumb.height]).toEqual([500, 1000]);
    expect(out.thumb.data.byteLength).toBeLessThanOrEqual(350_000);
    for (const encoded of [out.web, out.thumb]) {
      const m = await meta(encoded.data);
      expect(m.exif).toBeUndefined();
      expect(m.orientation).toBeUndefined();
      expect([m.width, m.height]).toEqual([encoded.width, encoded.height]);
    }
  });

  it("keeps PNG as PNG for the web copy and flattens the thumbnail onto the paper colour", async () => {
    const input = await sharp({ create: { width: 400, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await service.derive(input, opts("image/png"));
    expect(out.web.mimeType).toBe("image/png");
    expect(out.web.extension).toBe("png");
    expect((await meta(out.web.data)).hasAlpha).toBe(true);
    if ("failed" in out.thumb) { throw new Error("thumb failed"); }
    const { data, info } = await sharp(out.thumb.data).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    // #fffdf8 → (255, 253, 248), JPEG may drift by a couple of units
    expect(Math.abs(data[0]! - 255)).toBeLessThanOrEqual(3);
    expect(Math.abs(data[1]! - 253)).toBeLessThanOrEqual(3);
    expect(Math.abs(data[2]! - 248)).toBeLessThanOrEqual(3);
  });

  it("keeps an animated GIF animated for the web copy and uses one frame for the thumbnail", async () => {
    const out = await service.derive(await fixture("anim.gif"), opts("image/gif"));
    expect(out.web.mimeType).toBe("image/gif");
    expect((await meta(out.web.data)).pages).toBe(2);
    expect([out.sourceWidth, out.sourceHeight]).toEqual([32, 32]);
    expect([out.web.width, out.web.height]).toEqual([32, 32]);
    if ("failed" in out.thumb) { throw new Error("thumb failed"); }
    expect(out.thumb.mimeType).toBe("image/jpeg");
    expect((await meta(out.thumb.data)).pages ?? 1).toBe(1);
  });

  it("does not enlarge small images", async () => {
    const out = await service.derive(await sharp({ create: { width: 300, height: 200, channels: 3, background: "#abcdef" } }).webp().toBuffer(), opts("image/webp"));
    expect([out.web.width, out.web.height]).toEqual([300, 200]);
    expect(out.web.mimeType).toBe("image/webp");
  });

  it("decodes HEIC through the worker and applies the HEIF rotation", async () => {
    const out = await service.derive(await fixture("rotated.heic"), opts("image/heic"));
    expect([out.sourceWidth, out.sourceHeight]).toEqual([48, 64]);
    expect(out.web.mimeType).toBe("image/jpeg");
    expect([out.web.width, out.web.height]).toEqual([48, 64]);
  });

  it("refuses images over the pixel ceiling with the ceiling recorded", async () => {
    const big = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#000" } }).png().toBuffer();
    await expect(service.derive(big, opts("image/png", { maxPixels: 100_000 }))).rejects.toMatchObject({ code: "too_many_pixels", limit: 100_000 });
    await expect(service.derive(await fixture("tiny.heic"), opts("image/heic", { maxPixels: 100 }))).rejects.toMatchObject({ code: "too_many_pixels", limit: 100 });
  });

  it("marks only the thumbnail too_large when even the fallback quality exceeds the byte budget, keeping the web copy", async () => {
    const out = await service.derive(await fixture("noise.png"), opts("image/png", { thumb: { ...DERIVE_DEFAULTS.thumb, maxBytes: 50_000 } }));
    expect(out.web.mimeType).toBe("image/png");
    expect(out.thumb).toEqual({ failed: "too_large" });
    // and within the real budget the same noise still yields a thumbnail
    const ok = await service.derive(await fixture("noise.png"), opts("image/png"));
    expect("failed" in ok.thumb).toBe(false);
  });

  it("rejects bytes that do not match the declared type (loaders are chosen by bytes, not by the label)", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).png().toBuffer();
    await expect(service.derive(png, opts("image/jpeg"))).rejects.toMatchObject({ code: "unsupported_type" });
    const tiff = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).tiff().toBuffer();
    await expect(service.derive(tiff, opts("image/png"))).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("caps a portrait animation by its frame height, not only its width", async () => {
    const out = await service.derive(await fixture("anim-portrait.gif"), opts("image/gif", { web: { maxEdge: 100, quality: 85 } }));
    expect([out.sourceWidth, out.sourceHeight]).toEqual([40, 400]);
    expect([out.web.width, out.web.height]).toEqual([10, 100]);
    const m = await meta(out.web.data);
    expect(m.pages).toBe(2);
    expect(m.height).toBe(100);
  });

  it("rejects unsupported types and corrupt bytes with typed errors", async () => {
    await expect(service.derive(Buffer.from("x"), opts("image/svg+xml"))).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(service.derive(Buffer.from("not a jpeg"), opts("image/jpeg"))).rejects.toBeInstanceOf(ImageDeriveError);
    await expect(service.derive(Buffer.from("not a jpeg"), opts("image/jpeg"))).rejects.toMatchObject({ code: "decode_failed" });
  });

  it("spends the deadline on queue time too: a call that waited past its deadline fails fast with timeout", async () => {
    const slow = service.derive(await fixture("tiny.heic"), opts("image/heic"));
    const queued = service.derive(await fixture("tiny.heic"), opts("image/heic", { deadlineMs: 1 }));
    await expect(queued).rejects.toMatchObject({ code: "timeout" });
    await slow;
  });

  it("runs one derivation at a time per process", async () => {
    const input = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#123456" } }).jpeg().toBuffer();
    const order: string[] = [];
    const a = service.derive(input, opts("image/jpeg")).then(() => order.push("a"));
    const b = service.derive(input, opts("image/jpeg")).then(() => order.push("b"));
    await Promise.all([a, b]);
    expect(order).toEqual(["a", "b"]);
    expect(service.inFlight()).toBe(0);
  });

  it("refuses an animation with more frames than the cap before decoding any frame (terminal error)", async () => {
    const long = await fixture("anim-400.gif");
    await expect(service.derive(long, opts("image/gif", { maxFrames: 300 }))).rejects.toMatchObject({ code: "too_many_frames", limit: 300 });
    // Under the cap the same file is fine (the encoder may merge identical frames; the point is that it is accepted).
    expect((await service.derive(long, opts("image/gif", { maxFrames: 400 }))).web.mimeType).toBe("image/gif");
  });

  it("applies the pixel ceiling to the whole frame strip of an animation, not to one frame", async () => {
    // 10×10 frames × 400 = 40,000 pixels of strip; each frame alone is far under the ceiling.
    const strip = await fixture("anim-400x10.gif");
    await expect(service.derive(strip, opts("image/gif", { maxPixels: 30_000, maxFrames: 1000 }))).rejects.toMatchObject({ code: "too_many_pixels", limit: 30_000 });
    expect((await service.derive(strip, opts("image/gif", { maxPixels: 50_000, maxFrames: 1000 }))).web.mimeType).toBe("image/gif");
  });
});

describe("ImageService.acquire (issue #45: the slot is taken before anything is downloaded)", () => {
  it("serves waiters in order and answers busy at once beyond the waiting line, without consuming the deadline", async () => {
    const own = new SharpHeicImageService(2);
    const first = await own.acquire(1_000);
    expect(own.inFlight()).toBe(1);
    const second = own.acquire(5_000);
    const third = own.acquire(5_000);
    expect(own.waiting()).toBe(2);
    const started = Date.now();
    await expect(own.acquire(5_000)).rejects.toMatchObject({ code: "busy" });
    expect(Date.now() - started).toBeLessThan(100);
    first.release();
    first.release(); // idempotent: releasing twice hands the slot over once
    const s2 = await second;
    expect(own.inFlight()).toBe(1);
    expect(own.waiting()).toBe(1);
    s2.release();
    const s3 = await third;
    s3.release();
    expect(own.inFlight()).toBe(0);
    expect(own.waiting()).toBe(0);
  });

  it("times out a waiter whose deadline passes and removes it from the line", async () => {
    const own = new SharpHeicImageService(2);
    const held = await own.acquire(1_000);
    await expect(own.acquire(5)).rejects.toMatchObject({ code: "timeout" });
    expect(own.waiting()).toBe(0);
    held.release();
    const next = await own.acquire(10);
    next.release();
  });

  it("a released slot cannot decode any more", async () => {
    const own = new SharpHeicImageService(2);
    const slot = await own.acquire(1_000);
    slot.release();
    await expect(slot.derive(Buffer.alloc(0), opts("image/jpeg"))).rejects.toThrow(/released/);
  });
});
