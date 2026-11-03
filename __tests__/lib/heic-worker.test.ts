import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { decodeHeicInWorker, runWorker } from "@/lib/heic-worker";
import { ImageDeriveError } from "@/lib/image-derive-error";

const fixture = (name: string) => readFile(resolve(__dirname, "../fixtures", name));

describe("decodeHeicInWorker", () => {
  it("decodes a HEIC to RGBA pixels of the right size in a worker thread", async () => {
    const out = await decodeHeicInWorker(await fixture("tiny.heic"), { deadlineMs: 20_000, maxPixels: 1_000_000 });
    expect([out.width, out.height]).toEqual([64, 48]);
    expect(out.data.byteLength).toBe(64 * 48 * 4);
    // solid red (HEVC is lossy, so allow a little drift)
    expect(out.data[0]).toBeGreaterThan(240);
    expect(out.data[1]).toBeLessThan(20);
    expect(out.data[2]).toBeLessThan(20);
  });

  it("applies the HEIF rotation transform: the blue landmark lands top-right of a 48×64 image", async () => {
    const out = await decodeHeicInWorker(await fixture("rotated.heic"), { deadlineMs: 20_000, maxPixels: 1_000_000 });
    expect([out.width, out.height]).toEqual([48, 64]);
    const px = (x: number, y: number) => [out.data[(y * out.width + x) * 4], out.data[(y * out.width + x) * 4 + 1], out.data[(y * out.width + x) * 4 + 2]];
    expect(px(out.width - 4, 4)[2]).toBeGreaterThan(200); // blue
    expect(px(4, out.height - 4)[0]).toBeGreaterThan(200); // red
  });

  it("refuses an image over the pixel ceiling without decoding it", async () => {
    await expect(decodeHeicInWorker(await fixture("tiny.heic"), { deadlineMs: 20_000, maxPixels: 100 })).rejects.toMatchObject({ code: "too_many_pixels", limit: 100 });
  });

  it("reports a non-HEIC buffer as unsupported_type and a corrupt HEIC as decode_failed", async () => {
    await expect(decodeHeicInWorker(Buffer.from("not an image"), { deadlineMs: 20_000, maxPixels: 1_000_000 })).rejects.toBeInstanceOf(ImageDeriveError);
    await expect(decodeHeicInWorker(Buffer.from("not an image"), { deadlineMs: 20_000, maxPixels: 1_000_000 })).rejects.toMatchObject({ code: "unsupported_type" });
    const corrupt = Buffer.from(await fixture("tiny.heic"));
    corrupt.fill(0, 64); // keep the ftyp box, destroy the rest
    await expect(decodeHeicInWorker(corrupt, { deadlineMs: 20_000, maxPixels: 1_000_000 })).rejects.toMatchObject({ code: "decode_failed" });
  });
});

describe("runWorker", () => {
  it("terminates a stalled worker at the deadline and rejects with timeout", async () => {
    const started = Date.now();
    await expect(runWorker("setInterval(() => {}, 1000);", { deadlineMs: 300, workerData: {}, maxOldGenerationSizeMb: 64 })).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("maps a worker that throws to decode_failed", async () => {
    await expect(runWorker("throw new Error('boom');", { deadlineMs: 5_000, workerData: {}, maxOldGenerationSizeMb: 64 })).rejects.toMatchObject({ code: "decode_failed" });
  });
});
