import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as EmailAssetsModule from "@/lib/email-assets";
import type * as LoggerModule from "@/lib/logger";

type Kind = "WEB_IMAGE" | "THUMBNAIL" | "POSTER";
type Status = "PENDING" | "READY" | "FAILED";
interface Copy { kind: Kind; status: Status; storageKey: string; mimeType: string | null; sizeBytes: number | null; width: number | null; height: number | null; error: string | null; attempts: number; claimedAt: Date | null }
interface FileRow { id: string; memoryId: string; status: Status; mimeType: string; deletedAt: Date | null; createdAt: Date; derivatives: Copy[] }

// D1: the alert is reachable from the contributor pages, so its preview code must never load the poster path.
const posterPathLoaded = vi.hoisted(() => [] as string[]);
vi.mock("@/features/memories/derive-poster", () => { posterPathLoaded.push("features/memories/derive-poster"); return {}; });
vi.mock("@/services/video-frames", () => { posterPathLoaded.push("services/video-frames"); return {}; });
vi.mock("ffmpeg-static", () => { posterPathLoaded.push("ffmpeg-static"); return { default: null }; });

let files: FileRow[] = [];
type MediaWhere = { memoryId: string; deletedAt: null; status: Status };
type DerivativeWhere = { kind?: { in: Kind[] } };
const findManyMock = vi.fn(async ({ where, select }: { where: MediaWhere; select: { derivatives: { where?: DerivativeWhere } } }) =>
  files
    .filter((f) => f.memoryId === where.memoryId && f.deletedAt === null && f.status === where.status)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((f) => ({ ...f, derivatives: f.derivatives.filter((d) => select.derivatives.where?.kind?.in.includes(d.kind) ?? true) }))
);
vi.mock("@/server/db/client", () => ({ getDb: () => ({ media: { findMany: findManyMock } }) }));

const blobs = new Map<string, Buffer>();
const getMock = vi.fn(async (pathname: string, options?: { signal?: AbortSignal }) => {
  options?.signal?.throwIfAborted();
  const bytes = blobs.get(pathname);
  return bytes ? { stream: new Blob([new Uint8Array(bytes)]).stream(), contentType: "image/jpeg", contentLength: bytes.byteLength } : null;
});
vi.mock("@/services/storage", () => ({ createStorageService: () => ({ get: (pathname: string, options?: { signal?: AbortSignal }) => getMock(pathname, options) }) }));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof LoggerModule>();
  return { ...actual, logError: (...args: unknown[]) => logErrorMock(...args) };
});

// One brand mark that a preview id could collide with, so the reserved-id rule has something to refuse.
vi.mock("@/lib/email-assets", async (importOriginal) => {
  const actual = await importOriginal<typeof EmailAssetsModule>();
  return { ...actual, EMAIL_ASSETS: { ...actual.EMAIL_ASSETS, collides: { ...actual.EMAIL_ASSETS.heart, contentId: "preview-reserved0" } } };
});

import { loadAdminPreviews, PREVIEW_POLL_MS, waitForAdminPreviews } from "@/features/memories/admin-previews";
import { summarizeReadyMedia } from "@/features/memories/media-summary";
import { MAX_VIDEO_PIXELS } from "@/lib/video-frames";
import { buildMediaCards, MAX_PREVIEWS, PREVIEW_MAX_BYTES } from "@/services/email/templates/shared";

const T0 = new Date("2026-11-08T12:00:00Z").getTime();
let order = 0;

function copy(kind: Kind, mediaId: string, over: Partial<Copy> = {}): Copy {
  const storageKey = `dev/derived/mem_1/${mediaId}-${kind.toLowerCase()}.jpg`;
  return { kind, status: "READY", storageKey, mimeType: kind === "WEB_IMAGE" ? "image/heic" : "image/jpeg", sizeBytes: 1_000, width: 1000, height: 750, error: null, attempts: 1, claimedAt: null, ...over };
}
function file(id: string, mimeType: string, derivatives: Copy[], over: Partial<FileRow> = {}): FileRow {
  order += 1;
  return { id, memoryId: "mem_1", status: "READY", mimeType, deletedAt: null, createdAt: new Date(T0 - 60_000 + order), derivatives, ...over };
}
const photo = (id: string, over: Partial<Copy> = {}, row: Partial<FileRow> = {}) => file(id, "image/jpeg", [copy("WEB_IMAGE", id), copy("THUMBNAIL", id, over)], row);
const video = (id: string, over: Partial<Copy> = {}, row: Partial<FileRow> = {}) => file(id, "video/quicktime", [copy("POSTER", id, { width: 1000, height: 562, ...over })], row);
/** Puts bytes at each READY copy's key (sized as the row says, capped for the test) and returns the files. */
function stored(rows: FileRow[]): FileRow[] {
  for (const row of rows) {
    for (const d of row.derivatives) {
      blobs.set(d.storageKey, Buffer.alloc(Math.min(d.sizeBytes ?? 64, PREVIEW_MAX_BYTES), `${row.id}:${d.kind}`));
    }
  }
  return rows;
}
const signal = () => new AbortController().signal;

beforeEach(() => {
  files = [];
  order = 0;
  blobs.clear();
  findManyMock.mockClear();
  getMock.mockClear();
  logErrorMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("loadAdminPreviews", () => {
  it("reads a photo's THUMBNAIL and a video's POSTER (never the web copy) as base64 inline previews sized from the derived row", async () => {
    const media = stored([photo("p1"), video("v1")]);
    const abort = signal();
    const previews = await loadAdminPreviews(media, abort);
    expect([...previews.keys()]).toEqual(["p1", "v1"]);
    expect(previews.get("p1")).toEqual({ contentId: "preview-p1", contentBase64: blobs.get(copy("THUMBNAIL", "p1").storageKey)!.toString("base64"), width: 1000, height: 750 });
    expect(previews.get("v1")).toEqual({ contentId: "preview-v1", contentBase64: blobs.get(copy("POSTER", "v1").storageKey)!.toString("base64"), width: 1000, height: 562 });
    expect(getMock.mock.calls.map((c) => c[0])).toEqual([copy("THUMBNAIL", "p1").storageKey, copy("POSTER", "v1").storageKey]);
    // One signal covers every read.
    expect(getMock.mock.calls.every((c) => c[1]?.signal === abort)).toBe(true);
  });

  it(`reads at most ${MAX_PREVIEWS} copies: the first ones in the order given`, async () => {
    const media = stored(Array.from({ length: 6 }, (_, i) => photo(`p${i}`)));
    const previews = await loadAdminPreviews(media, signal());
    expect([...previews.keys()]).toEqual(["p0", "p1", "p2", "p3"]);
    expect(getMock).toHaveBeenCalledTimes(MAX_PREVIEWS);
  });

  it("skips a copy over PREVIEW_MAX_BYTES or of unknown size without reading it, and the next file takes the slot", async () => {
    const media = stored([
      photo("big", { sizeBytes: PREVIEW_MAX_BYTES + 1 }),
      photo("unknown", { sizeBytes: null }),
      photo("edge", { sizeBytes: PREVIEW_MAX_BYTES }),
      photo("p3"), photo("p4"), photo("p5"), photo("p6"),
    ]);
    const previews = await loadAdminPreviews(media, signal());
    expect([...previews.keys()]).toEqual(["edge", "p3", "p4", "p5"]);
    expect(Buffer.from(previews.get("edge")!.contentBase64, "base64").byteLength).toBe(PREVIEW_MAX_BYTES);
    expect(getMock.mock.calls.map((c) => c[0])).not.toContain(copy("THUMBNAIL", "big").storageKey);
    expect(getMock.mock.calls.map((c) => c[0])).not.toContain(copy("THUMBNAIL", "unknown").storageKey);
  });

  it("refuses bytes larger than PREVIEW_MAX_BYTES even when the row says less", async () => {
    const media = stored([photo("liar")]);
    blobs.set(copy("THUMBNAIL", "liar").storageKey, Buffer.alloc(PREVIEW_MAX_BYTES + 1, 1));
    expect((await loadAdminPreviews(media, signal())).size).toBe(0);
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("never reads a browser-staged key (D2: untrusted bytes are never attached)", async () => {
    const media = stored([video("v1", { storageKey: "dev/derived/mem_1/v1.upload.jpg" })]);
    expect((await loadAdminPreviews(media, signal())).size).toBe(0);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("gives no preview to a voice recording, a file that is not READY, a copy that is not READY, or one without a usable size", async () => {
    const media = stored([
      file("voice", "audio/mp4", [copy("THUMBNAIL", "voice"), copy("POSTER", "voice")]),
      photo("pending", {}, { status: "PENDING" }),
      photo("failed", {}, { status: "FAILED" }),
      photo("copy-pending", { status: "PENDING" }),
      video("copy-failed", { status: "FAILED", error: "decode_failed" }),
      photo("no-width", { width: null }),
      photo("zero-height", { height: 0 }),
      photo("png", { mimeType: "image/png" }),
      file("video-thumb-only", "video/mp4", [copy("THUMBNAIL", "video-thumb-only")]),
    ]);
    expect((await loadAdminPreviews(media, signal())).size).toBe(0);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("names each preview preview-<mediaId> and skips, never throws on, an id the template would refuse", async () => {
    const uuid = "0f6a1c7e-3f1a-4b5e-9c2d-1234567890ab";
    const media = stored([photo("UPPER"), photo("under_score"), photo("reserved0"), photo(uuid)]);
    const previews = await loadAdminPreviews(media, signal());
    expect([...previews.keys()]).toEqual([uuid]);
    expect(previews.get(uuid)?.contentId).toBe(`preview-${uuid}`);
    expect(getMock).toHaveBeenCalledTimes(1);
    // What it returns, the admin template accepts: no throw for a bad, reserved or duplicate id.
    const rows = media.map((row) => ({ ...row, originalFilename: null, durationSeconds: null }));
    expect(() => buildMediaCards(summarizeReadyMedia(rows, previews), "admin")).not.toThrow();
  });

  it("a read failure gives that file no preview, is logged, and never throws", async () => {
    const media = stored([photo("throws"), photo("missing"), photo("ok")]);
    blobs.delete(copy("THUMBNAIL", "missing").storageKey);
    getMock.mockRejectedValueOnce(new Error("blob store unavailable"));
    const previews = await loadAdminPreviews(media, signal());
    expect([...previews.keys()]).toEqual(["ok"]);
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ mediaId: "throws" }));
  });

  it("an expired signal (the 5 s read budget) leaves every file without a preview and never throws", async () => {
    const media = stored([photo("p1"), video("v1")]);
    const previews = await loadAdminPreviews(media, AbortSignal.abort(new DOMException("timed out", "TimeoutError")));
    expect(previews.size).toBe(0);
  });
});

describe("waitForAdminPreviews", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(T0);
  });

  function start(until: number, pollMs?: number) {
    const done = vi.fn();
    const promise = waitForAdminPreviews({ memoryId: "mem_1", until, ...(pollMs !== undefined && { pollMs }) }).then(done);
    return { done, promise };
  }

  it("polls once a second by default", () => {
    expect(PREVIEW_POLL_MS).toBe(1_000);
  });

  it("returns after one read when every photo and video already has its copy READY", async () => {
    files = [photo("p1"), video("v1")];
    const { done } = start(T0 + 15_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalledTimes(1);
    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(Date.now()).toBe(T0);
    // It reads the memory's live READY files in upload order, with their THUMBNAIL and POSTER rows only.
    const query = findManyMock.mock.calls[0]![0];
    expect(query.where).toMatchObject({ memoryId: "mem_1", deletedAt: null, status: "READY" });
    expect(query.select.derivatives.where?.kind?.in.slice().sort()).toEqual(["POSTER", "THUMBNAIL"]);
  });

  it("re-reads every second until the poster lands, then stops", async () => {
    files = [photo("p1"), video("v1")];
    files[1]!.derivatives = [];
    const { done } = start(T0 + 15_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(findManyMock).toHaveBeenCalledTimes(2);
    files[1]!.derivatives = [copy("POSTER", "v1", { status: "PENDING", sizeBytes: null })];
    await vi.advanceTimersByTimeAsync(1_000);
    expect(findManyMock).toHaveBeenCalledTimes(3);
    expect(done).not.toHaveBeenCalled();
    files[1]!.derivatives = [copy("POSTER", "v1")];
    await vi.advanceTimersByTimeAsync(1_000);
    expect(findManyMock).toHaveBeenCalledTimes(4);
    expect(done).toHaveBeenCalledTimes(1);
    expect(Date.now()).toBe(T0 + 3_000);
  });

  it("stops at a final FAILED copy, but keeps waiting while a producer may still retry it", async () => {
    files = [photo("p1", { status: "FAILED", error: "decode_failed", attempts: 1 })];
    const { done } = start(T0 + 15_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(findManyMock).toHaveBeenCalledTimes(3);
    expect(done).not.toHaveBeenCalled();
    files[0]!.derivatives[1] = copy("THUMBNAIL", "p1", { status: "FAILED", error: "decode_failed", attempts: 3 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an unsupported type", { error: "unsupported_type" }],
    ["a pixel refusal under today's ceiling", { error: `too_many_pixels:${MAX_VIDEO_PIXELS}` }],
    ["a third timeout", { error: "timeout", attempts: 3 }],
  ])("treats %s as final for a video's POSTER", async (_label, over) => {
    files = [video("v1", { status: "FAILED", ...over })];
    const { done } = start(T0 + 15_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalledTimes(1);
    expect(findManyMock).toHaveBeenCalledTimes(1);
  });

  it("gives up exactly at `until` when the copies never come", async () => {
    files = [video("v1")];
    files[0]!.derivatives = [];
    const { done } = start(T0 + 3_500);
    await vi.advanceTimersByTimeAsync(3_499);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(findManyMock).toHaveBeenCalledTimes(4); // at 0, 1, 2 and 3 s
  });

  it("returns at once, without a read, when `until` has already passed", async () => {
    files = [video("v1")];
    files[0]!.derivatives = [];
    const { done } = start(T0);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalledTimes(1);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it(`waits only for the first ${MAX_PREVIEWS} photos and videos; voice recordings and later files never hold it up`, async () => {
    files = [file("voice", "audio/mp4", []), photo("p1"), video("v1"), photo("p2"), photo("p3"), photo("late")];
    files[5]!.derivatives = [];
    const { done } = start(T0 + 15_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("takes an injected poll interval", async () => {
    files = [video("v1")];
    files[0]!.derivatives = [];
    start(T0 + 15_000, 250);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(findManyMock).toHaveBeenCalledTimes(5); // at 0, 250, 500, 750 and 1000 ms
  });

  it("a database error ends the wait early: logged, never thrown", async () => {
    findManyMock.mockRejectedValueOnce(new Error("connection reset"));
    const { done, promise } = start(T0 + 15_000);
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBeUndefined();
    expect(done).toHaveBeenCalledTimes(1);
    expect(logErrorMock).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ memoryId: "mem_1" }));
  });
});

describe("summarizeReadyMedia", () => {
  it("fills each READY file's preview from the map by media id; files without one, and the default, stay null", () => {
    const rows = [photo("p1"), video("v1"), photo("pending", {}, { status: "PENDING" })].map((r) => ({ ...r, originalFilename: `${r.id}.bin`, durationSeconds: null }));
    const preview = { contentId: "preview-p1", contentBase64: "AA==", width: 10, height: 8 };
    expect(summarizeReadyMedia(rows, new Map([["p1", preview]]))).toEqual([
      { kind: "PHOTO", originalFilename: "p1.bin", durationSeconds: null, preview },
      { kind: "VIDEO", originalFilename: "v1.bin", durationSeconds: null, preview: null },
    ]);
    expect(summarizeReadyMedia(rows).map((m) => m.preview)).toEqual([null, null]);
  });
});

describe("D1: the preview code never loads the poster path", () => {
  it("loading the preview module and the alert that uses it pulls in no derive-poster, video-frames service or ffmpeg-static", async () => {
    await import("@/features/memories/notify-admins");
    expect(posterPathLoaded).toEqual([]);
  });
});
