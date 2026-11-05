import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageDeriveError } from "@/lib/image-derive-error";
import { resetEnvCache } from "@/server/config/env";
import type { DerivedSet } from "@/services/images";
import type * as ImagesModule from "@/services/images";
import type * as LoggerModule from "@/lib/logger";

type Kind = "WEB_IMAGE" | "THUMBNAIL";
interface DerivedRow { id: string; mediaId: string; kind: Kind; status: "PENDING" | "READY" | "FAILED"; storageKey: string; mimeType: string | null; sizeBytes: number | null; width: number | null; height: number | null; error: string | null; attempts: number; claimedAt: Date | null }
interface MediaRow { id: string; memoryId: string; status: string; mimeType: string; storageKey: string; deletedAt: Date | null; purgedAt: Date | null; width: number | null; height: number | null; memory: { deletedAt: Date | null } }

let media: MediaRow[] = [];
let derived: DerivedRow[] = [];
const lockCalls: string[] = [];
let nextId = 1;

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    const actual = row[k];
    if (v instanceof Date) { return actual instanceof Date && actual.getTime() === v.getTime(); }
    if (v !== null && typeof v === "object") {
      const cond = v as { in?: unknown[]; lt?: Date; not?: unknown; startsWith?: string };
      if (cond.in) { return cond.in.includes(actual); }
      if (cond.lt) { return actual instanceof Date && actual < cond.lt; }
      if ("not" in cond) { return actual !== cond.not; }
      if (cond.startsWith) { return typeof actual === "string" && actual.startsWith(cond.startsWith); }
    }
    return actual === v;
  });
}
const db = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => { lockCalls.push(`${strings.join("?")}|${String(values[0])}`); return [{ id: values[0] }]; }),
  $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(db)),
  memory: { findUniqueOrThrow: vi.fn(async () => ({ contributorNote: null })) },
  media: {
    findUnique: vi.fn(async ({ where, include }: { where: { id: string }; include?: { derivatives?: { where?: Record<string, unknown> } } }) => {
      const row = media.find((m) => m.id === where.id);
      if (!row) { return null; }
      const w = include?.derivatives?.where ?? {};
      return { ...row, derivatives: derived.filter((d) => d.mediaId === row.id && matches(d as unknown as Record<string, unknown>, w)) };
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => media.find((m) => matches(m as unknown as Record<string, unknown>, where)) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MediaRow> }) => { Object.assign(media.find((m) => m.id === where.id)!, data); }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<MediaRow> }) => { const rows = media.filter((m) => matches(m as unknown as Record<string, unknown>, where)); for (const r of rows) { Object.assign(r, data); } return { count: rows.length }; }),
  },
  derivedMedia: {
    create: vi.fn(async ({ data }: { data: Pick<DerivedRow, "mediaId" | "kind" | "status" | "storageKey" | "claimedAt" | "attempts"> }) => {
      if (derived.some((d) => d.mediaId === data.mediaId && d.kind === data.kind)) { throw Object.assign(new Error("Unique constraint failed on the fields: (`mediaId`,`kind`)"), { code: "P2002" }); }
      const row: DerivedRow = { id: `der_${nextId++}`, mimeType: null, sizeBytes: null, width: null, height: null, error: null, ...data };
      derived.push(row); return row;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => derived.find((d) => matches(d as unknown as Record<string, unknown>, where)) ?? null),
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

const getMock = vi.fn(async (_pathname: string, _options?: { signal?: AbortSignal }) => ({ stream: new Blob([new Uint8Array([1, 2, 3])]).stream(), contentType: "image/jpeg", contentLength: 3 }));
const putMock = vi.fn(async (pathname: string) => ({ pathname, url: `https://blob.test/${pathname}`, size: 1, contentType: "image/jpeg", uploadedAt: new Date() }));
const delMock = vi.fn(async (_key: string) => undefined);
vi.mock("@/services/storage", () => ({ createStorageService: () => ({ get: getMock, put: putMock, del: delMock, head: vi.fn(), presignGet: vi.fn() }) }));

const web = { data: Buffer.from("web"), mimeType: "image/jpeg", extension: "jpg", width: 2048, height: 1536 };
const thumb = { data: Buffer.from("thumb"), mimeType: "image/jpeg", extension: "jpg", width: 1000, height: 750 };
const deriveMock = vi.fn(async (_input: Buffer, _opts: unknown): Promise<DerivedSet> => ({ sourceWidth: 4000, sourceHeight: 3000, web, thumb }));
const releaseMock = vi.fn();
const acquireMock = vi.fn(async (_deadlineMs: number) => ({ derive: (i: Buffer, o: unknown) => deriveMock(i, o), release: releaseMock }));
vi.mock("@/services/images", async (importOriginal) => {
  const actual = await importOriginal<typeof ImagesModule>();
  return { ...actual, createImageService: () => ({ acquire: (ms: number) => acquireMock(ms), derive: (i: Buffer, o: unknown) => deriveMock(i, o), inFlight: () => 0, waiting: () => 0 }) };
});
const recomputeMock = vi.fn(async (_tx: unknown, _memoryId: string, _note: string | null) => "TEXT");
vi.mock("@/features/memories/media-state", () => ({ recomputeMemoryType: (tx: unknown, memoryId: string, note: string | null) => recomputeMock(tx, memoryId, note) }));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof LoggerModule>();
  return { ...actual, logError: (...args: unknown[]) => logErrorMock(...args) };
});

import { deriveMedia } from "@/features/memories/derive-media";

function photo(over: Partial<MediaRow> = {}): MediaRow {
  return { id: "med_1", memoryId: "mem_1", status: "READY", mimeType: "image/heic", storageKey: "dev/originals/mem_1/0f6a1c7e-3f1a-4b5e-9c2d-1234567890ab.heic", deletedAt: null, purgedAt: null, width: null, height: null, memory: { deletedAt: null }, ...over };
}
const NOW = new Date("2026-11-03T12:00:00Z");
const STALE = new Date(NOW.getTime() - 11 * 60_000);
function row(kind: Kind, over: Partial<DerivedRow> = {}): DerivedRow {
  return { id: `der_${nextId++}`, mediaId: "med_1", kind, status: "PENDING", storageKey: `dev/derived/mem_1/${kind.toLowerCase()}.jpg`, mimeType: null, sizeBytes: null, width: null, height: null, error: null, attempts: 1, claimedAt: NOW, ...over };
}

beforeEach(() => {
  delete process.env.VERCEL_ENV; resetEnvCache();
  media = [photo()]; derived = []; lockCalls.length = 0; nextId = 1;
  getMock.mockClear(); putMock.mockClear(); delMock.mockClear(); deriveMock.mockClear(); logErrorMock.mockClear(); acquireMock.mockClear(); releaseMock.mockClear(); recomputeMock.mockClear();
  deriveMock.mockImplementation(async () => ({ sourceWidth: 4000, sourceHeight: 3000, web, thumb }));
  getMock.mockImplementation(async () => ({ stream: new Blob([new Uint8Array([1, 2, 3])]).stream(), contentType: "image/jpeg", contentLength: 3 }));
});

describe("deriveMedia", () => {
  it("claims both rows with their keys before reading the original, decodes once, publishes both and fills the original's dimensions", async () => {
    const result = await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW });
    expect(result).toEqual({ WEB_IMAGE: "derived", THUMBNAIL: "derived" });
    expect(deriveMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledTimes(1);
    const createOrder = db.derivedMedia.create.mock.invocationCallOrder[0]!;
    expect(createOrder).toBeLessThan(getMock.mock.invocationCallOrder[0]!);
    const webRow = derived.find((d) => d.kind === "WEB_IMAGE")!;
    const thumbRow = derived.find((d) => d.kind === "THUMBNAIL")!;
    expect(webRow).toMatchObject({ status: "READY", mimeType: "image/jpeg", sizeBytes: 3, width: 2048, height: 1536, error: null });
    expect(webRow.storageKey).toMatch(/^dev\/derived\/mem_1\/[0-9a-f-]{36}\.jpg$/);
    expect(thumbRow).toMatchObject({ status: "READY", mimeType: "image/jpeg", sizeBytes: 5, width: 1000, height: 750 });
    expect(putMock).toHaveBeenCalledWith(webRow.storageKey, web.data, "image/jpeg");
    expect(putMock).toHaveBeenCalledWith(thumbRow.storageKey, thumb.data, "image/jpeg");
    expect(media[0]).toMatchObject({ width: 4000, height: 3000 });
    expect(lockCalls[0]).toContain("FOR UPDATE|mem_1");
  });

  it("does nothing for non-image, non-READY, removed, foreign-prefix or deleted-memory media", async () => {
    for (const over of [{ mimeType: "video/mp4" }, { status: "PENDING" }, { deletedAt: new Date() }, { storageKey: "originals/mem_1/x.heic" }, { memory: { deletedAt: new Date() } }] as Partial<MediaRow>[]) {
      media = [photo(over)]; derived = [];
      expect(await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW })).toEqual({ WEB_IMAGE: "not_eligible", THUMBNAIL: "not_eligible" });
    }
    expect(getMock).not.toHaveBeenCalled();
    expect(derived).toHaveLength(0);
  });

  it("leaves READY and terminal FAILED rows alone and reports a fresh claim as someone else's", async () => {
    derived = [row("WEB_IMAGE", { status: "READY" }), row("THUMBNAIL", { status: "FAILED", error: "too_large" })];
    expect(await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW })).toEqual({ WEB_IMAGE: "not_eligible", THUMBNAIL: "not_eligible" });
    derived = [row("WEB_IMAGE", { claimedAt: new Date(NOW.getTime() - 60_000) }), row("THUMBNAIL", { status: "READY" })];
    expect(await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW })).toEqual({ WEB_IMAGE: "claimed_elsewhere", THUMBNAIL: "not_eligible" });
    expect(getMock).not.toHaveBeenCalled();
  });

  it("reclaims a stale PENDING row: deletes its half-written key, allocates a new one, counts the attempt", async () => {
    derived = [row("WEB_IMAGE", { claimedAt: STALE, storageKey: "dev/derived/mem_1/stale.jpg" }), row("THUMBNAIL", { status: "READY" })];
    expect(await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW })).toEqual({ WEB_IMAGE: "derived", THUMBNAIL: "not_eligible" });
    expect(delMock).toHaveBeenCalledWith("dev/derived/mem_1/stale.jpg");
    const webRow = derived.find((d) => d.kind === "WEB_IMAGE")!;
    expect(webRow.storageKey).not.toBe("dev/derived/mem_1/stale.jpg");
    expect(webRow).toMatchObject({ status: "READY", attempts: 2 });
  });

  it("reclaims by conditional update first and only then deletes the previous candidate, so a copy published meanwhile survives", async () => {
    // Another worker publishes the stale row between our read and our reclaim.
    derived = [row("WEB_IMAGE", { claimedAt: STALE, storageKey: "dev/derived/mem_1/live.jpg" }), row("THUMBNAIL", { status: "READY" })];
    db.derivedMedia.updateMany.mockImplementationOnce(async () => { derived[0]!.status = "READY"; return { count: 0 }; });
    expect(await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW })).toEqual({ WEB_IMAGE: "claimed_elsewhere", THUMBNAIL: "not_eligible" });
    expect(delMock).not.toHaveBeenCalledWith("dev/derived/mem_1/live.jpg");
  });

  it("marks a stale claim that has used up its attempts as abandoned instead of retrying it forever", async () => {
    derived = [row("WEB_IMAGE", { claimedAt: STALE, attempts: 3, storageKey: "dev/derived/mem_1/dead.jpg" }), row("THUMBNAIL", { status: "READY" })];
    expect(await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW })).toEqual({ WEB_IMAGE: "failed", THUMBNAIL: "not_eligible" });
    expect(derived[0]).toMatchObject({ status: "FAILED", error: "abandoned" });
    expect(delMock).toHaveBeenCalledWith("dev/derived/mem_1/dead.jpg");
    expect(getMock).not.toHaveBeenCalled();
  });

  it("never throws: a failure while claiming the second kind releases the first claim and is reported", async () => {
    db.derivedMedia.create.mockImplementationOnce(async ({ data }) => { const r: DerivedRow = { id: "der_x", mimeType: null, sizeBytes: null, width: null, height: null, error: null, ...data }; derived.push(r); return r; });
    db.derivedMedia.create.mockImplementationOnce(async () => { throw new Error("db down"); });
    const result = await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW });
    expect(result.WEB_IMAGE).toBe("failed");
    expect(derived.find((d) => d.kind === "WEB_IMAGE")).toMatchObject({ status: "FAILED", error: "decode_failed" });
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("does not delete a candidate whose row is no longer PENDING when cleaning up after an error", async () => {
    // The publish committed but its acknowledgement was lost: the rows are READY by the time the catch runs.
    putMock.mockImplementationOnce(async () => { for (const d of derived) { d.status = "READY"; } throw new Error("ack lost"); });
    await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW });
    expect(derived.every((d) => d.status === "READY")).toBe(true);
    expect(delMock).not.toHaveBeenCalled();
  });

  it("retries decode_failed and timeout up to three attempts and a too_many_pixels row only when the ceiling was raised", async () => {
    derived = [row("WEB_IMAGE", { status: "FAILED", error: "decode_failed", attempts: 2 }), row("THUMBNAIL", { status: "FAILED", error: "timeout", attempts: 3 })];
    expect(await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW })).toEqual({ WEB_IMAGE: "derived", THUMBNAIL: "not_eligible" });
    derived = [row("WEB_IMAGE", { status: "FAILED", error: "too_many_pixels:1000", attempts: 1 }), row("THUMBNAIL", { status: "FAILED", error: "too_many_pixels:30000000", attempts: 1 })];
    expect(await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW })).toEqual({ WEB_IMAGE: "derived", THUMBNAIL: "not_eligible" });
    // A refusal recorded under a *different* ceiling (higher or lower) is retried once so the row converges on today's limit;
    // this keeps the feature's rule identical to cron (g)'s selector (`not: too_many_pixels:<MAX_PIXELS>`).
    derived = [row("WEB_IMAGE", { status: "FAILED", error: "too_many_pixels:60000000", attempts: 1 }), row("THUMBNAIL", { status: "READY" })];
    expect(await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW })).toEqual({ WEB_IMAGE: "derived", THUMBNAIL: "not_eligible" });
  });

  it("records a decode refusal on every claimed row with the ceiling, deleting the unused candidate keys", async () => {
    deriveMock.mockRejectedValueOnce(new ImageDeriveError("too_many_pixels", { limit: 30_000_000 }));
    expect(await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW })).toEqual({ WEB_IMAGE: "failed", THUMBNAIL: "failed" });
    expect(derived.map((d) => [d.status, d.error])).toEqual([["FAILED", "too_many_pixels:30000000"], ["FAILED", "too_many_pixels:30000000"]]);
    expect(putMock).not.toHaveBeenCalled();
    expect(delMock).toHaveBeenCalledTimes(2);
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("marks only the thumbnail too_large when the web copy succeeded", async () => {
    deriveMock.mockResolvedValueOnce({ sourceWidth: 4000, sourceHeight: 3000, web, thumb: { failed: "too_large" } });
    expect(await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW })).toEqual({ WEB_IMAGE: "derived", THUMBNAIL: "failed" });
    expect(derived.find((d) => d.kind === "THUMBNAIL")).toMatchObject({ status: "FAILED", error: "too_large" });
    expect(derived.find((d) => d.kind === "WEB_IMAGE")).toMatchObject({ status: "READY" });
    expect(putMock).toHaveBeenCalledTimes(1);
  });

  it("treats an unexpected failure as a retryable decode_failed and reports it with the media id only", async () => {
    putMock.mockRejectedValueOnce(new Error("blob store down"));
    expect(await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW })).toEqual({ WEB_IMAGE: "failed", THUMBNAIL: "failed" });
    expect(derived.every((d) => d.status === "FAILED" && d.error === "decode_failed")).toBe(true);
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    const ctx = logErrorMock.mock.calls[0]![2] as Record<string, unknown>;
    expect(ctx).toMatchObject({ mediaId: "med_1" });
    expect(JSON.stringify(ctx)).not.toMatch(/token/i);
  });

  it("drops its claims and candidates, after the transaction, when the media was removed while deriving", async () => {
    getMock.mockImplementationOnce(async () => { media[0]!.deletedAt = new Date(); return { stream: new Blob([new Uint8Array([1])]).stream(), contentType: "image/jpeg", contentLength: 1 }; });
    expect(await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW })).toEqual({ WEB_IMAGE: "claimed_elsewhere", THUMBNAIL: "claimed_elsewhere" });
    expect(derived).toHaveLength(0);
    expect(delMock).toHaveBeenCalledTimes(2);
    // no storage call while the memory lock was held
    const lockOrder = db.$queryRaw.mock.invocationCallOrder[0]!;
    const txEnd = db.$transaction.mock.results[0]!;
    expect(txEnd).toBeDefined();
    expect(delMock.mock.invocationCallOrder.every((o) => o > lockOrder)).toBe(true);
  });

  describe("issue #45: slot before download, one deadline, mismatched originals retired", () => {
    it("takes the decode slot before claiming or downloading, and releases it once the pixels are done", async () => {
      await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW });
      expect(acquireMock).toHaveBeenCalledTimes(1);
      expect(acquireMock.mock.invocationCallOrder[0]!).toBeLessThan(db.derivedMedia.create.mock.invocationCallOrder[0]!);
      expect(acquireMock.mock.invocationCallOrder[0]!).toBeLessThan(getMock.mock.invocationCallOrder[0]!);
      expect(releaseMock).toHaveBeenCalled();
      // Released before the publish transaction, not after it.
      expect(releaseMock.mock.invocationCallOrder[0]!).toBeLessThan(db.$transaction.mock.invocationCallOrder[0]!);
    });

    it("defers to the cron when the waiting line is full: nothing claimed, nothing read, no attempt spent", async () => {
      acquireMock.mockRejectedValueOnce(new ImageDeriveError("busy"));
      const result = await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW });
      expect(result).toEqual({ WEB_IMAGE: "deferred", THUMBNAIL: "deferred" });
      expect(derived).toHaveLength(0);
      expect(getMock).not.toHaveBeenCalled();
      expect(deriveMock).not.toHaveBeenCalled();
      expect(logErrorMock).not.toHaveBeenCalled();
    });

    it("defers likewise when the wait for the slot runs out the deadline", async () => {
      acquireMock.mockRejectedValueOnce(new ImageDeriveError("timeout"));
      expect(await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW })).toEqual({ WEB_IMAGE: "deferred", THUMBNAIL: "deferred" });
      expect(derived).toHaveLength(0);
    });

    it("passes the remaining budget, not a fresh one, to the slot and the decoder", async () => {
      await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW });
      expect(acquireMock.mock.calls[0]![0]).toBeLessThanOrEqual(20_000);
      const options = deriveMock.mock.calls[0]![1] as { deadlineMs: number };
      expect(options.deadlineMs).toBeLessThanOrEqual(20_000);
      expect(options.deadlineMs).toBeGreaterThan(19_000);
    });

    it("hands the download an abort signal and records a timeout, not a decode failure, when the deadline passes mid-download", async () => {
      getMock.mockImplementationOnce(async (_p: string, options?: { signal?: AbortSignal }) => {
        const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
          pull() {
            return new Promise<void>((_resolve, reject) => {
              options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            });
          },
        });
        return { stream, contentType: "image/jpeg", contentLength: 3 };
      });
      const result = await deriveMedia({ mediaId: "med_1", deadlineMs: 30, now: NOW });
      expect(result).toEqual({ WEB_IMAGE: "failed", THUMBNAIL: "failed" });
      expect(derived.every((d) => d.status === "FAILED" && d.error === "timeout")).toBe(true);
      expect(deriveMock).not.toHaveBeenCalled();
      expect(releaseMock).toHaveBeenCalled();
    });

    it("retires an original whose bytes are not the declared image type: marked for purge, FAILED, type recomputed, blob deleted after the lock", async () => {
      deriveMock.mockRejectedValueOnce(new ImageDeriveError("unsupported_type"));
      const result = await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW });
      expect(result).toEqual({ WEB_IMAGE: "failed", THUMBNAIL: "failed" });
      expect(derived.every((d) => d.status === "FAILED" && d.error === "unsupported_type")).toBe(true);
      expect(media[0]).toMatchObject({ status: "FAILED" });
      expect(media[0]!.purgedAt).toBeInstanceOf(Date);
      expect(recomputeMock).toHaveBeenCalledWith(db, "mem_1", null);
      expect(delMock).toHaveBeenCalledWith(photo().storageKey);
      expect(lockCalls.some((c) => c.includes("FOR UPDATE|mem_1"))).toBe(true);
      // The blob went after the transaction, never inside it.
      const originalDel = delMock.mock.calls.findIndex(([key]) => key === photo().storageKey);
      expect(delMock.mock.invocationCallOrder[originalDel]!).toBeGreaterThan(db.$transaction.mock.invocationCallOrder.at(-1)!);
    });

    it("leaves a retryable decode failure's original alone (it may be our fault, not the file's)", async () => {
      deriveMock.mockRejectedValueOnce(new ImageDeriveError("decode_failed"));
      await deriveMedia({ mediaId: "med_1", deadlineMs: 20_000, now: NOW });
      expect(media[0]).toMatchObject({ status: "READY", purgedAt: null });
      expect(delMock).not.toHaveBeenCalledWith(photo().storageKey);
    });
  });
});
