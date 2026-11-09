import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMediaToolsFakeDb, fakeMedia, fakeMemory } from "../helpers/media-tools-fake-db";

/**
 * MCP `set_media_deleted` (plan 2026-11-08-mcp-media-tools §3.3, D6, D7, D11): remove a file (a READY file keeps its
 * bytes 30 days and can be restored; a PENDING or FAILED one is a cancellation) or restore one, guarded by
 * `memoryVersion` under the memory lock, with one ADMIN revision and a moved version.
 */

const fake = createMediaToolsFakeDb();
vi.mock("@/server/db/client", () => ({ getDb: () => fake.db }));

import { setMediaDeletedAsAdmin } from "@/features/admin/set-media-deleted";
import { MAX_FILES_PER_MEMORY } from "@/lib/media-types";

const MEM = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const C = "00000000-0000-4000-8000-0000000000c1";
const REPL = "00000000-0000-4000-8000-0000000000d1";
const V0 = "2026-11-08T14:36:08.673Z";
const NOW = new Date("2026-11-08T20:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const PURGE_AFTER = new Date(NOW.getTime() + 30 * DAY_MS);
const EARLIER = new Date("2026-11-08T18:00:00.000Z");

const memory = () => fake.memories.find((m) => m.id === MEM)!;
const file = (id: string) => fake.media.find((m) => m.id === id)!;
const call = (over: Record<string, unknown> = {}) => setMediaDeletedAsAdmin({ memoryId: MEM, memoryVersion: V0, mediaId: B, deleted: true, ...over });
const writes = () => fake.calls.filter((c) => c.startsWith("memory.update") || c.startsWith("media.update"));

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.clearAllMocks();
  fake.reset();
  fake.memories.push(fakeMemory({ id: MEM, updatedAt: new Date(V0), type: "VIDEO", contributorNote: null }), fakeMemory({ id: OTHER }));
  fake.media.push(
    fakeMedia({ id: A, memoryId: MEM, sortOrder: 0 }),
    fakeMedia({ id: B, memoryId: MEM, sortOrder: 1, mimeType: "video/quicktime", caption: "The four flags in October 2017." }),
    fakeMedia({ id: C, memoryId: MEM, sortOrder: 2 }),
  );
});
afterEach(() => { vi.useRealTimers(); });

describe("setMediaDeletedAsAdmin: remove", () => {
  it("removes a READY file with a 30-day grace, cancels its pending replacement, recomputes the type, appends one revision and moves the version last", async () => {
    fake.media.push(fakeMedia({ id: REPL, memoryId: MEM, status: "PENDING", replacesMediaId: B }));
    const result = await call();

    expect(result).toMatchObject({ ok: true, changed: true, restorableUntil: PURGE_AFTER });
    expect(file(B)).toMatchObject({ deletedAt: NOW, purgeAfter: PURGE_AFTER, purgedAt: null });
    // The replacement is a cancellation: no grace, never restorable (D6).
    expect(file(REPL)).toMatchObject({ deletedAt: NOW, purgeAfter: null });
    expect(memory().type).toBe("PHOTO");
    expect(fake.revisions).toHaveLength(1);
    expect(fake.revisions[0]).toMatchObject({
      changedVia: "ADMIN",
      before: { mediaIds: [A, B, C], type: "VIDEO" },
      after: { mediaIds: [A, C], type: "PHOTO", removedMediaId: B, purgeAfter: PURGE_AFTER.toISOString(), cancelledReplacementIds: [REPL] },
    });
    expect(fake.calls[0]).toBe(`lock:${MEM}`);
    const memoryWrites = fake.calls.filter((c) => c.startsWith("memory.update"));
    expect(memoryWrites.at(-1)).toBe(`memory.update:${MEM}:updatedAt`);
    expect(memory().updatedAt.toISOString()).toBe(NOW.toISOString());
    if (result.ok) {
      expect(result.current.media.map((m) => m.id)).toEqual([A, C]);
      expect(result.current.removedMedia).toEqual([expect.objectContaining({ id: B, removedAt: NOW, restorableUntil: PURGE_AFTER, caption: "The four flags in October 2017." })]);
      expect(result.current.memoryVersion).toBe(NOW.toISOString());
    }
  });

  it.each(["PENDING", "FAILED"] as const)("cancels a %s file: deletedAt only, no grace, no restorableUntil (D6)", async (status) => {
    file(B).status = status;
    const result = await call();
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(result).not.toHaveProperty("restorableUntil");
    expect(file(B)).toMatchObject({ deletedAt: NOW, purgeAfter: null });
    expect(fake.revisions[0]).toMatchObject({ after: { removedMediaId: B, purgeAfter: null } });
    if (result.ok) {
      expect(result.current.removedMedia).toEqual([]);
    }
  });

  it("refuses to remove the last READY file of a memory without words (last_file)", async () => {
    file(A).status = "FAILED";
    file(C).status = "READY";
    file(C).purgedAt = EARLIER; // gone or going: cannot hold the memory up
    expect(await call()).toEqual({ ok: false, code: "last_file" });
    expect(writes()).toEqual([]);
    expect(fake.revisions).toHaveLength(0);
    // A refusal reads no file list it does not answer with (TCR round 1, #1 side point).
    expect(fake.db.media.findMany).not.toHaveBeenCalled();
  });

  it("removes a READY file the cron already claimed when another file is the only live READY one (TCR #1: a claimed file is not live, so no last_file)", async () => {
    file(A).status = "FAILED";
    file(B).status = "READY";
    file(B).purgedAt = EARLIER; // claimed by cron (f): its bytes are gone or going
    expect(await call()).toMatchObject({ ok: true, changed: true });
    expect(file(B).deletedAt).toEqual(NOW);
  });

  it("gives no grace to a READY file the cron already claimed: purgeAfter stays null, no restorableUntil (TCR #1)", async () => {
    memory().contributorNote = "We sat on the dock.";
    file(B).purgedAt = EARLIER;
    const result = await call();
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(result).not.toHaveProperty("restorableUntil");
    expect(file(B)).toMatchObject({ deletedAt: NOW, purgeAfter: null });
    expect(fake.revisions[0]).toMatchObject({ after: { removedMediaId: B, purgeAfter: null } });
    if (result.ok) {
      expect(result.current.removedMedia).toEqual([]);
    }
  });

  it("removes the last READY file when the memory has words", async () => {
    memory().contributorNote = "We sat on the dock.";
    file(A).status = "FAILED";
    file(C).status = "FAILED";
    expect(await call()).toMatchObject({ ok: true, changed: true });
    expect(memory().type).toBe("TEXT");
  });

  it("answers changed: false for a file already removed, with no write, revision or touch", async () => {
    file(B).deletedAt = EARLIER;
    const result = await call();
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(result).not.toHaveProperty("restorableUntil");
    expect(writes()).toEqual([]);
    expect(fake.revisions).toHaveLength(0);
  });

  it("repeats restorableUntil for a file already removed through MCP and still restorable (George G9)", async () => {
    const until = new Date(EARLIER.getTime() + 30 * DAY_MS);
    Object.assign(file(B), { deletedAt: EARLIER, purgeAfter: until });
    expect(await call()).toMatchObject({ ok: true, changed: false, restorableUntil: until });
    expect(writes()).toEqual([]);
  });
});

describe("setMediaDeletedAsAdmin: restore", () => {
  beforeEach(() => {
    Object.assign(file(B), { deletedAt: EARLIER, purgeAfter: new Date(EARLIER.getTime() + 30 * DAY_MS) });
    memory().type = "PHOTO";
  });

  it("restores a file removed through MCP: clears both stamps, keeps its slot, recomputes the type, one revision, version moved", async () => {
    const result = await call({ deleted: false });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(result).not.toHaveProperty("restorableUntil");
    expect(file(B)).toMatchObject({ deletedAt: null, purgeAfter: null, sortOrder: 1 });
    expect(memory().type).toBe("VIDEO");
    expect(fake.revisions[0]).toMatchObject({ changedVia: "ADMIN", before: { mediaIds: [A, C], type: "PHOTO" }, after: { mediaIds: [A, B, C], type: "VIDEO", restoredMediaId: B } });
    expect(fake.calls.filter((c) => c.startsWith("memory.update")).at(-1)).toBe(`memory.update:${MEM}:updatedAt`);
    if (result.ok) {
      expect(result.current.media.map((m) => m.id)).toEqual([A, B, C]);
      expect(result.current.removedMedia).toEqual([]);
    }
  });

  it("still restores after purgeAfter has passed, until the cron has claimed the row (D7)", async () => {
    file(B).purgeAfter = EARLIER;
    expect(await call({ deleted: false })).toMatchObject({ ok: true, changed: true });
  });

  it("answers changed: false for a file that is not removed", async () => {
    expect(await call({ deleted: false, mediaId: A })).toMatchObject({ ok: true, changed: false });
    expect(writes()).toEqual([]);
  });

  it.each([
    ["a claim-page removal (no grace)", () => { file(B).purgeAfter = null; }],
    ["a cancelled upload", () => { Object.assign(file(B), { status: "PENDING", purgeAfter: null }); }],
    ["a file the cron already claimed", () => { Object.assign(file(B), { status: "FAILED", purgedAt: NOW }); }],
  ])("refuses %s (not_restorable)", async (_label, arrange) => {
    arrange();
    expect(await call({ deleted: false })).toEqual({ ok: false, code: "not_restorable" });
    expect(writes()).toEqual([]);
    expect(fake.db.media.findMany).not.toHaveBeenCalled();
  });

  it("refuses when the memory already holds MAX_FILES_PER_MEMORY live files (too_many_files)", async () => {
    for (let i = fake.media.filter((m) => m.memoryId === MEM && m.deletedAt === null).length; i < MAX_FILES_PER_MEMORY; i += 1) {
      fake.media.push(fakeMedia({ id: `00000000-0000-4000-8000-00000000e${String(i).padStart(3, "0")}`, memoryId: MEM, sortOrder: 10 + i, status: i % 2 === 0 ? "READY" : "PENDING" }));
    }
    expect(await call({ deleted: false })).toEqual({ ok: false, code: "too_many_files" });
    expect(writes()).toEqual([]);
    expect(fake.db.media.findMany).not.toHaveBeenCalled();
  });
});

describe("setMediaDeletedAsAdmin: refusals", () => {
  it("answers stale with current before looking at the file (D11)", async () => {
    memory().updatedAt = new Date("2026-11-08T19:00:00.000Z");
    const result = await call({ mediaId: "00000000-0000-4000-8000-0000000000ff" });
    expect(result).toMatchObject({ ok: false, code: "stale", current: { memoryVersion: "2026-11-08T19:00:00.000Z" } });
    expect(writes()).toEqual([]);
  });

  it.each([
    ["a missing memory", () => {}, { memoryId: "00000000-0000-4000-8000-000000000009" }],
    ["a deleted memory", () => { memory().deletedAt = EARLIER; }, {}],
    ["another memory's file", () => { fake.media.push(fakeMedia({ id: REPL, memoryId: OTHER })); }, { mediaId: REPL }],
    ["a pending replacement", () => { fake.media.push(fakeMedia({ id: REPL, memoryId: MEM, status: "PENDING", replacesMediaId: B })); }, { mediaId: REPL }],
    ["a cancelled replacement on restore", () => { fake.media.push(fakeMedia({ id: REPL, memoryId: MEM, deletedAt: EARLIER, replacesMediaId: B })); }, { mediaId: REPL, deleted: false }],
  ])("answers not_found for %s", async (_label, arrange, over) => {
    arrange();
    expect(await call(over)).toEqual({ ok: false, code: "not_found" });
    expect(writes()).toEqual([]);
  });

  it.each([
    ["a missing deleted flag", { deleted: undefined }],
    ["a string flag", { deleted: "true" }],
    ["a mediaId that is not a uuid", { mediaId: "b7ba9311" }],
  ])("answers invalid for %s without touching the database", async (_label, over) => {
    expect(await call(over)).toEqual({ ok: false, code: "invalid" });
    expect(fake.db.$transaction).not.toHaveBeenCalled();
  });
});
