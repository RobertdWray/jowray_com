import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { MAX_VIDEO_PIXELS } from "@/lib/video-frames";
import { resetEnvCache } from "@/server/config/env";
import type * as LoggerModule from "@/lib/logger";

/**
 * The kind-generic surface of the claim/publish protocol that `derive-media.test.ts` cannot reach: the POSTER kind,
 * a publish with no `whileLocked` (D6: a poster never writes the Media row), the pixel ceiling a caller may pass,
 * and `failClaims` never throwing. Everything the photo path does is pinned there, unchanged.
 */

type Kind = "WEB_IMAGE" | "THUMBNAIL" | "POSTER";
interface DerivedRow { id: string; mediaId: string; kind: Kind; status: "PENDING" | "READY" | "FAILED"; storageKey: string; mimeType: string | null; sizeBytes: number | null; width: number | null; height: number | null; error: string | null; attempts: number; claimedAt: Date | null }
interface MediaRow { id: string; memoryId: string; status: string; deletedAt: Date | null; width: number | null; height: number | null; memory: { deletedAt: Date | null } }

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
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => media.find((m) => matches(m as unknown as Record<string, unknown>, where)) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MediaRow> }) => { Object.assign(media.find((m) => m.id === where.id)!, data); }),
    updateMany: vi.fn(async () => ({ count: 0 })),
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
      for (const r of rows) { Object.assign(r, data); }
      return { count: rows.length };
    }),
  },
};
vi.mock("@/server/db/client", () => ({ getDb: () => db }));

const delMock = vi.fn(async (_key: string) => undefined);
vi.mock("@/services/storage", () => ({ createStorageService: () => ({ get: vi.fn(), put: vi.fn(), del: delMock, head: vi.fn(), presignGet: vi.fn() }) }));

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof LoggerModule>();
  return { ...actual, logError: (...args: unknown[]) => logErrorMock(...args) };
});

import { claimKind, type DerivedClaim, failClaims, isEligible, MAX_PIXELS, publishClaims } from "@/features/memories/derived-claims";

const NOW = new Date("2026-11-08T12:00:00Z");
const VIDEO_KEY = "dev/originals/mem_1/0f6a1c7e-3f1a-4b5e-9c2d-1234567890ab.mov";
const poster = { data: Buffer.from("poster"), mimeType: "image/jpeg", extension: "jpg", width: 1000, height: 562 };

function video(over: Partial<MediaRow> = {}): MediaRow {
  return { id: "med_v", memoryId: "mem_1", status: "READY", deletedAt: null, width: null, height: null, memory: { deletedAt: null }, ...over };
}
function row<K extends Kind>(kind: K, over: Partial<Omit<DerivedRow, "kind">> = {}): DerivedRow & { kind: K } {
  return { id: `der_${nextId++}`, mediaId: "med_v", kind, status: "PENDING", storageKey: `dev/derived/mem_1/${kind.toLowerCase()}.jpg`, mimeType: null, sizeBytes: null, width: null, height: null, error: null, attempts: 1, claimedAt: NOW, ...over };
}
function claimOf<K extends Kind>(r: DerivedRow & { kind: K }): DerivedClaim<K> {
  return { kind: r.kind, id: r.id, storageKey: r.storageKey, attempts: r.attempts };
}

beforeEach(() => {
  delete process.env.VERCEL_ENV; resetEnvCache();
  media = [video()]; derived = []; lockCalls.length = 0; nextId = 1;
  vi.clearAllMocks();
});

describe("derived-claims: the kind-generic claim and publish protocol", () => {
  it("claims a POSTER row as PENDING with a fresh key under the derived prefix", async () => {
    const claimed = await claimKind({ mediaId: "med_v", kind: "POSTER", existing: null, originalKey: VIDEO_KEY, extension: "jpg", now: NOW });
    if (!("claim" in claimed)) { throw new Error(`expected a claim, got ${claimed.outcome}`); }
    expectTypeOf(claimed.claim).toEqualTypeOf<DerivedClaim<"POSTER">>();
    expect(claimed.claim).toMatchObject({ kind: "POSTER", attempts: 1 });
    expect(claimed.claim.storageKey).toMatch(/^dev\/derived\/mem_1\/[0-9a-f-]{36}\.jpg$/);
    expect(derived).toEqual([expect.objectContaining({ id: claimed.claim.id, mediaId: "med_v", kind: "POSTER", status: "PENDING", storageKey: claimed.claim.storageKey, claimedAt: NOW, attempts: 1 })]);
  });

  it("publishes a POSTER under the memory lock and never writes the Media row when no whileLocked is given (D6)", async () => {
    const pending = row("POSTER");
    derived = [pending];
    const outcomes = await publishClaims({ mediaId: "med_v", memoryId: "mem_1", claims: [claimOf(pending)], now: NOW, encodedFor: () => poster });
    expect(outcomes).toEqual({ POSTER: "derived" });
    expect(derived[0]).toMatchObject({ status: "READY", mimeType: "image/jpeg", sizeBytes: 6, width: 1000, height: 562, error: null });
    expect(lockCalls[0]).toContain("FOR UPDATE|mem_1");
    // The original's width/height are null here, which is exactly when the photo path fills them.
    expect(db.media.update).not.toHaveBeenCalled();
    expect(db.media.updateMany).not.toHaveBeenCalled();
    expect(media[0]).toMatchObject({ width: null, height: null });
    expect(delMock).not.toHaveBeenCalled();
  });

  it("records a too_large POSTER as FAILED, still without a Media write", async () => {
    const pending = row("POSTER");
    derived = [pending];
    const outcomes = await publishClaims({ mediaId: "med_v", memoryId: "mem_1", claims: [claimOf(pending)], now: NOW, encodedFor: () => ({ failed: "too_large" as const }) });
    expect(outcomes).toEqual({ POSTER: "failed" });
    expect(derived[0]).toMatchObject({ status: "FAILED", error: "too_large" });
    expect(db.media.update).not.toHaveBeenCalled();
    expect(db.media.updateMany).not.toHaveBeenCalled();
  });

  it("runs whileLocked inside the lock with the live original, and not at all once the original is gone", async () => {
    const whileLocked = vi.fn(async (_tx: unknown, _live: unknown) => undefined);
    const pending = row("POSTER");
    derived = [pending];
    await publishClaims({ mediaId: "med_v", memoryId: "mem_1", claims: [claimOf(pending)], now: NOW, encodedFor: () => poster, whileLocked });
    expect(whileLocked).toHaveBeenCalledTimes(1);
    expect(whileLocked.mock.calls[0]).toEqual([db, expect.objectContaining({ id: "med_v", width: null, height: null })]);
    expect(whileLocked.mock.invocationCallOrder[0]!).toBeGreaterThan(db.$queryRaw.mock.invocationCallOrder[0]!);
    expect(whileLocked.mock.invocationCallOrder[0]!).toBeGreaterThan(db.derivedMedia.updateMany.mock.invocationCallOrder[0]!);

    whileLocked.mockClear();
    media = [video({ deletedAt: new Date() })];
    const again = row("POSTER");
    derived = [again];
    expect(await publishClaims({ mediaId: "med_v", memoryId: "mem_1", claims: [claimOf(again)], now: NOW, encodedFor: () => poster, whileLocked })).toEqual({ POSTER: "claimed_elsewhere" });
    expect(whileLocked).not.toHaveBeenCalled();
    expect(derived).toHaveLength(0);
    expect(delMock).toHaveBeenCalledWith(again.storageKey);
  });

  it("rejects with no blob deleted when whileLocked or the transaction fails, even a candidate it had queued for deletion", async () => {
    // One claim was taken over (its conditional publish misses, so its candidate is queued for deletion); one is ours.
    const setUp = () => {
      const lost = row("WEB_IMAGE", { storageKey: "dev/derived/mem_1/lost.jpg" });
      const ours = row("THUMBNAIL", { storageKey: "dev/derived/mem_1/ours.jpg" });
      derived = [{ ...lost, claimedAt: new Date(NOW.getTime() + 1) }, ours];
      return [claimOf(lost), claimOf(ours)] as const;
    };

    // Control: when the transaction commits, the queued candidate is deleted after it.
    expect(await publishClaims({ mediaId: "med_v", memoryId: "mem_1", claims: setUp(), now: NOW, encodedFor: () => poster, whileLocked: async () => undefined })).toEqual({ WEB_IMAGE: "claimed_elsewhere", THUMBNAIL: "derived" });
    expect(delMock.mock.calls).toEqual([["dev/derived/mem_1/lost.jpg"]]);

    delMock.mockClear();
    const whileLocked = vi.fn(async () => { throw new Error("lock lost"); });
    await expect(publishClaims({ mediaId: "med_v", memoryId: "mem_1", claims: setUp(), now: NOW, encodedFor: () => poster, whileLocked })).rejects.toThrow("lock lost");
    expect(whileLocked).toHaveBeenCalledTimes(1);
    expect(delMock).not.toHaveBeenCalled();

    db.$transaction.mockRejectedValueOnce(new Error("connection terminated"));
    await expect(publishClaims({ mediaId: "med_v", memoryId: "mem_1", claims: setUp(), now: NOW, encodedFor: () => poster })).rejects.toThrow("connection terminated");
    expect(delMock).not.toHaveBeenCalled();
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("judges pixel refusals against the ceiling the caller passes (photos by default)", async () => {
    const refused = row("POSTER", { status: "FAILED", error: `too_many_pixels:${MAX_VIDEO_PIXELS}` });
    expect(isEligible(refused, NOW)).toBe("eligible");
    expect(isEligible(refused, NOW, MAX_VIDEO_PIXELS)).toBe("not_eligible");
    expect(isEligible({ ...refused, error: `too_many_pixels:${MAX_PIXELS}` }, NOW, MAX_VIDEO_PIXELS)).toBe("eligible");

    derived = [refused];
    expect(await claimKind({ mediaId: "med_v", kind: "POSTER", existing: refused, originalKey: VIDEO_KEY, extension: "jpg", now: NOW, maxPixels: MAX_VIDEO_PIXELS })).toEqual({ outcome: "not_eligible" });
    expect(db.derivedMedia.create).not.toHaveBeenCalled();
    expect(db.derivedMedia.updateMany).not.toHaveBeenCalled();
  });

  it("failClaims never throws: a row that cannot be failed is logged and the next claim is still failed", async () => {
    const first = row("WEB_IMAGE");
    const second = row("THUMBNAIL");
    derived = [first, second];
    db.derivedMedia.updateMany.mockRejectedValueOnce(new Error("db down"));
    await expect(failClaims([claimOf(first), claimOf(second)], { mediaId: "med_v", now: NOW, error: "timeout" })).resolves.toBeUndefined();
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock.mock.calls[0]![2]).toMatchObject({ mediaId: "med_v" });
    expect(derived[0]).toMatchObject({ status: "PENDING" });
    expect(derived[1]).toMatchObject({ status: "FAILED", error: "timeout" });
    expect(delMock.mock.calls).toEqual([[second.storageKey]]);
  });
});
