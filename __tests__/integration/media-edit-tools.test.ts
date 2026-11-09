/**
 * The MCP photo tools on real Postgres (plan 2026-11-08-mcp-media-tools §6): committed rows, separate connections,
 * real `FOR UPDATE` locks, real `TIMESTAMP(3)` versions and the `Media_purge_after_removed` CHECK. The feature tests
 * mock the database; only Postgres shows two writers queue on the memory lock, that a version written by
 * `touchMemory` round-trips to the string the caller compares, and that the swap, reorder, restore and upload paths
 * agree on one file order.
 *
 * Runs only when TEST_DATABASE_URL names a migrated database (CI provides one; locally see the plan's §5.2). The
 * suite lock keeps budget-concurrency's TRUNCATE away from these committed rows without serialising the writers.
 */
import { createHash, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { requestUploadAsAdmin } from "@/features/admin/attach-media";
import { getMemoryForAdmin } from "@/features/admin/get-memory";
import { mediaEditableView } from "@/features/admin/media-editable";
import { reorderMediaAsAdmin } from "@/features/admin/reorder-media";
import { setMediaDeletedAsAdmin } from "@/features/admin/set-media-deleted";
import { setMemoryStatusAsAdmin } from "@/features/admin/set-status";
import { updateMediaAsAdmin } from "@/features/admin/update-media";
import { recordMedia } from "@/features/memories/ingest-upload";
import { PrismaClient } from "@/generated/prisma/client";
import { resetEnvCache } from "@/server/config/env";

import { SIGNATURE_SAMPLES } from "../fixtures/signatures";
import { acquireCommittedDbLock } from "../helpers/committed-db-lock";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) {
  throw new Error("TEST_DATABASE_URL is not set in CI; the media-edit-tools suite must run there");
}
const client = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 8 }) }) : null;
/** Runs once, right after the next locked memory read inside a photo tool (its `select` names `consentVersion`). */
let afterLockedRead: (() => Promise<void>) | undefined;
const observed = client?.$extends({
  query: {
    memory: {
      async findUnique({ args, query }) {
        const result = await query(args);
        if (typeof args.select === "object" && args.select?.consentVersion && args.select?.updatedAt) {
          const hook = afterLockedRead;
          afterLockedRead = undefined;
          await hook?.();
        }
        return result;
      },
    },
  },
});
vi.mock("@/server/db/client", () => ({ getDb: () => observed }));
vi.mock("@/lib/sentry/after-flush", () => ({ afterWithFlush: () => {} }));
vi.mock("@/features/memories/derive-poster", () => ({ derivePoster: vi.fn(async () => "deferred") }));
const blobs = new Map<string, { bytes: Uint8Array; contentType: string }>();
vi.mock("@/services/storage", () => ({
  createStorageService: () => ({
    async head(pathname: string) {
      const blob = blobs.get(pathname);
      return blob ? { pathname, url: `https://blob.example.invalid/${pathname}`, size: blob.bytes.length, contentType: blob.contentType, uploadedAt: new Date() } : null;
    },
    async readPrefix(pathname: string, maxBytes: number) { return blobs.get(pathname)?.bytes.subarray(0, maxBytes) ?? null; },
    async readRange(pathname: string, offset: number, length: number) { return blobs.get(pathname)?.bytes.subarray(offset, offset + length) ?? null; },
    async get(pathname: string) {
      const blob = blobs.get(pathname);
      return blob ? { stream: new Blob([new Uint8Array(blob.bytes)]).stream(), contentType: blob.contentType, contentLength: blob.bytes.length } : null;
    },
    async del(pathname: string) { blobs.delete(pathname); },
    async presignPut({ contentType, validUntil }: { contentType: string; validUntil: number }) {
      return { url: "https://upload.example.invalid/synthetic", expiresAt: new Date(validUntil), headers: { "content-type": contentType, "x-content-type": contentType } };
    },
  }),
}));

const JPEG = new Uint8Array([...SIGNATURE_SAMPLES["image/jpeg"]!, ...new Array<number>(512).fill(9)]);
const SLUG = `media-edit-tools-${randomUUID()}`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe.skipIf(!client)("MCP photo tools (real Postgres)", () => {
  const db = client!;
  let memorialId: string | undefined;
  let committedLock: Awaited<ReturnType<typeof acquireCommittedDbLock>> | undefined;
  beforeAll(async () => {
    committedLock = await acquireCommittedDbLock(url!);
    vi.stubEnv("UPLOAD_TICKET_SECRET", "s".repeat(32));
    vi.stubEnv("DAILY_BYTE_BUDGET", "100000000000");
    vi.stubEnv("DAILY_MEMORY_BUDGET", "100000");
    vi.stubEnv("TOTAL_BYTE_CEILING", "100000000000");
    vi.stubEnv("VERCEL_ENV", "development");
    resetEnvCache();
    memorialId = (await db.memorial.create({ data: { slug: SLUG, name: "Media edit tools" } })).id;
  }, 180_000);
  afterEach(() => { afterLockedRead = undefined; });
  afterAll(async () => {
    try {
      if (memorialId) {
        const memories = { memory: { memorialId } };
        await db.derivedMedia.deleteMany({ where: { media: memories } });
        await db.memoryRevision.deleteMany({ where: memories });
        // Replacements point at their targets: drop the pointers before the rows.
        await db.media.updateMany({ where: memories, data: { replacesMediaId: null } });
        await db.media.deleteMany({ where: memories });
        await db.memory.deleteMany({ where: { memorialId } });
        await db.memorial.delete({ where: { id: memorialId } });
      }
    } finally {
      blobs.clear(); vi.unstubAllEnvs(); resetEnvCache();
      try { await db.$disconnect(); }
      finally { await committedLock?.release(); }
    }
  });

  /** A shared PENDING memory with three READY photos, slots 0..2, created in that order. */
  async function memoryWithPhotos(over: { note?: string | null } = {}) {
    const memory = await db.memory.create({ data: {
      memorialId: memorialId!, status: "PENDING", consentedAt: new Date(), type: "PHOTO", source: "OTHER", visibility: "PUBLIC",
      contributorNote: over.note === undefined ? "We sat on the dock." : over.note, consentVersion: "media-tools-test",
      claimTokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
    } });
    const ids: string[] = [];
    for (const [i, caption] of ["one", "two", "three"].entries()) {
      const row = await db.media.create({ data: {
        memoryId: memory.id, storageKey: `dev/originals/${memory.id}/${randomUUID()}.jpg`, status: "READY", mimeType: "image/jpeg",
        maxBytes: JPEG.length, sizeBytes: JPEG.length, blobUrl: "https://blob.example.invalid/x", sortOrder: i, caption,
      } });
      ids.push(row.id);
    }
    const fresh = await db.memory.findUniqueOrThrow({ where: { id: memory.id } });
    return { memoryId: memory.id, version: fresh.updatedAt.toISOString(), ids };
  }

  it("two simultaneous edits with the same version: the second waits on the lock, re-reads and answers stale", async () => {
    const { memoryId, version, ids } = await memoryWithPhotos();
    const locked = deferred(); const release = deferred();
    afterLockedRead = async () => { locked.resolve(); await release.promise; };
    const first = updateMediaAsAdmin({ memoryId, memoryVersion: version, mediaId: ids[0], changes: { caption: "first writer" } });
    await locked.promise;
    // The first holds the row lock inside its open transaction; the second must queue behind it.
    let secondSettled = false;
    const second = updateMediaAsAdmin({ memoryId, memoryVersion: version, mediaId: ids[0], changes: { caption: "second writer" } }).finally(() => { secondSettled = true; });
    await new Promise((r) => setTimeout(r, 300));
    expect(secondSettled).toBe(false);
    release.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toMatchObject({ ok: true, written: ["caption"] });
    expect(b).toMatchObject({ ok: false, code: "stale" });
    expect((await db.media.findUniqueOrThrow({ where: { id: ids[0] } })).caption).toBe("first writer");
    expect(await db.memoryRevision.count({ where: { memoryId } })).toBe(1);
    if (a.ok && !b.ok && b.code === "stale") {
      expect(b.current.memoryVersion).toBe(a.current.memoryVersion);
      expect(a.current.memoryVersion).not.toBe(version);
    }
  });

  it("back-to-back writes each hand out a new version that round-trips through TIMESTAMP(3)", async () => {
    const { memoryId, version, ids } = await memoryWithPhotos();
    const one = await updateMediaAsAdmin({ memoryId, memoryVersion: version, mediaId: ids[1], changes: { place: "Lake George" } });
    if (!one.ok) { throw new Error(`first edit refused: ${one.code}`); }
    const two = await reorderMediaAsAdmin({ memoryId, memoryVersion: one.current.memoryVersion, mediaIds: [ids[2], ids[0], ids[1]] });
    if (!two.ok) { throw new Error(`reorder refused: ${two.code}`); }
    const three = await updateMediaAsAdmin({ memoryId, memoryVersion: two.current.memoryVersion, mediaId: ids[1], changes: { place: "Bolton Landing" } });
    expect(three).toMatchObject({ ok: true, written: ["place"] });
    const versions = new Set([version, one.current.memoryVersion, two.current.memoryVersion, three.ok ? three.current.memoryVersion : ""]);
    expect(versions.size).toBe(4);
    expect((await db.memory.findUniqueOrThrow({ where: { id: memoryId } })).updatedAt.toISOString()).toBe(three.ok ? three.current.memoryVersion : "");
  });

  it("a real reorder, then a new upload: the new file sorts last", async () => {
    const { memoryId, version, ids } = await memoryWithPhotos();
    const reordered = await reorderMediaAsAdmin({ memoryId, memoryVersion: version, mediaIds: [ids[2], ids[0], ids[1]] });
    expect(reordered).toMatchObject({ ok: true, changed: true });
    const requested = await requestUploadAsAdmin({ memoryId, file: { name: "four.jpg", type: "image/jpeg", size: JPEG.length, sha256: createHash("sha256").update(JPEG).digest("hex") } });
    expect(requested).toMatchObject({ ok: true, status: "PENDING" });
    const view = await mediaEditableView(db, memoryId);
    expect(view!.media.map((m) => m.id)).toEqual([ids[2], ids[0], ids[1], requested.ok ? requested.mediaId : ""]);
  });

  it("remove, reorder, restore: the restored file keeps its old slot and the id settles the tie, the same order everywhere", async () => {
    const { memoryId, version, ids } = await memoryWithPhotos();
    // Make every creation time equal, so only the id can break a tie of slots.
    await db.media.updateMany({ where: { memoryId }, data: { createdAt: new Date("2026-11-08T12:00:00.000Z") } });
    const removed = await setMediaDeletedAsAdmin({ memoryId, memoryVersion: version, mediaId: ids[1], deleted: true });
    if (!removed.ok) { throw new Error(`remove refused: ${removed.code}`); }
    expect(removed.restorableUntil).toBeInstanceOf(Date);
    const reordered = await reorderMediaAsAdmin({ memoryId, memoryVersion: removed.current.memoryVersion, mediaIds: [ids[2], ids[0]] });
    if (!reordered.ok) { throw new Error(`reorder refused: ${reordered.code}`); }
    const restored = await setMediaDeletedAsAdmin({ memoryId, memoryVersion: reordered.current.memoryVersion, mediaId: ids[1], deleted: false });
    if (!restored.ok) { throw new Error(`restore refused: ${restored.code}`); }
    // ids[1] is back in slot 1, beside ids[0]; the smaller id comes first.
    const tie = [ids[0]!, ids[1]!].sort();
    expect(restored.current.media.map((m) => m.id)).toEqual([ids[2], ...tie]);
    expect((await getMemoryForAdmin(memoryId))!.media.map((m) => m.id)).toEqual([ids[2], ...tie]);
    expect(await db.media.findUniqueOrThrow({ where: { id: ids[1] } })).toMatchObject({ deletedAt: null, purgeAfter: null });
  });

  it("remove while a replacement is uploading: the replacement that lands later is retired, never restorable, and the target can still come back", async () => {
    const { memoryId, version, ids } = await memoryWithPhotos();
    const replacementKey = `dev/originals/${memoryId}/${randomUUID()}.jpg`;
    const replacement = await db.media.create({ data: {
      memoryId, storageKey: replacementKey, status: "PENDING", mimeType: "image/jpeg", maxBytes: JPEG.length, sortOrder: 0,
      replacesMediaId: ids[0], reservedUntil: new Date(Date.now() + 60 * 60 * 1000),
    } });
    const removed = await setMediaDeletedAsAdmin({ memoryId, memoryVersion: version, mediaId: ids[0], deleted: true });
    if (!removed.ok) { throw new Error(`remove refused: ${removed.code}`); }
    expect(await db.media.findUniqueOrThrow({ where: { id: replacement.id } })).toMatchObject({ deletedAt: expect.any(Date), purgeAfter: null });
    // The replacement's bytes land after the removal: ingest records them but never swaps the file in.
    blobs.set(replacementKey, { bytes: JPEG, contentType: "image/jpeg" });
    // recordMedia answers "retired"; the row is stored READY so the purge can find its bytes.
    expect(await recordMedia({ mediaId: replacement.id, signal: AbortSignal.timeout(15_000) })).toMatchObject({ status: "FAILED", reason: "retired" });
    expect(await db.media.findUniqueOrThrow({ where: { id: replacement.id } })).toMatchObject({ status: "READY", deletedAt: expect.any(Date), purgeAfter: null, replacesMediaId: ids[0] });
    const view = (await getMemoryForAdmin(memoryId))!;
    expect(view.removedMedia.map((m) => m.id)).toEqual([ids[0]]);
    expect(await setMediaDeletedAsAdmin({ memoryId, memoryVersion: view.memoryVersion, mediaId: replacement.id, deleted: false })).toEqual({ ok: false, code: "not_found" });
    const restored = await setMediaDeletedAsAdmin({ memoryId, memoryVersion: view.memoryVersion, mediaId: ids[0], deleted: false });
    expect(restored).toMatchObject({ ok: true, changed: true });
    if (restored.ok) {
      expect(restored.current.media.map((m) => m.id)).toEqual(ids);
    }
  });

  it("get_memory's reviewVersion ignores restorable removed rows, and approving with it goes through", async () => {
    const { memoryId, version, ids } = await memoryWithPhotos();
    const removed = await setMediaDeletedAsAdmin({ memoryId, memoryVersion: version, mediaId: ids[2], deleted: true });
    expect(removed).toMatchObject({ ok: true, changed: true });
    const view = (await getMemoryForAdmin(memoryId))!;
    expect(view.removedMedia.map((m) => m.id)).toEqual([ids[2]]);
    expect(view.media.map((m) => m.id)).toEqual([ids[0], ids[1]]);
    expect(await setMemoryStatusAsAdmin({ memoryId, status: "APPROVED", reviewVersion: view.reviewVersion })).toEqual({ ok: true });
  });

  it("the database refuses purgeAfter on a live row (Media_purge_after_removed)", async () => {
    const { ids } = await memoryWithPhotos();
    await expect(db.media.update({ where: { id: ids[0] }, data: { purgeAfter: new Date() } })).rejects.toThrow(/Media_purge_after_removed|check constraint/i);
  });
});
