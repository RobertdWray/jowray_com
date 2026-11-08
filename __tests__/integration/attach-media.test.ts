/**
 * A9-A11: committed rows, separate connections, real locks and conditional updates.
 * CI supplies a migrated TEST_DATABASE_URL. No local app database or real Blob is used.
 * The suite lock excludes budget-concurrency's TRUNCATE, without serializing these writers.
 */
import { createHash, randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { finalizeUploadAsAdmin, requestUploadAsAdmin } from "@/features/admin/attach-media";
import { setMemoryDeletedAsAdmin } from "@/features/admin/set-deleted";
import { recordMedia } from "@/features/memories/ingest-upload";
import { PrismaClient } from "@/generated/prisma/client";
import { resetEnvCache } from "@/server/config/env";

import { SIGNATURE_SAMPLES } from "../fixtures/signatures";
import { acquireCommittedDbLock } from "../helpers/committed-db-lock";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) {
  throw new Error("TEST_DATABASE_URL is not set in CI; the attach-media concurrency suite must run there");
}
const client = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 8 }) }) : null;
let afterFirstMemoryRead: (() => Promise<void>) | undefined;
let afterRecordRead: (() => Promise<void>) | undefined;
let afterMediaCreate: (() => Promise<void>) | undefined;
/** Interleaving hooks hold real operations at their boundaries; all queries still hit Postgres. */
const observed = client?.$extends({
  query: {
    memory: {
      async findUnique({ args, query }) {
        const result = await query(args);
        const hook = afterFirstMemoryRead;
        afterFirstMemoryRead = undefined;
        await hook?.();
        return result;
      },
    },
    media: {
      async create({ args, query }) {
        const result = await query(args);
        await afterMediaCreate?.();
        return result;
      },
      async findUnique({ args, query }) {
        const result = await query(args);
        // recordMedia's pre-transition read, excluding finalize's authorization/readback queries.
        if (typeof args.include?.memory === "object" && args.include.memory.select?.deletedAt) {
          await afterRecordRead?.();
        }
        return result;
      },
    },
  },
});
vi.mock("@/server/db/client", () => ({ getDb: () => observed }));
const tasks: Array<() => Promise<unknown>> = [];
vi.mock("@/lib/sentry/after-flush", () => ({ afterWithFlush: (_name: string, task: () => Promise<unknown>) => { tasks.push(task); } }));
// Finalize schedules a video's poster task (video-posters plan T7); these tests never run the tasks, and the poster
// feature (ffmpeg, the image slot) is not what they exercise.
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

const BYTES = new Uint8Array([...SIGNATURE_SAMPLES["video/quicktime"]!, ...new Array<number>(1024).fill(7)]);
const HASH = createHash("sha256").update(BYTES).digest("hex");
const FILE = { name: "clip.mov", type: "video/quicktime", size: BYTES.length, sha256: HASH };
const SLUG = `attach-media-concurrency-${randomUUID()}`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe.skipIf(!client)("attach-media concurrency (real Postgres)", () => {
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
    memorialId = (await db.memorial.create({ data: { slug: SLUG, name: "Attach media concurrency" } })).id;
  }, 180_000);
  afterEach(() => { afterFirstMemoryRead = undefined; afterRecordRead = undefined; afterMediaCreate = undefined; tasks.length = 0; });
  afterAll(async () => {
    try {
      if (memorialId) {
        const memories = { memory: { memorialId } };
        await db.derivedMedia.deleteMany({ where: { media: memories } });
        await db.emailLog.deleteMany({ where: memories });
        await db.memoryRevision.deleteMany({ where: memories });
        await db.media.deleteMany({ where: memories });
        await db.memory.deleteMany({ where: { memorialId } });
        await db.contributor.deleteMany({ where: { memorialId } });
        await db.memorial.delete({ where: { id: memorialId } });
      }
    } finally {
      blobs.clear(); vi.unstubAllEnvs(); resetEnvCache();
      try { await db.$disconnect(); }
      finally { await committedLock?.release(); }
    }
  });
  async function draft() {
    return db.memory.create({ data: {
      memorialId: memorialId!, status: "DRAFT", type: "TEXT", source: "OTHER",
      contributorNote: "Words", consentVersion: "attach-test", claimTokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
    } });
  }

  it("A9: two simultaneous requests for one hash commit exactly one ADMIN reservation", async () => {
    const memory = await draft();
    const results = await Promise.all([requestUploadAsAdmin({ memoryId: memory.id, file: FILE }), requestUploadAsAdmin({ memoryId: memory.id, file: FILE })]);
    const rows = await db.media.findMany({ where: { memoryId: memory.id } });
    expect(rows).toHaveLength(1);
    for (const result of results) { expect(result).toMatchObject({ ok: true, status: "PENDING", mediaId: rows[0]!.id }); }
    expect(rows[0]).toMatchObject({ addedVia: "ADMIN", declaredSha256: HASH, maxBytes: BYTES.length });
    expect(await db.memoryRevision.count({ where: { memoryId: memory.id } })).toBe(0);
  });

  it("A10: delete commits while request holds its stale pre-lock read; request then refuses and creates no row", async () => {
    const memory = await draft();
    const read = deferred(); const deleted = deferred();
    afterFirstMemoryRead = async () => { read.resolve(); await deleted.promise; };
    const requesting = requestUploadAsAdmin({ memoryId: memory.id, file: FILE });
    try {
      await read.promise;
      expect(await setMemoryDeletedAsAdmin({ memoryId: memory.id, deleted: true })).toMatchObject({ ok: true });
    } finally { deleted.resolve(); }
    expect(await requesting).toEqual({ ok: false, code: "not_found" });
    expect(await db.media.count({ where: { memoryId: memory.id } })).toBe(0);
  });

  it("A10: a request holding the memory lock commits before a concurrent deletion", async () => {
    const memory = await draft();
    const inserted = deferred(); const allowCommit = deferred();
    afterMediaCreate = async () => { inserted.resolve(); await allowCommit.promise; };
    const requesting = requestUploadAsAdmin({ memoryId: memory.id, file: FILE });
    await inserted.promise;
    const deleting = setMemoryDeletedAsAdmin({ memoryId: memory.id, deleted: true });
    try {
      // The inserted row is still uncommitted and the memory is still live on another connection.
      expect(await db.media.count({ where: { memoryId: memory.id } })).toBe(0);
      expect((await db.memory.findUniqueOrThrow({ where: { id: memory.id } })).deletedAt).toBeNull();
    } finally { allowCommit.resolve(); }
    const [requested, removed] = await Promise.all([requesting, deleting]);
    expect(requested).toMatchObject({ ok: true, status: "PENDING" }); expect(removed).toMatchObject({ ok: true });
    expect(await db.media.count({ where: { memoryId: memory.id } })).toBe(1);
    expect((await db.memory.findUniqueOrThrow({ where: { id: memory.id } })).deletedAt).not.toBeNull();
  });

  it("A11: finalize and cron both read PENDING; exactly one READY transition and ADMIN revision commit", async () => {
    const memory = await draft();
    const requested = await requestUploadAsAdmin({ memoryId: memory.id, file: FILE });
    expect(requested.ok).toBe(true);
    if (!requested.ok) { throw new Error("request unexpectedly refused"); }
    const row = await db.media.findUniqueOrThrow({ where: { id: requested.mediaId } });
    blobs.set(row.storageKey, { bytes: BYTES, contentType: FILE.type });
    const bothRead = deferred(); let readers = 0;
    afterRecordRead = async () => {
      readers += 1;
      if (readers === 2) { bothRead.resolve(); }
      await bothRead.promise;
    };
    const [finalized, cron] = await Promise.all([
      finalizeUploadAsAdmin({ memoryId: memory.id, mediaId: row.id }),
      recordMedia({ mediaId: row.id, signal: AbortSignal.timeout(15_000) }),
    ]);
    expect(readers).toBe(2);
    expect(finalized).toEqual({ ok: true, status: "READY", mediaId: row.id, memoryType: "VIDEO", gps: "none" });
    expect(cron.status).toBe("READY");
    expect(await db.media.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "READY", checksumSha256: HASH, sizeBytes: BYTES.length, gpsCheckedAt: expect.any(Date), latitude: null, longitude: null });
    const revisions = await db.memoryRevision.findMany({ where: { memoryId: memory.id } });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ changedVia: "ADMIN", before: { readyMediaIds: [] }, after: { readyMediaIds: [row.id], addedMediaId: row.id, consentVersion: "attach-test" } });
    expect(await db.memory.findUniqueOrThrow({ where: { id: memory.id } })).toMatchObject({ status: "DRAFT", consentedAt: null });
    expect(await db.emailLog.count({ where: { memoryId: memory.id } })).toBe(0);
  });
});
