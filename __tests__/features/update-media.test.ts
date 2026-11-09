import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMediaToolsFakeDb, fakeMedia, fakeMemory } from "../helpers/media-tools-fake-db";

/**
 * MCP `update_media` (plan 2026-11-08-mcp-media-tools §3.2, D2, D4, D10, D11): a READY file's caption, rough date
 * and place, guarded by `memoryVersion` under the memory lock, with one ADMIN revision and a moved version.
 */

const fake = createMediaToolsFakeDb();
vi.mock("@/server/db/client", () => ({ getDb: () => fake.db }));

import { updateMediaAsAdmin } from "@/features/admin/update-media";

const MEM = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const REPL = "00000000-0000-4000-8000-0000000000c1";
const V0 = "2026-11-08T14:36:08.673Z";
const NOW = new Date("2026-11-08T20:00:00.000Z");
const CAPTION = "Morning Glory: the four flags on a misty morning, October 6, 2007. Nancy titled this photo “Morning Glory.”";

const memory = () => fake.memories.find((m) => m.id === MEM)!;
const file = (id: string) => fake.media.find((m) => m.id === id)!;
const edit = (over: Record<string, unknown> = {}) => updateMediaAsAdmin({ memoryId: MEM, memoryVersion: V0, mediaId: A, changes: { caption: CAPTION }, ...over });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.clearAllMocks();
  fake.reset();
  fake.memories.push(fakeMemory({ id: MEM, updatedAt: new Date(V0), status: "APPROVED", visibility: "PUBLIC" }), fakeMemory({ id: OTHER }));
  fake.media.push(
    fakeMedia({ id: A, memoryId: MEM, sortOrder: 0, caption: "The four flags on a misty morning, October 6, 2007.", approxDateText: "October 6, 2007" }),
    fakeMedia({ id: B, memoryId: MEM, sortOrder: 1 }),
  );
});
afterEach(() => { vi.useRealTimers(); });

describe("updateMediaAsAdmin", () => {
  it("writes the changed words, copies them to a pending replacement, appends one ADMIN revision and moves the version, lock first", async () => {
    fake.media.push(fakeMedia({ id: REPL, memoryId: MEM, status: "PENDING", replacesMediaId: A, caption: "old" }));
    const result = await edit({ changes: { caption: CAPTION, approxDateText: "October 6, 2007" } });

    expect(result).toMatchObject({ ok: true, written: ["caption"] });
    expect(file(A).caption).toBe(CAPTION);
    expect(file(A).approxDateText).toBe("October 6, 2007");
    expect(file(REPL).caption).toBe(CAPTION);
    expect(fake.revisions).toHaveLength(1);
    expect(fake.revisions[0]).toMatchObject({
      memoryId: MEM,
      changedVia: "ADMIN",
      before: { mediaId: A, caption: "The four flags on a misty morning, October 6, 2007." },
      after: { mediaId: A, caption: CAPTION },
    });
    expect(Object.keys(fake.revisions[0]!.before).sort()).toEqual(["caption", "mediaId"]);
    // The version moved (D2), by an explicit timestamp, as the last write to the memory row.
    expect(memory().updatedAt.toISOString()).toBe(NOW.toISOString());
    const memoryWrites = fake.calls.filter((c) => c.startsWith("memory.update"));
    expect(memoryWrites).toEqual([`memory.update:${MEM}:updatedAt`]);
    expect(fake.calls[0]).toBe(`lock:${MEM}`);
    // An admin edit never reopens review (D4).
    expect(memory().status).toBe("APPROVED");
    if (result.ok) {
      expect(result.current.memoryVersion).toBe(NOW.toISOString());
      expect(result.current.media.find((m) => m.id === A)?.caption).toBe(CAPTION);
      expect(result.current).toMatchObject({ status: "APPROVED", visibility: "PUBLIC" });
    }
  });

  it("clears a word with null", async () => {
    const result = await edit({ changes: { approxDateText: null } });
    expect(result).toMatchObject({ ok: true, written: ["approxDateText"] });
    expect(file(A).approxDateText).toBeNull();
    expect(fake.revisions[0]).toMatchObject({ before: { mediaId: A, approxDateText: "October 6, 2007" }, after: { mediaId: A, approxDateText: null } });
  });

  it("writes nothing when the words are already equal: no media write, no revision, no touch", async () => {
    const result = await edit({ changes: { approxDateText: "October 6, 2007" } });
    expect(result).toMatchObject({ ok: true, written: [] });
    expect(fake.revisions).toHaveLength(0);
    expect(fake.calls.filter((c) => c.startsWith("memory.update") || c.startsWith("media.update"))).toEqual([]);
    expect(memory().updatedAt.toISOString()).toBe(V0);
    if (result.ok) {
      expect(result.current.memoryVersion).toBe(V0);
    }
  });

  it("answers stale with current (status and visibility included) when the version moved, and writes nothing", async () => {
    memory().updatedAt = new Date("2026-11-08T19:00:00.000Z");
    memory().status = "PENDING";
    const result = await edit();
    expect(result).toMatchObject({ ok: false, code: "stale", current: { memoryVersion: "2026-11-08T19:00:00.000Z", status: "PENDING", visibility: "PUBLIC" } });
    expect(file(A).caption).not.toBe(CAPTION);
    expect(fake.revisions).toHaveLength(0);
  });

  it("checks the version before the target (D11): a stale call about another memory's file is stale, not not_found", async () => {
    memory().updatedAt = new Date("2026-11-08T19:00:00.000Z");
    expect(await edit({ mediaId: "00000000-0000-4000-8000-0000000000ff" })).toMatchObject({ ok: false, code: "stale" });
  });

  it.each([
    ["a missing memory", () => {}, { memoryId: "00000000-0000-4000-8000-000000000009" }],
    ["a deleted memory", () => { memory().deletedAt = new Date("2026-11-08T18:00:00.000Z"); }, {}],
    ["another memory's file", () => { fake.media.push(fakeMedia({ id: REPL, memoryId: OTHER })); }, { mediaId: REPL }],
    ["a removed file", () => { file(A).deletedAt = new Date("2026-11-08T18:00:00.000Z"); }, {}],
    ["a pending replacement", () => { fake.media.push(fakeMedia({ id: REPL, memoryId: MEM, status: "PENDING", replacesMediaId: A })); }, { mediaId: REPL }],
    ["a PENDING file (a request_upload retry rewrites its words, D10)", () => { file(A).status = "PENDING"; }, {}],
    ["a FAILED file", () => { file(A).status = "FAILED"; }, {}],
    ["a purged file", () => { file(A).purgedAt = new Date("2026-11-08T18:00:00.000Z"); }, {}],
  ])("answers not_found for %s and writes nothing", async (_label, arrange, over) => {
    arrange();
    expect(await edit(over)).toEqual({ ok: false, code: "not_found" });
    expect(fake.revisions).toHaveLength(0);
    expect(fake.calls.filter((c) => c.startsWith("memory.update") || c.startsWith("media.update"))).toEqual([]);
  });

  it.each([
    ["no changes object", { changes: undefined }],
    ["an empty changes object", { changes: {} }],
    ["an unknown key inside changes", { changes: { caption: "x", sortOrder: 2 } }],
    ["a caption over 2000 characters", { changes: { caption: "x".repeat(2001) } }],
    ["a mediaId that is not a uuid", { mediaId: "b7ba9311" }],
    ["a memoryVersion that is not a date", { memoryVersion: "yesterday" }],
  ])("answers invalid for %s without touching the database", async (_label, over) => {
    expect(await edit(over)).toEqual({ ok: false, code: "invalid" });
    expect(fake.db.$transaction).not.toHaveBeenCalled();
  });
});
