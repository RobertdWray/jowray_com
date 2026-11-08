import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImageDeriveError } from "@/lib/image-derive-error";
import { MAX_VIDEO_PIXELS } from "@/lib/video-frames";
import { resetEnvCache } from "@/server/config/env";
import type * as ImagesModule from "@/services/images";
import type { ThumbnailSet } from "@/services/images";
import type { ExtractPosterInput, ExtractPosterResult } from "@/services/video-frames";
import type * as LoggerModule from "@/lib/logger";
import type * as VideoTrackModule from "@/lib/video-track";

/**
 * derivePoster (video-posters plan T6): one POSTER row per READY video, through the shared claim/publish protocol
 * (`derived-claims.ts`, [C35]) and never a Media write (D6, [C36]). The database, the store, the image slot and the
 * frame service are fakes; the MP4 track reader is the real one, run over the committed fixtures.
 */

type Kind = "WEB_IMAGE" | "THUMBNAIL" | "POSTER";
interface DerivedRow { id: string; mediaId: string; kind: Kind; status: "PENDING" | "READY" | "FAILED"; storageKey: string; mimeType: string | null; sizeBytes: number | null; width: number | null; height: number | null; error: string | null; attempts: number; claimedAt: Date | null }
interface MediaRow { id: string; memoryId: string; status: string; mimeType: string; storageKey: string; deletedAt: Date | null; width: number | null; height: number | null; memory: { deletedAt: Date | null } }

let media: MediaRow[] = [];
let derived: DerivedRow[] = [];
const lockCalls: string[] = [];
let nextId = 1;

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    const actual = row[k];
    if (v instanceof Date) { return actual instanceof Date && actual.getTime() === v.getTime(); }
    if (v !== null && typeof v === "object") {
      const cond = v as { in?: unknown[] };
      if (cond.in) { return cond.in.includes(actual); }
    }
    return actual === v;
  });
}
const db = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => { lockCalls.push(`${strings.join("?")}|${String(values[0])}`); return [{ id: values[0] }]; }),
  $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(db)),
  media: {
    findUnique: vi.fn(async ({ where, include }: { where: { id: string }; include?: { derivatives?: { where?: Record<string, unknown> } } }) => {
      const row = media.find((m) => m.id === where.id);
      if (!row) { return null; }
      const w = include?.derivatives?.where ?? {};
      return { ...row, derivatives: derived.filter((d) => d.mediaId === row.id && matches(d as unknown as Record<string, unknown>, w)).map((d) => ({ ...d })) };
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => media.find((m) => matches(m as unknown as Record<string, unknown>, where)) ?? null),
    update: vi.fn(async () => { throw new Error("a poster must never write the Media row (D6)"); }),
    updateMany: vi.fn(async () => { throw new Error("a poster must never write the Media row (D6)"); }),
  },
  derivedMedia: {
    create: vi.fn(async ({ data }: { data: Pick<DerivedRow, "mediaId" | "kind" | "status" | "storageKey" | "claimedAt" | "attempts"> }) => {
      if (derived.some((d) => d.mediaId === data.mediaId && d.kind === data.kind)) { throw Object.assign(new Error("Unique constraint failed on the fields: (`mediaId`,`kind`)"), { code: "P2002" }); }
      const row: DerivedRow = { id: `der_${nextId++}`, mimeType: null, sizeBytes: null, width: null, height: null, error: null, ...data };
      derived.push(row); return { ...row };
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => { const found = derived.find((d) => matches(d as unknown as Record<string, unknown>, where)); return found ? { ...found } : null; }),
    deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => { const before = derived.length; const keep = derived.filter((d) => !matches(d as unknown as Record<string, unknown>, where)); derived.length = 0; derived.push(...keep); return { count: before - keep.length }; }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const rows = derived.filter((d) => matches(d as unknown as Record<string, unknown>, where));
      for (const r of rows) {
        for (const [k, v] of Object.entries(data)) {
          if (k === "attempts" && v && typeof v === "object" && "increment" in v) { r.attempts += (v as { increment: number }).increment; } else { (r as unknown as Record<string, unknown>)[k] = v; }
        }
      }
      return { count: rows.length };
    }),
  },
};
vi.mock("@/server/db/client", () => ({ getDb: () => db }));

// The store, serving one original from memory with the real API's edges: null when missing, a 416 past the end.
const fixture = (name: string): Buffer => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
let original: Buffer = Buffer.alloc(0);
let originalPresent = true;
const headMock = vi.fn(async (pathname: string, _options?: { signal?: AbortSignal }) => (originalPresent ? { pathname, url: `https://blob.test/${pathname}`, size: original.byteLength, contentType: "video/quicktime", uploadedAt: new Date() } : null));
const readPrefixMock = vi.fn(async (_pathname: string, maxBytes: number, _options?: { signal?: AbortSignal }) => (originalPresent ? new Uint8Array(original.subarray(0, maxBytes)) : null));
const readRangeMock = vi.fn(async (_pathname: string, offset: number, length: number, _options?: { signal?: AbortSignal }) => {
  if (!originalPresent) { return null; }
  if (offset >= original.byteLength) { throw new Error("BlobError: 416 Range Not Satisfiable"); }
  return new Uint8Array(original.subarray(offset, Math.min(offset + length, original.byteLength)));
});
const putMock = vi.fn(async (pathname: string, _data: Buffer, contentType: string) => ({ pathname, url: `https://blob.test/${pathname}`, size: 1, contentType, uploadedAt: new Date() }));
const delMock = vi.fn(async (_key: string) => undefined);
const getMock = vi.fn(async () => { throw new Error("a poster never downloads the whole original"); });
vi.mock("@/services/storage", () => ({ createStorageService: () => ({ head: headMock, readPrefix: readPrefixMock, readRange: readRangeMock, put: putMock, del: delMock, get: getMock, presignGet: vi.fn() }) }));

// The image slot: every slot handed out must be released, whatever the path (asserted after each test).
const POSTER_JPEG = { data: Buffer.from("poster-jpeg"), mimeType: "image/jpeg", extension: "jpg", width: 160, height: 90 };
const thumbnailMock = vi.fn(async (_input: Buffer, _options: unknown): Promise<ThumbnailSet> => ({ sourceWidth: 160, sourceHeight: 90, thumb: POSTER_JPEG }));
const slots: { release: ReturnType<typeof vi.fn> }[] = [];
const acquireMock = vi.fn(async (_deadlineMs: number) => {
  const slot = { thumbnail: (i: Buffer, o: unknown) => thumbnailMock(i, o), derive: vi.fn(), release: vi.fn() };
  slots.push(slot);
  return slot;
});
vi.mock("@/services/images", async (importOriginal) => {
  const actual = await importOriginal<typeof ImagesModule>();
  return { ...actual, createImageService: () => ({ acquire: (ms: number) => acquireMock(ms), derive: vi.fn(), inFlight: () => 0, waiting: () => 0 }) };
});

// The frame service. By default it reads the first bytes through the feature's `read`, then returns a frame.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const availableMock = vi.fn(async () => true);
const extractMock = vi.fn(async (input: ExtractPosterInput): Promise<ExtractPosterResult> => {
  await input.read(0, 8, new AbortController().signal);
  return { ok: true, png: PNG, sourceBytesRead: 8, toneMapped: false, seekSeconds: 1 };
});
const frameServiceMock = vi.fn(() => ({ available: () => availableMock(), extractPoster: (input: ExtractPosterInput) => extractMock(input) }));
vi.mock("@/services/video-frames", () => ({ createVideoFrameService: () => frameServiceMock() }));

const trackSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/video-track", async (importOriginal) => {
  const actual = await importOriginal<typeof VideoTrackModule>();
  return { ...actual, readVideoTrackInfo: (...args: Parameters<typeof actual.readVideoTrackInfo>) => { trackSpy.calls += 1; return actual.readVideoTrackInfo(...args); } };
});

const sentry = vi.hoisted(() => ({
  spans: [] as { options: { name: string; op: string }; attributes: Record<string, unknown> }[],
  messages: [] as unknown[][],
}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: async (options: { name: string; op: string; attributes?: Record<string, unknown> }, callback: (span: unknown) => unknown) => {
    const record = { options, attributes: { ...options.attributes } };
    sentry.spans.push(record);
    return callback({ setAttribute: (k: string, v: unknown) => { record.attributes[k] = v; }, setAttributes: (a: Record<string, unknown>) => { Object.assign(record.attributes, a); } });
  },
  captureException: vi.fn(),
  captureMessage: (...args: unknown[]) => { sentry.messages.push(args); },
  flush: vi.fn(async () => true),
}));

const logs = vi.hoisted(() => ({ lines: [] as { level: string; fields: Record<string, unknown>; message: string }[] }));
const logErrorMock = vi.fn();
vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof LoggerModule>();
  const at = (level: string) => (fields: Record<string, unknown>, message: string) => { logs.lines.push({ level, fields, message }); };
  return { ...actual, createLogger: () => ({ debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") }), logError: (...args: unknown[]) => logErrorMock(...args) };
});

import { CLAIM_MARGIN_MS, derivePoster, INSPECT_STALL_REPORT_MS, POSTER_MIN_BUDGET_MS, PUBLISH_RESERVE_MS } from "@/features/memories/derive-poster";
import { isEligible, MAX_DECODE_ATTEMPTS, MAX_PIXELS } from "@/features/memories/derived-claims";

const NOW = new Date("2026-11-08T12:00:00Z");
const STALE = new Date(NOW.getTime() - 11 * 60_000);
const VIDEO_KEY = "dev/originals/mem_1/0f6a1c7e-3f1a-4b5e-9c2d-1234567890ab.mov";
const DERIVED_KEY = /^dev\/derived\/mem_1\/[0-9a-f-]{36}\.jpg$/;

function video(over: Partial<MediaRow> = {}): MediaRow {
  return { id: "med_v", memoryId: "mem_1", status: "READY", mimeType: "video/quicktime", storageKey: VIDEO_KEY, deletedAt: null, width: null, height: null, memory: { deletedAt: null }, ...over };
}
function poster(over: Partial<DerivedRow> = {}): DerivedRow {
  return { id: `der_${nextId++}`, mediaId: "med_v", kind: "POSTER", status: "PENDING", storageKey: "dev/derived/mem_1/previous.jpg", mimeType: null, sizeBytes: null, width: null, height: null, error: null, attempts: 1, claimedAt: NOW, ...over };
}
const run = (deadlineMs = 15_000) => derivePoster({ mediaId: "med_v", deadlineMs, now: NOW });
/** What every step before the claim keeps: the poster's own budget, the write-and-publish reserve and the claim's margin. */
const PRE_CLAIM_MS = POSTER_MIN_BUDGET_MS + PUBLISH_RESERVE_MS + CLAIM_MARGIN_MS;
const posterRow = () => derived.find((d) => d.kind === "POSTER");

/** The offset of a box's header (its size field) whose type is `type`, searched from `from`. */
function boxAt(bytes: Buffer, type: string, from = 0): number {
  const at = bytes.indexOf(Buffer.from(type, "latin1"), from);
  if (at < 4) { throw new Error(`no ${type} box in the fixture`); }
  return at - 4;
}
/** A copy of an MP4/MOV whose first video sample entry declares `width` × `height`. */
function withSampleEntrySize(bytes: Buffer, width: number, height: number): Buffer {
  const copy = Buffer.from(bytes);
  const entry = boxAt(copy, "stsd") + 8 + 8; // stsd header, then version/flags and entry_count
  copy.writeUInt16BE(width, entry + 8 + 24);
  copy.writeUInt16BE(height, entry + 8 + 26);
  return copy;
}
/** A copy whose stsd claims no sample entry: the reader's `failed` (a malformed box). */
function withEmptyStsd(bytes: Buffer): Buffer {
  const copy = Buffer.from(bytes);
  copy.writeUInt32BE(0, boxAt(copy, "stsd") + 8 + 4);
  return copy;
}

beforeEach(() => {
  delete process.env.VERCEL_ENV; resetEnvCache();
  media = [video()]; derived = []; lockCalls.length = 0; nextId = 1;
  original = fixture("poster-hevc-moov-last.mov"); originalPresent = true;
  slots.length = 0; sentry.spans.length = 0; sentry.messages.length = 0; logs.lines.length = 0; trackSpy.calls = 0;
  // Every fake is `vi.fn(impl)`: a reset restores `impl` and drops any unused `mockImplementationOnce`.
  vi.resetAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  // D6 on every path: the Media row is never written (the fakes above also throw if it were).
  expect(db.media.update).not.toHaveBeenCalled();
  expect(db.media.updateMany).not.toHaveBeenCalled();
  // The image slot is always handed back.
  for (const slot of slots) {
    expect(slot.release).toHaveBeenCalled();
  }
  // Nothing is ever written outside the derived prefix, and the original is never deleted.
  for (const [key] of putMock.mock.calls) { expect(key).toMatch(DERIVED_KEY); }
  expect(delMock).not.toHaveBeenCalledWith(VIDEO_KEY);
});

describe("derivePoster", () => {
  it("claims, extracts inside a media.poster span, re-encodes at the thumbnail spec and publishes a READY POSTER with a jpg key", async () => {
    expect(await run()).toBe("derived");
    const row = posterRow()!;
    expect(row).toMatchObject({ status: "READY", mimeType: "image/jpeg", sizeBytes: POSTER_JPEG.data.byteLength, width: 160, height: 90, error: null, attempts: 1 });
    expect(row.storageKey).toMatch(DERIVED_KEY);
    expect(putMock).toHaveBeenCalledWith(row.storageKey, POSTER_JPEG.data, "image/jpeg");
    expect(lockCalls[0]).toContain("FOR UPDATE|mem_1");

    const input = extractMock.mock.calls[0]![0];
    expect(input).toMatchObject({ size: original.byteLength, container: "mov", transferKind: "unknown" });
    expect(sentry.spans.map((s) => s.options)).toEqual([expect.objectContaining({ name: "video poster", op: "media.poster" })]);
    const options = thumbnailMock.mock.calls[0]![1] as { sourceMime: string; maxPixels: number; thumb: unknown; deadlineMs: number };
    const { DERIVE_DEFAULTS } = await import("@/services/images");
    expect(options).toMatchObject({ sourceMime: "image/png", maxPixels: MAX_VIDEO_PIXELS, thumb: DERIVE_DEFAULTS.thumb });
    expect(options.deadlineMs).toBeGreaterThan(0);
    expect(thumbnailMock.mock.calls[0]![0]).toBe(PNG);

    // Slot before the claim; the claim before ffmpeg; ffmpeg, then sharp, then the slot back, then the publish.
    const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0]!;
    expect(order(availableMock)).toBeLessThan(order(acquireMock));
    expect(order(acquireMock)).toBeLessThan(order(db.derivedMedia.create));
    expect(order(db.derivedMedia.create)).toBeLessThan(order(extractMock));
    expect(order(extractMock)).toBeLessThan(order(thumbnailMock));
    expect(order(thumbnailMock)).toBeLessThan(order(slots[0]!.release));
    expect(order(slots[0]!.release)).toBeLessThan(order(putMock));
    expect(order(putMock)).toBeLessThan(order(db.$transaction));
    expect(getMock).not.toHaveBeenCalled();
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("logs the outcome with the timing, the bytes read and the transfer, never a URL", async () => {
    extractMock.mockImplementationOnce(async () => ({ ok: true, png: PNG, sourceBytesRead: 1_234, toneMapped: true, seekSeconds: 0 }));
    await run();
    const line = logs.lines.find((l) => l.fields.action === "poster_derived")!;
    // The inspection's reads (the 128-byte prefix and the track reader's ranges) count as well as ffmpeg's.
    const inspectBytes = 128 + readRangeMock.mock.calls.reduce((sum, [, , length]) => sum + length, 0);
    expect(inspectBytes).toBeGreaterThan(1_000);
    expect(line.fields).toMatchObject({ mediaId: "med_v", memoryId: "mem_1", outcome: "derived", inspectBytes, frameBytes: 1_234, sourceBytesRead: inspectBytes + 1_234, transferKind: "unknown", toneMapped: true, seekSeconds: 0, container: "mov" });
    expect(typeof line.fields.durationMs).toBe("number");
    expect(JSON.stringify(logs.lines)).not.toMatch(/https?:\/\//);
    expect(sentry.spans[0]!.attributes).toMatchObject({ "poster.container": "mov", "poster.transfer_kind": "unknown", "poster.outcome": "ok", "poster.source_bytes_read": 1_234 });
  });

  it("reads the original only through ranges of the stored key, within its size, with the caller's signal", async () => {
    const signal = new AbortController().signal;
    extractMock.mockImplementationOnce(async (input) => {
      const bytes = await input.read(input.size - 4, 4, signal);
      expect(Buffer.from(bytes)).toEqual(original.subarray(original.byteLength - 4));
      await expect(input.read(input.size, 1, signal)).rejects.toThrow(RangeError);
      await expect(input.read(-1, 4, signal)).rejects.toThrow(RangeError);
      return { ok: true, png: PNG, sourceBytesRead: 4, toneMapped: false, seekSeconds: 1 };
    });
    expect(await run()).toBe("derived");
    const last = readRangeMock.mock.calls.at(-1)!;
    expect(last.slice(0, 3)).toEqual([VIDEO_KEY, original.byteLength - 4, 4]);
    expect(last[3]?.signal?.aborted).toBe(false);
    expect(readRangeMock.mock.calls.every(([key, offset, length]) => key === VIDEO_KEY && offset + length <= original.byteLength)).toBe(true);
  });

  describe("containers, sniffed from the first 128 bytes", () => {
    it("forces matroska for EBML (WebM) and skips the MP4 track reader", async () => {
      original = fixture("poster-vp9-nocues.webm");
      media = [video({ mimeType: "video/webm" })];
      expect(await run()).toBe("derived");
      expect(extractMock.mock.calls[0]![0]).toMatchObject({ container: "matroska", transferKind: "unknown", size: original.byteLength });
      expect(trackSpy.calls).toBe(0);
      expect(readPrefixMock).toHaveBeenCalledWith(VIDEO_KEY, 128, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    });

    it("forces mov for an MP4 brand and for a QuickTime file, whatever the row's label says", async () => {
      original = fixture("poster-h264-faststart.mp4");
      media = [video({ mimeType: "video/webm" })];
      expect(await run()).toBe("derived");
      expect(extractMock.mock.calls[0]![0]).toMatchObject({ container: "mov" });
      expect(trackSpy.calls).toBe(1);
    });

    it("passes the track's HDR transfer to the frame service (HLG is tone-mapped there)", async () => {
      original = fixture("poster-hlg-1080p.mov");
      expect(await run()).toBe("derived");
      expect(extractMock.mock.calls[0]![0]).toMatchObject({ container: "mov", transferKind: "hlg" });
    });

    it("refuses bytes that are neither ISO BMFF/QuickTime nor Matroska: unsupported_type, final, nothing extracted", async () => {
      original = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(200, 7)]);
      expect(await run()).toBe("failed");
      expect(posterRow()).toMatchObject({ status: "FAILED", error: "unsupported_type", attempts: 1 });
      expect(isEligible(posterRow()!, NOW, MAX_VIDEO_PIXELS)).toBe("not_eligible");
      expect(extractMock).not.toHaveBeenCalled();
      expect(trackSpy.calls).toBe(0);
      expect(logErrorMock).not.toHaveBeenCalled();
    });
  });

  describe("the MP4 track reader (rulings R6, R7)", () => {
    it("a malformed movie box (`failed`) is a retryable decode_failed, reported with the reader's error", async () => {
      original = withEmptyStsd(fixture("poster-hevc-moov-last.mov"));
      expect(await run()).toBe("failed");
      expect(posterRow()).toMatchObject({ status: "FAILED", error: "decode_failed", attempts: 1 });
      expect(isEligible(posterRow()!, NOW, MAX_VIDEO_PIXELS)).toBe("eligible");
      expect(extractMock).not.toHaveBeenCalled();
      expect(logErrorMock).toHaveBeenCalledTimes(1);
      const [, error, context] = logErrorMock.mock.calls[0]! as [string, Error, Record<string, unknown>];
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/stsd has no sample entry/);
      expect(context).toMatchObject({ mediaId: "med_v", code: "decode_failed" });
    });

    it("no video track (`absent`) is no_video_stream, final", async () => {
      original = fixture("audio-only.m4a");
      expect(await run()).toBe("failed");
      expect(posterRow()).toMatchObject({ status: "FAILED", error: "no_video_stream" });
      expect(isEligible(posterRow()!, NOW, MAX_VIDEO_PIXELS)).toBe("not_eligible");
      expect(extractMock).not.toHaveBeenCalled();
      expect(logErrorMock).not.toHaveBeenCalled();
    });

    it("refuses a declared track over MAX_VIDEO_PIXELS as too_many_pixels:<MAX_VIDEO_PIXELS>, final, before ffmpeg", async () => {
      original = withSampleEntrySize(fixture("poster-hevc-moov-last.mov"), 8000, 4500);
      expect(await run()).toBe("failed");
      expect(posterRow()).toMatchObject({ status: "FAILED", error: `too_many_pixels:${MAX_VIDEO_PIXELS}` });
      expect(isEligible(posterRow()!, NOW, MAX_VIDEO_PIXELS)).toBe("not_eligible");
      expect(extractMock).not.toHaveBeenCalled();
    });

    it("lets exactly 8K through, and treats 0×0 as unknown dimensions (ffmpeg's -max_pixels guards them)", async () => {
      original = withSampleEntrySize(fixture("poster-hevc-moov-last.mov"), 7680, 4320);
      expect(await run()).toBe("derived");
      derived = [];
      original = withSampleEntrySize(fixture("poster-hevc-moov-last.mov"), 0, 0);
      expect(await run()).toBe("derived");
      expect(extractMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("eligibility", () => {
    it("does nothing for a non-video, a disallowed video type, a row not READY, removed, of a deleted memory or under a foreign prefix", async () => {
      const cases: Partial<MediaRow>[] = [
        { mimeType: "image/jpeg" }, { mimeType: "audio/mp4" }, { mimeType: "video/x-msvideo" }, { status: "PENDING" },
        { deletedAt: new Date() }, { memory: { deletedAt: new Date() } }, { storageKey: "originals/mem_1/0f6a1c7e.mov" },
      ];
      for (const over of cases) {
        media = [video(over)];
        expect(await run()).toBe("not_eligible");
      }
      media = [];
      expect(await run()).toBe("not_eligible");
      expect(availableMock).not.toHaveBeenCalled();
      expect(acquireMock).not.toHaveBeenCalled();
      expect(headMock).not.toHaveBeenCalled();
      expect(derived).toHaveLength(0);
    });

    it("leaves a READY poster and every final failure alone, and a live claim to its holder, before taking the slot", async () => {
      const finals = ["no_video_stream", "no_frame", "source_limit", "unsupported_type", `too_many_pixels:${MAX_VIDEO_PIXELS}`, "too_large", "abandoned"];
      for (const error of finals) {
        derived = [poster({ status: "FAILED", error })];
        expect(await run()).toBe("not_eligible");
      }
      derived = [poster({ status: "READY" })];
      expect(await run()).toBe("not_eligible");
      derived = [poster({ status: "FAILED", error: "timeout", attempts: MAX_DECODE_ATTEMPTS })];
      expect(await run()).toBe("not_eligible");
      derived = [poster({ claimedAt: new Date(NOW.getTime() - 60_000) })];
      expect(await run()).toBe("claimed_elsewhere");
      expect(availableMock).not.toHaveBeenCalled();
      expect(acquireMock).not.toHaveBeenCalled();
      expect(headMock).not.toHaveBeenCalled();
    });

    it("judges a pixel refusal against the video ceiling: one recorded under the photo ceiling is retried once", async () => {
      derived = [poster({ status: "FAILED", error: `too_many_pixels:${MAX_PIXELS}` })];
      expect(await run()).toBe("derived");
      expect(posterRow()).toMatchObject({ status: "READY", attempts: 2 });
    });

    it("retries decode_failed and timeout while attempts remain", async () => {
      derived = [poster({ status: "FAILED", error: "decode_failed", attempts: 2, storageKey: "dev/derived/mem_1/failed.jpg" })];
      expect(await run()).toBe("derived");
      expect(posterRow()).toMatchObject({ status: "READY", attempts: 3 });
      expect(posterRow()!.storageKey).toMatch(DERIVED_KEY);
      derived = [poster({ status: "FAILED", error: "timeout", attempts: 1 })];
      expect(await run()).toBe("derived");
    });
  });

  describe("preflight: every miss before the claim is deferred and spends no attempt", () => {
    it("defers when the ffmpeg binary is not available, and reports it", async () => {
      availableMock.mockResolvedValueOnce(false);
      expect(await run()).toBe("deferred");
      expect(derived).toHaveLength(0);
      expect(acquireMock).not.toHaveBeenCalled();
      expect(headMock).not.toHaveBeenCalled();
      expect(logErrorMock).toHaveBeenCalledTimes(1);
      expect(logErrorMock.mock.calls[0]![2]).toMatchObject({ mediaId: "med_v" });
    });

    it("defers when the slot's waiting line is full or the wait runs out", async () => {
      acquireMock.mockRejectedValueOnce(new ImageDeriveError("busy"));
      expect(await run()).toBe("deferred");
      acquireMock.mockRejectedValueOnce(new ImageDeriveError("timeout"));
      expect(await run()).toBe("deferred");
      expect(derived).toHaveLength(0);
      expect(headMock).not.toHaveBeenCalled();
      expect(logErrorMock).not.toHaveBeenCalled();
    });

    it(`defers with less than ${POSTER_MIN_BUDGET_MS} ms of budget, before waiting for the slot or reading a byte`, async () => {
      expect(POSTER_MIN_BUDGET_MS).toBe(6_000);
      expect(await run(POSTER_MIN_BUDGET_MS - 1)).toBe("deferred");
      expect(derived).toHaveLength(0);
      expect(availableMock).not.toHaveBeenCalled();
      expect(acquireMock).not.toHaveBeenCalled();
      expect(headMock).not.toHaveBeenCalled();
    });

    it(`defers with less than the floor, the ${PUBLISH_RESERVE_MS} ms write-and-publish reserve and the claim's ${CLAIM_MARGIN_MS} ms margin, before the binary, the slot or a byte`, async () => {
      expect(CLAIM_MARGIN_MS).toBe(1_000);
      expect(PUBLISH_RESERVE_MS).toBe(2_000);
      expect(await run(PRE_CLAIM_MS - 1)).toBe("deferred");
      expect(availableMock).not.toHaveBeenCalled();
      expect(acquireMock).not.toHaveBeenCalled();
      expect(headMock).not.toHaveBeenCalled();
      expect(logs.lines.find((l) => l.fields.action === "poster_deferred")?.fields).toMatchObject({ code: "budget" });
    });

    it("waits for the slot only while the poster's own budget, the reserve and the claim's margin would stay whole", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      expect(await run(15_000)).toBe("derived");
      expect(acquireMock.mock.calls[0]![0]).toBe(15_000 - PRE_CLAIM_MS);
    });

    it("defers at exactly the floor, the reserve and the margin, before the binary or the slot, never waiting 0 ms for it (TCR B2-4)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      expect(await run(PRE_CLAIM_MS)).toBe("deferred");
      expect(availableMock).not.toHaveBeenCalled();
      expect(acquireMock).not.toHaveBeenCalled();
      expect(headMock).not.toHaveBeenCalled();
      expect(logs.lines.find((l) => l.fields.action === "poster_deferred")?.fields).toMatchObject({ code: "budget" });
      // One millisecond more starts the run and waits at most that millisecond for the slot.
      expect(await run(PRE_CLAIM_MS + 1)).toBe("derived");
      expect(acquireMock.mock.calls).toEqual([[1]]);
    });

    /** A slot that arrives `ms` after it was asked for. */
    const slowSlot = (ms: number) => async () => {
      vi.setSystemTime(Date.now() + ms);
      const slot = { thumbnail: (i: Buffer, o: unknown) => thumbnailMock(i, o), derive: vi.fn(), release: vi.fn() };
      slots.push(slot);
      return slot;
    };

    it("defers without reading when the slot leaves no inspection window (it arrives with exactly the floor, the reserve and the margin)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      acquireMock.mockImplementationOnce(slowSlot(1_000));
      expect(await run(PRE_CLAIM_MS + 1_000)).toBe("deferred");
      expect(headMock).not.toHaveBeenCalled();
      expect(logs.lines.find((l) => l.fields.action === "poster_deferred")?.fields).toMatchObject({ code: "budget" });
    });

    it("defers without reading when the slot arrives with less than that left", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      acquireMock.mockImplementationOnce(slowSlot(1_500));
      expect(await run(PRE_CLAIM_MS + 500)).toBe("deferred");
      expect(headMock).not.toHaveBeenCalled();
      expect(derived).toHaveLength(0);
    });

    it("defers without claiming when reading the headers leaves less than the floor, the reserve and the claim's margin", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      headMock.mockImplementationOnce(async (pathname: string) => {
        // 8.5 s left: the whole floor and reserve, but not the claim's margin on top of them.
        vi.setSystemTime(Date.now() + 2_500);
        return { pathname, url: "https://blob.test/x", size: original.byteLength, contentType: "video/quicktime", uploadedAt: new Date() };
      });
      expect(await run(PRE_CLAIM_MS + 2_000)).toBe("deferred");
      expect(logs.lines.find((l) => l.fields.action === "poster_deferred")?.fields).toMatchObject({ code: "budget" });
      expect(derived).toHaveLength(0);
      expect(extractMock).not.toHaveBeenCalled();
    });
  });

  describe("claim races", () => {
    it("reports a unique-constraint loss (another worker claimed after our read) as claimed elsewhere", async () => {
      headMock.mockImplementationOnce(async (pathname: string) => {
        derived.push(poster({ storageKey: "dev/derived/mem_1/theirs.jpg" }));
        return { pathname, url: "https://blob.test/x", size: original.byteLength, contentType: "video/quicktime", uploadedAt: new Date() };
      });
      expect(await run()).toBe("claimed_elsewhere");
      expect(db.derivedMedia.create).toHaveBeenCalledTimes(1);
      expect(db.derivedMedia.findFirst).toHaveBeenCalledWith({ where: { mediaId: "med_v", kind: "POSTER" } });
      expect(extractMock).not.toHaveBeenCalled();
      expect(posterRow()).toMatchObject({ status: "PENDING", storageKey: "dev/derived/mem_1/theirs.jpg" });
      expect(delMock).not.toHaveBeenCalled();
    });

    it("re-reads a unique-constraint loss and judges the row it finds (already READY → not eligible)", async () => {
      headMock.mockImplementationOnce(async (pathname: string) => {
        derived.push(poster({ status: "READY" }));
        return { pathname, url: "https://blob.test/x", size: original.byteLength, contentType: "video/quicktime", uploadedAt: new Date() };
      });
      expect(await run()).toBe("not_eligible");
      expect(db.derivedMedia.create).toHaveBeenCalledTimes(1);
      expect(db.derivedMedia.findFirst).toHaveBeenCalledTimes(1);
      expect(extractMock).not.toHaveBeenCalled();
    });

    it("reclaims a stale PENDING row: a new key, the half-written one deleted, the attempt counted", async () => {
      derived = [poster({ claimedAt: STALE, storageKey: "dev/derived/mem_1/stale.jpg" })];
      expect(await run()).toBe("derived");
      expect(delMock).toHaveBeenCalledWith("dev/derived/mem_1/stale.jpg");
      expect(posterRow()).toMatchObject({ status: "READY", attempts: 2 });
      expect(posterRow()!.storageKey).toMatch(DERIVED_KEY);
    });

    it("retires a stale claim that has used up its attempts as abandoned, without extracting", async () => {
      derived = [poster({ claimedAt: STALE, attempts: MAX_DECODE_ATTEMPTS, storageKey: "dev/derived/mem_1/dead.jpg" })];
      expect(await run()).toBe("failed");
      expect(posterRow()).toMatchObject({ status: "FAILED", error: "abandoned" });
      expect(delMock).toHaveBeenCalledWith("dev/derived/mem_1/dead.jpg");
      // Retired before the preflight: no binary check, no slot, no byte of the original.
      expect(availableMock).not.toHaveBeenCalled();
      expect(acquireMock).not.toHaveBeenCalled();
      expect(headMock).not.toHaveBeenCalled();
      expect(extractMock).not.toHaveBeenCalled();
    });
  });

  describe("extraction outcomes", () => {
    const finals = ["no_video_stream", "no_frame", "source_limit", "unsupported_type", `too_many_pixels:${MAX_VIDEO_PIXELS}`] as const;
    const retryable = ["decode_failed", "timeout"] as const;

    for (const code of [...finals, ...retryable]) {
      it(`records ${code} on our claim, deletes nothing it did not write, and logs the run`, async () => {
        extractMock.mockImplementationOnce(async () => ({ ok: false, code, detail: `detail for ${code}`, sourceBytesRead: 77, stderrTail: "tail of stderr" }));
        expect(await run()).toBe("failed");
        const row = posterRow()!;
        expect(row).toMatchObject({ status: "FAILED", error: code, attempts: 1 });
        expect(isEligible(row, NOW, MAX_VIDEO_PIXELS)).toBe((finals as readonly string[]).includes(code) ? "not_eligible" : "eligible");
        expect(putMock).not.toHaveBeenCalled();
        expect(thumbnailMock).not.toHaveBeenCalled();
        // failClaims deletes the never-written candidate (idempotent), never anything else.
        expect(delMock.mock.calls).toEqual([[row.storageKey]]);
        const line = logs.lines.find((l) => l.fields.action === "poster_failed")!;
        expect(line.fields).toMatchObject({ mediaId: "med_v", code, detail: `detail for ${code}`, stderrTail: "tail of stderr", frameBytes: 77, transferKind: "unknown" });
        expect(line.fields.sourceBytesRead).toBe((line.fields.inspectBytes as number) + 77);
        expect(typeof line.fields.durationMs).toBe("number");
        expect(logErrorMock).not.toHaveBeenCalled();
        expect(sentry.spans[0]!.attributes).toMatchObject({ "poster.outcome": code });
      });
    }

    it("a final failure is never extracted again; a retryable one is, until its attempts run out", async () => {
      extractMock.mockImplementationOnce(async () => ({ ok: false, code: "no_frame", detail: "none", sourceBytesRead: 0 }));
      await run();
      expect(await run()).toBe("not_eligible");
      expect(extractMock).toHaveBeenCalledTimes(1);

      derived = [];
      extractMock.mockClear();
      extractMock.mockImplementation(async () => ({ ok: false, code: "timeout", detail: "slow", sourceBytesRead: 0 }));
      expect([await run(), await run(), await run(), await run()]).toEqual(["failed", "failed", "failed", "not_eligible"]);
      expect(extractMock).toHaveBeenCalledTimes(MAX_DECODE_ATTEMPTS);
      expect(posterRow()).toMatchObject({ status: "FAILED", error: "timeout", attempts: MAX_DECODE_ATTEMPTS });
    });

    it("reports a failure that carries an error (a failed source read) with its stack", async () => {
      const cause = new Error("blob read reset");
      extractMock.mockImplementationOnce(async () => ({ ok: false, code: "decode_failed", detail: "the frame source failed: blob read reset", sourceBytesRead: 4096, error: cause }));
      expect(await run()).toBe("failed");
      expect(logErrorMock).toHaveBeenCalledTimes(1);
      expect(logErrorMock.mock.calls[0]![1]).toBe(cause);
      expect(logErrorMock.mock.calls[0]![2]).toMatchObject({ mediaId: "med_v", code: "decode_failed", frameBytes: 4096 });
    });

    it("`deferred` after the claim (the binary vanished, a server error) deletes only our PENDING row and spends no attempt", async () => {
      const serverError = new Error("accept EMFILE");
      extractMock.mockImplementationOnce(async () => ({ ok: false, code: "deferred", detail: "the loopback server failed", sourceBytesRead: 0, error: serverError }));
      expect(await run()).toBe("deferred");
      expect(derived).toHaveLength(0);
      expect(db.derivedMedia.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ status: "PENDING", claimedAt: NOW }) });
      expect(putMock).not.toHaveBeenCalled();
      expect(logErrorMock).toHaveBeenCalledTimes(1);
      expect(logErrorMock.mock.calls[0]![1]).toBe(serverError);
      // The next run starts from no row at all.
      expect(await run()).toBe("derived");
      expect(posterRow()).toMatchObject({ status: "READY", attempts: 1 });
    });

    it("`deferred` after the claim leaves a row another worker has taken over in the meantime", async () => {
      extractMock.mockImplementationOnce(async () => {
        Object.assign(posterRow()!, { claimedAt: new Date(NOW.getTime() + 1), attempts: 2, storageKey: "dev/derived/mem_1/theirs.jpg" });
        return { ok: false, code: "deferred", detail: "ffmpeg could not start (ENOENT)", sourceBytesRead: 0 };
      });
      expect(await run()).toBe("deferred");
      expect(posterRow()).toMatchObject({ status: "PENDING", attempts: 2, storageKey: "dev/derived/mem_1/theirs.jpg" });
      expect(logErrorMock).toHaveBeenCalledTimes(1);
    });

    it("hands ffmpeg the budget minus the encoder's and the write-and-publish reserves, and records timeout when nothing is left for the encode", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      extractMock.mockImplementationOnce(async (input) => {
        // Date is frozen until here: the whole budget less the encoder's 1 s and the write and publish's 2 s.
        expect(input.deadlineMs).toBe(12_000);
        vi.setSystemTime(Date.now() + 15_000);
        return { ok: true, png: PNG, sourceBytesRead: 8, toneMapped: false, seekSeconds: 1 };
      });
      expect(await run(15_000)).toBe("failed");
      expect(posterRow()).toMatchObject({ status: "FAILED", error: "timeout" });
      expect(thumbnailMock).not.toHaveBeenCalled();
      expect(putMock).not.toHaveBeenCalled();
    });
  });

  describe("re-encode and publish", () => {
    it("keeps the write-and-publish reserve out of sharp's deadline too", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      expect(await run(15_000)).toBe("derived");
      expect((thumbnailMock.mock.calls[0]![1] as { deadlineMs: number }).deadlineMs).toBe(15_000 - PUBLISH_RESERVE_MS);
    });

    it("records timeout, spending the attempt, when ffmpeg leaves less than the reserve: the encode would eat the write's time", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      extractMock.mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 15_000 - PUBLISH_RESERVE_MS);
        return { ok: true, png: PNG, sourceBytesRead: 8, toneMapped: false, seekSeconds: 1 };
      });
      expect(await run(15_000)).toBe("failed");
      expect(posterRow()).toMatchObject({ status: "FAILED", error: "timeout", attempts: 1 });
      expect(thumbnailMock).not.toHaveBeenCalled();
    });

    it("gives the claim back, spending no attempt, when the encode leaves too little for the write and the publish (TCR B2-5)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      thumbnailMock.mockImplementationOnce(async () => {
        // sharp overran its deadline: under the reserve is left for the write and the publish transaction.
        vi.setSystemTime(Date.now() + 15_000 - PUBLISH_RESERVE_MS + 1);
        return { sourceWidth: 160, sourceHeight: 90, thumb: POSTER_JPEG };
      });
      expect(await run(15_000)).toBe("deferred");
      expect(derived).toHaveLength(0);
      expect(putMock).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
      // Never silent: a run that keeps ending here would otherwise defer forever with no signal.
      expect(logErrorMock).toHaveBeenCalledTimes(1);
      expect(logErrorMock.mock.calls[0]![2]).toMatchObject({ mediaId: "med_v", code: "publish_budget" });
      // The next run starts from no row at all.
      vi.useRealTimers();
      expect(await run()).toBe("derived");
      expect(posterRow()).toMatchObject({ status: "READY", attempts: 1 });
    });

    it("gives the claim back and deletes the written blob when the write leaves too little for the publish (TCR B2-5)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const put = putMock.getMockImplementation()!;
      putMock.mockImplementationOnce(async (pathname: string, data: Buffer, contentType: string) => {
        // A slow write: 999 ms of the run's 15 s are left, under the 1 s the publish transaction keeps.
        vi.setSystemTime(NOW.getTime() + 15_000 - 999);
        return put(pathname, data, contentType);
      });
      expect(await run(15_000)).toBe("deferred");
      expect(derived).toHaveLength(0);
      expect(db.$transaction).not.toHaveBeenCalled();
      expect(delMock.mock.calls).toEqual([[putMock.mock.calls[0]![0]]]);
      expect(logErrorMock).toHaveBeenCalledTimes(1);
      expect(logErrorMock.mock.calls[0]![2]).toMatchObject({ mediaId: "med_v", code: "publish_budget" });
    });

    it("records too_large (final) when even the fallback quality is over budget, writing no blob", async () => {
      thumbnailMock.mockResolvedValueOnce({ sourceWidth: 160, sourceHeight: 90, thumb: { failed: "too_large" } });
      expect(await run()).toBe("failed");
      expect(posterRow()).toMatchObject({ status: "FAILED", error: "too_large" });
      expect(isEligible(posterRow()!, NOW, MAX_VIDEO_PIXELS)).toBe("not_eligible");
      expect(putMock).not.toHaveBeenCalled();
    });

    it("maps the encoder's refusals: pixels with their ceiling, decode_failed and timeout as they are", async () => {
      thumbnailMock.mockRejectedValueOnce(new ImageDeriveError("too_many_pixels", { limit: MAX_VIDEO_PIXELS }));
      expect(await run()).toBe("failed");
      expect(posterRow()).toMatchObject({ status: "FAILED", error: `too_many_pixels:${MAX_VIDEO_PIXELS}` });
      for (const code of ["decode_failed", "timeout"] as const) {
        derived = [];
        thumbnailMock.mockRejectedValueOnce(new ImageDeriveError(code));
        expect(await run()).toBe("failed");
        expect(posterRow()).toMatchObject({ status: "FAILED", error: code });
      }
      expect(putMock).not.toHaveBeenCalled();
      expect(logErrorMock).not.toHaveBeenCalled();
    });

    it("does not resurrect a video removed while its poster was made: the claim and the written blob are dropped", async () => {
      extractMock.mockImplementationOnce(async () => {
        media[0]!.deletedAt = new Date();
        return { ok: true, png: PNG, sourceBytesRead: 8, toneMapped: false, seekSeconds: 1 };
      });
      expect(await run()).toBe("claimed_elsewhere");
      expect(derived).toHaveLength(0);
      const written = putMock.mock.calls[0]![0];
      expect(delMock).toHaveBeenCalledWith(written);
      expect(delMock.mock.invocationCallOrder.every((o) => o > db.$transaction.mock.invocationCallOrder[0]!)).toBe(true);
    });

    it("does not resurrect a video whose memory was deleted meanwhile", async () => {
      extractMock.mockImplementationOnce(async () => {
        media[0]!.memory.deletedAt = new Date();
        return { ok: true, png: PNG, sourceBytesRead: 8, toneMapped: false, seekSeconds: 1 };
      });
      expect(await run()).toBe("claimed_elsewhere");
      expect(derived).toHaveLength(0);
    });

    it("loses the conditional publish to a worker that took the row over, and deletes only its own blob", async () => {
      putMock.mockImplementationOnce(async (pathname: string, _data: Buffer, contentType: string) => {
        Object.assign(posterRow()!, { claimedAt: new Date(NOW.getTime() + 1), attempts: 2, storageKey: "dev/derived/mem_1/theirs.jpg" });
        return { pathname, url: `https://blob.test/${pathname}`, size: 1, contentType, uploadedAt: new Date() };
      });
      expect(await run()).toBe("claimed_elsewhere");
      const ours = putMock.mock.calls[0]![0];
      expect(delMock.mock.calls).toEqual([[ours]]);
      expect(posterRow()).toMatchObject({ status: "PENDING", storageKey: "dev/derived/mem_1/theirs.jpg" });
    });

    it("a failed publish transaction (the database, not the video) gives the claim back, deletes our blob and spends no attempt", async () => {
      const failure = new Error("connection terminated");
      db.$transaction.mockRejectedValueOnce(failure);
      expect(await run()).toBe("deferred");
      expect(derived).toHaveLength(0);
      expect(delMock.mock.calls).toEqual([[putMock.mock.calls[0]![0]]]);
      expect(logErrorMock).toHaveBeenCalledTimes(1);
      expect(logErrorMock.mock.calls[0]![1]).toBe(failure);
      expect(logErrorMock.mock.calls[0]![2]).toMatchObject({ mediaId: "med_v", code: "write" });
    });

    it("a publish that committed but reported an error keeps its READY row and blob", async () => {
      db.$transaction.mockImplementationOnce(async (fn: (t: unknown) => Promise<unknown>) => { await fn(db); throw new Error("ack lost"); });
      expect(await run()).toBe("deferred");
      expect(posterRow()).toMatchObject({ status: "READY", storageKey: putMock.mock.calls[0]![0] });
      expect(delMock).not.toHaveBeenCalled();
    });

    it("a blob write that fails gives the claim back, deletes the candidate and spends no attempt", async () => {
      const failure = new Error("blob store down");
      putMock.mockRejectedValueOnce(failure);
      expect(await run()).toBe("deferred");
      expect(derived).toHaveLength(0);
      expect(delMock.mock.calls).toEqual([[putMock.mock.calls[0]![0]]]);
      expect(db.$transaction).not.toHaveBeenCalled();
      expect(logErrorMock).toHaveBeenCalledTimes(1);
      expect(logErrorMock.mock.calls[0]![1]).toBe(failure);
      expect(slots).toHaveLength(1);
      // The next run starts from no row at all.
      expect(await run()).toBe("derived");
      expect(posterRow()).toMatchObject({ status: "READY", attempts: 1 });
    });

    it("treats a publish that reports no POSTER outcome as an internal error, not a success", async () => {
      db.$transaction.mockImplementationOnce(async () => ({ outcomes: {}, keysToDelete: [] }));
      expect(await run()).toBe("failed");
      expect(posterRow()).toMatchObject({ status: "FAILED", error: "decode_failed" });
      expect(logErrorMock).toHaveBeenCalledTimes(1);
      expect((logErrorMock.mock.calls[0]![1] as Error).message).toMatch(/no POSTER outcome/);
    });
  });

  describe("reading the original", () => {
    it("a missing original is a retryable decode_failed, nothing extracted", async () => {
      originalPresent = false;
      expect(await run()).toBe("failed");
      expect(posterRow()).toMatchObject({ status: "FAILED", error: "decode_failed" });
      expect(extractMock).not.toHaveBeenCalled();
    });

    it("a store error while reading the headers is a retryable decode_failed, reported", async () => {
      readPrefixMock.mockRejectedValueOnce(new Error("blob store down"));
      expect(await run()).toBe("failed");
      expect(posterRow()).toMatchObject({ status: "FAILED", error: "decode_failed" });
      expect(logErrorMock).toHaveBeenCalledTimes(1);
      expect(logErrorMock.mock.calls[0]![2]).toMatchObject({ mediaId: "med_v", code: "decode_failed" });
    });

    describe("the inspection window: the reads stop while the whole poster budget is left", () => {
      /** A head that answers after `ms`, or rejects when its signal fires first (as the store's fetch does). */
      const slowHead = (ms: number) => (pathname: string, options?: { signal?: AbortSignal }) => new Promise<Awaited<ReturnType<typeof headMock>>>((resolve, reject) => {
        const timer = setTimeout(() => resolve({ pathname, url: "https://blob.test/x", size: original.byteLength, contentType: "video/quicktime", uploadedAt: new Date() }), ms);
        options?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("This operation was aborted")); }, { once: true });
      });
      /** The window a run of `budgetMs` reads in: what is left over the floor, the reserve and the claim's margin. */
      const windowOf = (budgetMs: number) => budgetMs - PRE_CLAIM_MS;
      const at = async (headMs: number, budgetMs = 10_000) => {
        vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
        vi.setSystemTime(NOW);
        headMock.mockImplementationOnce(slowHead(headMs));
        const outcome = run(budgetMs);
        // Exactly to the head's answer: inside the window it lands first; outside, the window's end fires before it.
        await vi.advanceTimersByTimeAsync(headMs);
        return outcome;
      };

      it("claims and extracts when the reads finish just inside the window (budget − floor − reserve − claim margin)", async () => {
        expect(await at(windowOf(10_000) - 1)).toBe("derived");
        expect(posterRow()).toMatchObject({ status: "READY", attempts: 1 });
        // ffmpeg got the whole floor and the unused claim margin less the encoder's reserve (the write and publish keep
        // theirs), not the remains of a long read.
        expect(extractMock.mock.calls[0]![0].deadlineMs).toBe(POSTER_MIN_BUDGET_MS + CLAIM_MARGIN_MS + 1 - 1_000);
      });

      it("keeps the claim when the claim itself takes up to its margin right after reads that ended at the window's edge", async () => {
        // The band the margin closes (T6 re-review): reads ending just inside the window, then a slow claim (a reclaim
        // deletes the previous candidate first). The run still holds the floor afterwards, so it is not given back.
        const create = db.derivedMedia.create.getMockImplementation()!;
        db.derivedMedia.create.mockImplementationOnce(async (args) => { vi.setSystemTime(Date.now() + CLAIM_MARGIN_MS - 100); return create(args); });
        expect(await at(windowOf(10_000) - 1)).toBe("derived");
        expect(posterRow()).toMatchObject({ status: "READY", attempts: 1 });
        expect(logs.lines.some((l) => l.fields.action === "poster_deferred")).toBe(false);
      });

      it("defers, claiming nothing, when the reads are still running at the window's end", async () => {
        expect(await at(windowOf(10_000) + 1)).toBe("deferred");
        expect(derived).toHaveLength(0);
        expect(db.derivedMedia.create).not.toHaveBeenCalled();
        expect(extractMock).not.toHaveBeenCalled();
        expect(logErrorMock).not.toHaveBeenCalled();
      });

      it("defers reads that end inside the floor's window but within the claim's margin, before claiming", async () => {
        expect(await at(10_000 - POSTER_MIN_BUDGET_MS - PUBLISH_RESERVE_MS - 1)).toBe("deferred");
        expect(db.derivedMedia.create).not.toHaveBeenCalled();
        expect(logs.lines.find((l) => l.fields.action === "poster_deferred")?.fields).toMatchObject({ code: "inspect_time" });
      });

      it("warns when a short window runs out (the upload callback's), and reports nothing", async () => {
        expect(windowOf(10_000)).toBeLessThan(INSPECT_STALL_REPORT_MS);
        expect(await at(windowOf(10_000) + 1)).toBe("deferred");
        const line = logs.lines.find((l) => l.fields.action === "poster_deferred");
        expect(line).toMatchObject({ level: "warn", fields: { mediaId: "med_v", memoryId: "mem_1", code: "inspect_time", inspectWindowMs: windowOf(10_000) } });
        expect(sentry.messages).toEqual([]);
        expect(logErrorMock).not.toHaveBeenCalled();
      });

      it("reports a stall to Sentry when a window of at least 10 s (the cron's) runs out: a stuck object is visible", async () => {
        expect(INSPECT_STALL_REPORT_MS).toBe(10_000);
        const cron = 20_000;
        expect(windowOf(cron)).toBeGreaterThanOrEqual(INSPECT_STALL_REPORT_MS);
        expect(await at(windowOf(cron) + 1, cron)).toBe("deferred");
        expect(derived).toHaveLength(0);
        expect(logs.lines.find((l) => l.fields.action === "poster_deferred")).toMatchObject({ level: "warn", fields: { code: "inspect_time", inspectWindowMs: windowOf(cron) } });
        expect(sentry.messages).toHaveLength(1);
        expect(sentry.messages[0]).toEqual([
          expect.stringContaining("stalled"),
          expect.objectContaining({ level: "warning", tags: { media_id: "med_v", memory_id: "mem_1" }, extra: expect.objectContaining({ code: "inspect_time", inspectWindowMs: windowOf(cron) }) }),
        ]);
        expect(JSON.stringify(sentry.messages)).not.toContain("blob.test");
      });

      it("reports a window exactly at the threshold, not one just under it", async () => {
        const budgetAt = (windowMs: number) => windowMs + PRE_CLAIM_MS;
        expect(await at(INSPECT_STALL_REPORT_MS + 1, budgetAt(INSPECT_STALL_REPORT_MS))).toBe("deferred");
        expect(sentry.messages).toHaveLength(1);
        vi.useRealTimers();
        sentry.messages.length = 0;
        expect(await at(INSPECT_STALL_REPORT_MS, budgetAt(INSPECT_STALL_REPORT_MS - 1))).toBe("deferred");
        expect(sentry.messages).toEqual([]);
      });

      it("never defers a deterministic verdict: a malformed movie box read in time still spends its attempt", async () => {
        original = withEmptyStsd(fixture("poster-hevc-moov-last.mov"));
        expect(await at(windowOf(10_000) - 1)).toBe("failed");
        expect(posterRow()).toMatchObject({ status: "FAILED", error: "decode_failed", attempts: 1 });
      });
    });

    it("gives the claim back, spending no attempt, when the claim itself outlasts its margin and leaves less than the floor and the reserve", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      derived = [poster({ claimedAt: STALE, storageKey: "dev/derived/mem_1/stale.jpg" })];
      db.derivedMedia.updateMany.mockImplementationOnce(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        // The reclaim is slow (it is followed by the previous candidate's delete): 2.5 s, well past its 1 s margin.
        vi.setSystemTime(Date.now() + 2_500);
        const rows = derived.filter((d) => matches(d as unknown as Record<string, unknown>, where));
        for (const r of rows) { Object.assign(r, { ...data, attempts: r.attempts + 1 }); }
        return { count: rows.length };
      });
      expect(await run(PRE_CLAIM_MS + 1_000)).toBe("deferred");
      expect(derived).toHaveLength(0);
      expect(extractMock).not.toHaveBeenCalled();
      expect(logErrorMock).not.toHaveBeenCalled();
      expect(logs.lines.find((l) => l.fields.action === "poster_deferred")?.fields).toMatchObject({ code: "budget" });
    });
  });

  describe("never throws", () => {
    it("a frame service that refuses to start (FFMPEG_BIN set, TCR B1-1) is reported and deferred, with nothing claimed or read", async () => {
      const refusal = new Error("FFMPEG_BIN is set, so ffmpeg-static would hand the poster code that file instead of its own binary");
      frameServiceMock.mockImplementationOnce(() => { throw refusal; });
      expect(await run()).toBe("deferred");
      expect(derived).toHaveLength(0);
      expect(acquireMock).not.toHaveBeenCalled();
      expect(headMock).not.toHaveBeenCalled();
      expect(logErrorMock).toHaveBeenCalledTimes(1);
      expect(logErrorMock.mock.calls[0]![1]).toBe(refusal);
    });

    it("a database error before any claim is reported and deferred", async () => {
      db.media.findUnique.mockRejectedValueOnce(new Error("db down"));
      expect(await run()).toBe("deferred");
      expect(logErrorMock).toHaveBeenCalledTimes(1);
      expect(derived).toHaveLength(0);
    });

    it("a claim that cannot be written is reported and deferred, with the slot released", async () => {
      db.derivedMedia.create.mockRejectedValueOnce(new Error("db down"));
      expect(await run()).toBe("deferred");
      expect(logErrorMock).toHaveBeenCalledTimes(1);
      expect(extractMock).not.toHaveBeenCalled();
      expect(slots).toHaveLength(1);
    });
  });
});
