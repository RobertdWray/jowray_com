import { execFile } from "node:child_process";
import { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { access, chmod, constants, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_VIDEO_PIXELS, REDACTED_FRAME_URL, WINDOW_BYTES } from "@/lib/video-frames";
import { FrameSourceError, type FrameRequestInfo } from "@/integrations/video-frames/frame-server";
import { createVideoFrameService, FfmpegVideoFrameService, type ExtractPosterInput, type ExtractPosterResult } from "@/services/video-frames";

/**
 * The real `ffmpeg-static` binary against real files (video-posters plan, Task 4): darwin's is ffmpeg 6.0, CI's and
 * Vercel's linux-x64 one 7.0.2; both have libzimg, so every case, the HLG one included, runs on every platform
 * (ruling R5). A missing binary fails the suite in `beforeAll`; nothing here is skipped.
 */

const FIXTURES = resolve(__dirname, "../fixtures");
const fixture = (name: string) => readFile(join(FIXTURES, name));
const TEST_TIMEOUT = 20_000;

interface Source {
  size: number;
  read: ExtractPosterInput["read"];
  calls: { offset: number; length: number }[];
}

/** An in-memory original whose `read` honours the contract: exactly `length` bytes, never past the end. */
function memorySource(bytes: Uint8Array): Source {
  const calls: Source["calls"] = [];
  return {
    size: bytes.length,
    calls,
    read: async (offset, length) => {
      calls.push({ offset, length });
      if (offset < 0 || offset + length > bytes.length) {
        throw new RangeError(`read past the end: ${offset}+${length} > ${bytes.length}`);
      }
      return bytes.slice(offset, offset + length);
    },
  };
}

interface TopBox {
  type: string;
  offset: number;
  size: number;
}

/** The top-level boxes of a small MOV/MP4 (32-bit sizes only, which every fixture here uses). */
function topLevelBoxes(bytes: Uint8Array): TopBox[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: TopBox[] = [];
  for (let offset = 0; offset < bytes.length; ) {
    const size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    expect(size, `${type} at ${offset} uses a 32-bit size`).toBeGreaterThanOrEqual(8);
    boxes.push({ type, offset, size });
    offset += size;
  }
  return boxes;
}

/**
 * The iPhone shape at production scale without a large fixture: the same file with `padding` zero bytes appended
 * to its mdat, right before the trailing moov. Sample offsets are unchanged (they sit before the padding), so only
 * mdat's 32-bit size changes. The padding is virtual: `read` synthesises it.
 */
function paddedMoovLast(bytes: Uint8Array, padding: number): Source & { moovSize: number } {
  const boxes = topLevelBoxes(bytes);
  expect(boxes.map((box) => box.type)).toEqual(["ftyp", "wide", "mdat", "moov"]);
  const mdat = boxes[2];
  const moov = boxes[3];
  const head = bytes.slice(0, moov.offset);
  new DataView(head.buffer).setUint32(mdat.offset, mdat.size + padding);
  const tail = bytes.subarray(moov.offset);
  const size = bytes.length + padding;
  const calls: Source["calls"] = [];
  return {
    size,
    calls,
    moovSize: moov.size,
    read: async (offset, length) => {
      calls.push({ offset, length });
      if (offset < 0 || offset + length > size) {
        throw new RangeError(`read past the end: ${offset}+${length} > ${size}`);
      }
      const out = new Uint8Array(length);
      for (let i = 0; i < length; ) {
        const at = offset + i;
        if (at < head.length) {
          const part = head.subarray(at, Math.min(head.length, at + length - i));
          out.set(part, i);
          i += part.length;
        } else if (at < head.length + padding) {
          i += Math.min(head.length + padding - at, length - i);
        } else {
          const from = at - head.length - padding;
          const part = tail.subarray(from, from + length - i);
          out.set(part, i);
          i += part.length;
        }
      }
      return out;
    },
  };
}

/** The decoded frame: its size, bit depth and mean luma on a 0–255 scale, whatever the PNG's depth. */
async function frameOf(png: Buffer) {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const meta = await sharp(png).metadata();
  const { channels } = await sharp(png).greyscale().stats();
  const scale = meta.depth === "ushort" ? 65_535 : 255;
  return { width: meta.width, height: meta.height, depth: meta.depth, luma: (channels[0].mean / scale) * 255 };
}

function expectOk(result: ExtractPosterResult): asserts result is Extract<ExtractPosterResult, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected a frame, got ${result.code}: ${result.detail}\n${result.stderrTail ?? ""}`);
  }
}

const RESOURCE_KINDS = ["TCPServerWrap", "TCPSocketWrap", "ProcessWrap", "PipeWrap"];
function openHandles(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const kind of process.getActiveResourcesInfo()) {
    if (RESOURCE_KINDS.includes(kind)) {
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * This worker's ffmpeg children still reading a frame URL (`-P` keeps another run of this suite on the same machine
 * out of it). pgrep exits 1 when there are none; any other failure is an error, never "none".
 */
function runningFrameReaders(): Promise<string[]> {
  return new Promise((resolvePids, reject) => {
    execFile("pgrep", ["-P", String(process.pid), "-f", "__frames/"], (error, stdout) => {
      if (!error) {
        resolvePids(stdout.trim().split("\n").filter(Boolean));
      } else if (error.code === 1) {
        resolvePids([]);
      } else {
        reject(error);
      }
    });
  });
}

/**
 * The one-window design, checked from the request log: every answer is a 206 carrying at most one window, and every
 * byte asked of `read` was carried by an answer ffmpeg asked for (no read-ahead, whatever the socket buffers hold).
 */
function expectOneWindowPerAnswer(requests: FrameRequestInfo[], sourceBytesRead: number, windowBytes = WINDOW_BYTES): number[] {
  const lengths = requests.map((request) => {
    expect(request).toMatchObject({ method: "GET", status: 206 });
    expect(request.body).toBeDefined();
    return request.body ? request.body.end - request.body.start + 1 : 0;
  });
  for (const length of lengths) {
    expect(length).toBeLessThanOrEqual(windowBytes);
  }
  expect(sourceBytesRead).toBe(lengths.reduce((sum, length) => sum + length, 0));
  return lengths;
}

const defaults = (source: Source, over: Partial<ExtractPosterInput> = {}): ExtractPosterInput => ({
  size: source.size,
  read: source.read,
  container: "mov",
  transferKind: "sdr",
  deadlineMs: 15_000,
  ...over,
});

/** A service on the real binary that records the requests ffmpeg makes. */
function observedService(over: { windowBytes?: number; maxSourceBytes?: number; maxPixels?: number } = {}) {
  const requests: FrameRequestInfo[] = [];
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static has no binary for this platform");
  }
  const service = new FfmpegVideoFrameService({ binaryPath: ffmpegPath, onRequest: (info) => requests.push(info), ...over });
  return { service, requests };
}

let baseline: Record<string, number>;

beforeAll(async () => {
  // Fail loudly: this suite proves the production binary, so it never skips.
  expect(ffmpegPath, "ffmpeg-static resolved no binary path").toBeTruthy();
  await access(ffmpegPath as string, constants.X_OK);
});

beforeEach(() => {
  baseline = openHandles();
});

afterEach(async () => {
  // Every run closes its server, its sockets and its child.
  await expect.poll(openHandles, { timeout: 2000 }).toEqual(baseline);
});

describe("createVideoFrameService", () => {
  it("is a singleton on the ffmpeg-static binary, which is available", async () => {
    const service = createVideoFrameService();
    expect(createVideoFrameService()).toBe(service);
    await expect(service.available()).resolves.toBe(true);
  });
});

describe("VideoFrameService.extractPoster (real ffmpeg-static binary)", { timeout: TEST_TIMEOUT }, () => {
  it("reads a moov-after-mdat HEVC .mov (the iPhone shape) in at most 5 requests and moov + 2 windows", async () => {
    const bytes = await fixture("poster-hevc-moov-last.mov");
    const boxes = topLevelBoxes(bytes);
    expect(boxes.map((box) => box.type)).toEqual(["ftyp", "wide", "mdat", "moov"]);
    expect(bytes.includes(Buffer.from("hvc1"))).toBe(true);
    const moov = boxes[3];
    const { service, requests } = observedService();
    const result = await service.extractPoster(defaults(memorySource(bytes)));
    expectOk(result);
    expect(result.seekSeconds).toBe(1);
    expect(result.toneMapped).toBe(false);
    const frame = await frameOf(result.png);
    // 160×90 stays 160×90: the scale never enlarges.
    expect([frame.width, frame.height]).toEqual([160, 90]);
    expect(requests.length).toBeLessThanOrEqual(5);
    expectOneWindowPerAnswer(requests, result.sourceBytesRead);
    expect(result.sourceBytesRead).toBeLessThanOrEqual(moov.size + 2 * WINDOW_BYTES);
  });

  it.each([
    ["poster-hevc-moov-last.mov", 160, 90],
    ["location-mdta.mov", 16, 16],
  ])("keeps %s to moov + 2 windows when its mdat is 48 MiB, reading lazily", async (name, width, height) => {
    const source = paddedMoovLast(await fixture(name), 48 * 1024 * 1024);
    const { service, requests } = observedService();
    const result = await service.extractPoster(defaults(source));
    expectOk(result);
    const frame = await frameOf(result.png);
    expect([frame.width, frame.height]).toEqual([width, height]);
    expect(requests.length).toBeLessThanOrEqual(5);
    // From the design, not the kernel: ffmpeg asks for the header at 0, then the moov at its offset (one answer, cut at
    // the end of the file), then the keyframe; each answer is one window, so the bound is moov + 2 windows.
    const lengths = expectOneWindowPerAnswer(requests, result.sourceBytesRead);
    const moovOffset = source.size - source.moovSize;
    expect(requests.map((request) => request.body?.start)).toEqual([0, moovOffset, expect.any(Number)]);
    expect(lengths).toEqual([WINDOW_BYTES, source.moovSize, WINDOW_BYTES]);
    expect(result.sourceBytesRead).toBeLessThanOrEqual(source.moovSize + 2 * WINDOW_BYTES);
    expect(result.sourceBytesRead).toBe(source.calls.reduce((sum, call) => sum + call.length, 0));
    // Never past the end, and never the padding's bulk.
    expect(source.calls.every((call) => call.offset + call.length <= source.size)).toBe(true);
  });

  it("reads the small location-mdta.mov (H.264, moov after mdat) in at most 5 requests", async () => {
    const bytes = await fixture("location-mdta.mov");
    const moov = topLevelBoxes(bytes).find((box) => box.type === "moov");
    const { service, requests } = observedService();
    const result = await service.extractPoster(defaults(memorySource(bytes)));
    expectOk(result);
    expect((await frameOf(result.png)).width).toBe(16);
    expect(requests.length).toBeLessThanOrEqual(5);
    expectOneWindowPerAnswer(requests, result.sourceBytesRead);
    expect(result.sourceBytesRead).toBeLessThanOrEqual((moov?.size ?? 0) + 2 * WINDOW_BYTES);
  });

  it.each([
    ["poster-hevc-moov-last.mov", "mov"],
    ["poster-h264-faststart.mp4", "mov"],
    ["poster-vp9-nocues.webm", "matroska"],
  ] as const)("continues %s across 1 KiB windows: ffmpeg asks again exactly where each answer ended", async (name, container) => {
    const bytes = await fixture(name);
    const { service, requests } = observedService({ windowBytes: 1024 });
    const result = await service.extractPoster(defaults(memorySource(bytes), { container }));
    expectOk(result);
    expect((await frameOf(result.png)).width).toBe(160);
    expectOneWindowPerAnswer(requests, result.sourceBytesRead, 1024);
    // Continuations: a request that starts at the byte after the previous answer's last one.
    const continuations = requests.filter((request, i) => i > 0 && request.body?.start === (requests[i - 1].body?.end ?? -2) + 1);
    expect(continuations.length).toBeGreaterThan(3);
  });

  it("decodes a faststart H.264 .mp4", async () => {
    const bytes = await fixture("poster-h264-faststart.mp4");
    expect(topLevelBoxes(bytes).map((box) => box.type)).toEqual(["ftyp", "moov", "free", "mdat"]);
    const result = await createVideoFrameService().extractPoster(defaults(memorySource(bytes)));
    expectOk(result);
    expect(result.seekSeconds).toBe(1);
    const frame = await frameOf(result.png);
    expect([frame.width, frame.height]).toEqual([160, 90]);
  });

  it("decodes a WebM with no Cues element through the forced matroska demuxer", async () => {
    const bytes = await fixture("poster-vp9-nocues.webm");
    // EBML header, then no Cues (ID 0x1C53BB6B) anywhere.
    expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(bytes.includes(Buffer.from([0x1c, 0x53, 0xbb, 0x6b]))).toBe(false);
    const result = await createVideoFrameService().extractPoster(defaults(memorySource(bytes), { container: "matroska" }));
    expectOk(result);
    const frame = await frameOf(result.png);
    expect([frame.width, frame.height]).toEqual([160, 90]);
  });

  it("applies the display matrix, so a rotated landscape clip gives a portrait frame with the marker moved", async () => {
    const bytes = await fixture("poster-rotated.mov");
    const result = await createVideoFrameService().extractPoster(defaults(memorySource(bytes)));
    expectOk(result);
    const { data, info } = await sharp(result.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([90, 160]);
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    // The red 40×40 marker was top-left in the 160×90 coded picture; rotated 90° it is bottom-left.
    const [r, , b] = pixel(5, info.height - 6);
    expect(r).toBeGreaterThan(200);
    expect(b).toBeLessThan(60);
    const [r2, , b2] = pixel(5, 5);
    expect(r2).toBeLessThan(60);
    expect(b2).toBeGreaterThan(200);
  });

  it("retries at 0 s when the seek to 1 s gives no frame (a 0.5 s clip)", async () => {
    const bytes = await fixture("poster-half-second.mov");
    const { service, requests } = observedService();
    const result = await service.extractPoster(defaults(memorySource(bytes)));
    expectOk(result);
    expect(result.seekSeconds).toBe(0);
    expect((await frameOf(result.png)).width).toBe(160);
    // Both runs went through the same server, and both are counted.
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(result.sourceBytesRead).toBeGreaterThanOrEqual(2 * bytes.length);
  });

  it("bounds the frame to 1000 px on its long edge, keeping the aspect ratio", async () => {
    const result = await createVideoFrameService().extractPoster(defaults(memorySource(await fixture("poster-wide.mov"))));
    expectOk(result);
    const frame = await frameOf(result.png);
    expect([frame.width, frame.height]).toEqual([1000, 500]);
  });

  it.each(["track-hlg-nclx.mp4", "track-hlg-nclc.mov"])("tone-maps the HLG clip %s with zscale and keeps its mean luma in a sane band", async (name) => {
    const bytes = await fixture(name);
    const service = createVideoFrameService();
    const mapped = await service.extractPoster(defaults(memorySource(bytes), { transferKind: "hlg" }));
    expectOk(mapped);
    expect(mapped.toneMapped).toBe(true);
    expect(mapped.warning).toBeUndefined();
    const untouched = await service.extractPoster(defaults(memorySource(bytes), { transferKind: "sdr" }));
    expectOk(untouched);
    expect(untouched.toneMapped).toBe(false);
    const withChain = await frameOf(mapped.png);
    const without = await frameOf(untouched.png);
    // The chain ends in 8-bit yuv420p; the untouched 10-bit decode comes out as a 16-bit PNG.
    expect(withChain.depth).toBe("uchar");
    expect(without.depth).toBe("ushort");
    // Mid-grey HLG (signal 50 %) decodes to ≈ 128 untouched. BT.2408 puts it at a quarter of reference white, which
    // is ≈ 143 in SDR; the chain gives ≈ 141 (6.0). Bands, not exact values: CI runs the 7.0.2 binary.
    expect(without.luma).toBeGreaterThan(115);
    expect(without.luma).toBeLessThan(140);
    expect(withChain.luma).toBeGreaterThan(130);
    expect(withChain.luma).toBeLessThan(155);
    expect(withChain.luma).toBeGreaterThan(without.luma + 5);
    expect([withChain.width, withChain.height]).toEqual([64, 36]);
  });

  it("tone-maps a 1080p HLG clip whose bounded height would be odd (zscale needs even 4:2:0 dimensions)", async () => {
    const result = await createVideoFrameService().extractPoster(defaults(memorySource(await fixture("poster-hlg-1080p.mov")), { transferKind: "hlg" }));
    expectOk(result);
    expect(result.toneMapped).toBe(true);
    const { data, info } = await sharp(result.png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    // 1920 × 1080 bounded to 1000 wide is 562.5 high: rounded to an even 562, never 563.
    expect([info.width, info.height]).toEqual([1000, 562]);
    // The red box (top-left quarter) stays red after the BT.2020 → BT.709 conversion, the grey stays grey.
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    const [r, g, b] = pixel(60, 60);
    expect(r).toBeGreaterThan(g + 60);
    expect(r).toBeGreaterThan(b + 60);
    const [gr, gg, gb] = pixel(900, 500);
    expect(Math.max(gr, gg, gb) - Math.min(gr, gg, gb)).toBeLessThan(6);
  });

  it("tone-maps PQ through the same chain", async () => {
    const result = await createVideoFrameService().extractPoster(defaults(memorySource(await fixture("track-hlg-nclc.mov")), { transferKind: "pq" }));
    expectOk(result);
    expect(result.toneMapped).toBe(true);
  });

  it("runs without the chain and says so when the binary lists no zscale", async () => {
    // A wrapper that hides zscale from `-filters` and otherwise runs the real binary, logging its arguments.
    const dir = await mkdtemp(join(tmpdir(), "frames-wrapper-"));
    try {
      const wrapper = join(dir, "ffmpeg");
      const argsLog = join(dir, "args.log");
      await writeFile(
        wrapper,
        [
          "#!/bin/sh",
          `echo "$@" >> '${argsLog}'`,
          `if [ "$2" = "-filters" ]; then '${ffmpegPath}' -hide_banner -filters | grep -v ' zscale '; exit 0; fi`,
          `exec '${ffmpegPath}' "$@"`,
          "",
        ].join("\n"),
      );
      await chmod(wrapper, 0o755);
      const service = new FfmpegVideoFrameService({ binaryPath: wrapper });
      const result = await service.extractPoster(defaults(memorySource(await fixture("track-hlg-nclc.mov")), { transferKind: "hlg" }));
      expectOk(result);
      expect(result.toneMapped).toBe(false);
      expect(result.warning).toBe("hdr_untonemapped");
      const log = await readFile(argsLog, "utf8");
      expect(log).toContain("-filters");
      expect(log).not.toContain("zscale=");
      // Detected once per binary.
      await service.extractPoster(defaults(memorySource(await fixture("track-hlg-nclc.mov")), { transferKind: "hlg" }));
      expect((await readFile(argsLog, "utf8")).match(/-filters/g)).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["mov", "mov"],
    ["matroska", "matroska"],
  ] as const)("fails garbage bytes forced as %s with decode_failed or no_video_stream", async (_label, container) => {
    const garbage = randomBytes(3000);
    const result = await createVideoFrameService().extractPoster(defaults(memorySource(garbage), { container }));
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(["decode_failed", "no_video_stream"]).toContain(result.code);
    expect(result.stderrTail).toBeTruthy();
    // The real binary names its input (the loopback URL) in this error; the tail keeps only the redacted form.
    expect(result.stderrTail).toContain(REDACTED_FRAME_URL);
    expect(result.stderrTail).not.toMatch(/127\.0\.0\.1:\d+\/__frames\//);
    expect(result.stderrTail).not.toMatch(/__frames\/[0-9a-f]{8}-/);
  });

  it("answers no_video_stream for an audio-only file", async () => {
    const result = await createVideoFrameService().extractPoster(defaults(memorySource(await fixture("audio-only.m4a"))));
    expect(result).toMatchObject({ ok: false, code: "no_video_stream" });
  });

  it("refuses a frame over the pixel ceiling through ffmpeg's -max_pixels, with too_many_pixels:<limit>", async () => {
    const { service } = observedService({ maxPixels: 1000 });
    const result = await service.extractPoster(defaults(memorySource(await fixture("poster-hevc-moov-last.mov"))));
    expect(result).toMatchObject({ ok: false, code: "too_many_pixels:1000" });
  });

  it("passes the 8K ceiling to ffmpeg by default", async () => {
    const { service } = observedService();
    expect(service.maxPixels).toBe(MAX_VIDEO_PIXELS);
  });

  it("stops at the source cap with source_limit, never asking past it", async () => {
    const source = paddedMoovLast(await fixture("poster-hevc-moov-last.mov"), 48 * 1024 * 1024);
    const { service } = observedService({ windowBytes: 16_384, maxSourceBytes: 32_768 });
    const result = await service.extractPoster(defaults(source));
    expect(result).toMatchObject({ ok: false, code: "source_limit" });
    expect(result.sourceBytesRead).toBeLessThanOrEqual(32_768);
    expect(source.calls.reduce((sum, call) => sum + call.length, 0)).toBeLessThanOrEqual(32_768);
  });

  it("fails with decode_failed and keeps the error when a read throws", async () => {
    const boom = new Error("blob unavailable");
    const result = await createVideoFrameService().extractPoster({
      ...defaults(memorySource(await fixture("location-mdta.mov"))),
      read: async () => {
        throw boom;
      },
    });
    expect(result).toMatchObject({ ok: false, code: "decode_failed" });
    if (!result.ok) {
      expect(result.error?.cause).toBe(boom);
      expect(result.detail).toMatch(/read/);
    }
  });

  it("defers with the cause when the loopback server errors after listening (an accept failure)", async () => {
    // The http.Server is internal, so take it from the listen call and emit the error the kernel would cause.
    const listen = vi.spyOn(Server.prototype, "listen");
    try {
      const accept = Object.assign(new Error("accept EMFILE"), { code: "EMFILE", syscall: "accept" });
      const bytes = await fixture("location-mdta.mov");
      const result = await createVideoFrameService().extractPoster({
        ...defaults(memorySource(bytes)),
        read: async (offset, length) => {
          (listen.mock.contexts.at(-1) as Server).emit("error", accept);
          return bytes.slice(offset, offset + length);
        },
      });
      expect(result).toMatchObject({ ok: false, code: "deferred" });
      if (!result.ok) {
        expect(result.detail).toContain("accept EMFILE");
        expect(result.error).toBeInstanceOf(FrameSourceError);
        expect(result.error?.cause).toBe(accept);
      }
    } finally {
      listen.mockRestore();
    }
  });

  it("times out, kills ffmpeg and closes the server when the source never answers", async () => {
    const started = Date.now();
    const result = await createVideoFrameService().extractPoster({
      ...defaults(memorySource(await fixture("location-mdta.mov"))),
      deadlineMs: 1500,
      // Ignores its signal on purpose.
      read: () => new Promise<Uint8Array>(() => undefined),
    });
    const elapsed = Date.now() - started;
    expect(result).toMatchObject({ ok: false, code: "timeout" });
    expect(elapsed).toBeGreaterThanOrEqual(1400);
    expect(elapsed).toBeLessThan(5000);
    expect(await runningFrameReaders()).toEqual([]);
  });

  it("answers timeout when the caller's signal fires mid-run", async () => {
    const controller = new AbortController();
    const result = await createVideoFrameService().extractPoster({
      ...defaults(memorySource(await fixture("location-mdta.mov"))),
      signal: controller.signal,
      read: (_offset, _length, signal) =>
        new Promise<Uint8Array>((_resolve, reject) => {
          setTimeout(() => controller.abort(new Error("caller gave up")), 50);
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    });
    expect(result).toMatchObject({ ok: false, code: "timeout" });
    expect(await runningFrameReaders()).toEqual([]);
  });

  it("answers timeout at once for a spent budget or an aborted signal, reading nothing", async () => {
    const source = memorySource(await fixture("location-mdta.mov"));
    const service = createVideoFrameService();
    await expect(service.extractPoster(defaults(source, { deadlineMs: 0 }))).resolves.toMatchObject({ ok: false, code: "timeout", sourceBytesRead: 0 });
    await expect(service.extractPoster(defaults(source, { deadlineMs: Number.NaN }))).resolves.toMatchObject({ ok: false, code: "timeout", sourceBytesRead: 0 });
    await expect(service.extractPoster(defaults(source, { signal: AbortSignal.abort() }))).resolves.toMatchObject({ ok: false, code: "timeout", sourceBytesRead: 0 });
    expect(source.calls).toEqual([]);
  });

  it("defers, reading nothing, when the binary path points nowhere", async () => {
    const service = new FfmpegVideoFrameService({ binaryPath: "/nonexistent/ffmpeg" });
    await expect(service.available()).resolves.toBe(false);
    const source = memorySource(await fixture("location-mdta.mov"));
    const sdr = await service.extractPoster(defaults(source));
    expect(sdr).toMatchObject({ ok: false, code: "deferred" });
    expect(sdr.ok ? "" : sdr.detail).toMatch(/ENOENT/);
    // The HDR path fails the same way at its filter check.
    await expect(service.extractPoster(defaults(source, { transferKind: "hlg" }))).resolves.toMatchObject({ ok: false, code: "deferred" });
    const none = new FfmpegVideoFrameService({ binaryPath: null });
    await expect(none.available()).resolves.toBe(false);
    await expect(none.extractPoster(defaults(source))).resolves.toMatchObject({ ok: false, code: "deferred" });
  });

  it("defers when the binary is not executable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "frames-noexec-"));
    try {
      const path = join(dir, "ffmpeg");
      await writeFile(path, "#!/bin/sh\nexit 0\n");
      await chmod(path, 0o644);
      const service = new FfmpegVideoFrameService({ binaryPath: path });
      await expect(service.available()).resolves.toBe(false);
      await expect(service.extractPoster(defaults(memorySource(await fixture("location-mdta.mov"))))).resolves.toMatchObject({ ok: false, code: "deferred" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("answers decode_failed for a size that cannot be served", async () => {
    const source = memorySource(new Uint8Array(0));
    await expect(createVideoFrameService().extractPoster(defaults(source))).resolves.toMatchObject({ ok: false, code: "decode_failed", sourceBytesRead: 0 });
  });
});

afterAll(async () => {
  expect(await runningFrameReaders()).toEqual([]);
});
