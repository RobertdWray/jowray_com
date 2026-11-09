import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMediaToolsFakeDb, fakeMedia, fakeMemory } from "../helpers/media-tools-fake-db";

/**
 * MCP `reorder_media` (plan 2026-11-08-mcp-media-tools §3.4, D8, D9, D11; George G3): the whole visible list in a new
 * order, guarded by `memoryVersion` under the memory lock, with one ADMIN revision and a moved version.
 */

const fake = createMediaToolsFakeDb();
vi.mock("@/server/db/client", () => ({ getDb: () => fake.db }));

import { reorderMediaAsAdmin } from "@/features/admin/reorder-media";

const MEM = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const C = "00000000-0000-4000-8000-0000000000c1";
const REPL = "00000000-0000-4000-8000-0000000000d1";
const GONE = "00000000-0000-4000-8000-0000000000e1";
const V0 = "2026-11-08T14:36:08.673Z";
const NOW = new Date("2026-11-08T20:00:00.000Z");

const memory = () => fake.memories.find((m) => m.id === MEM)!;
const file = (id: string) => fake.media.find((m) => m.id === id)!;
const call = (over: Record<string, unknown> = {}) => reorderMediaAsAdmin({ memoryId: MEM, memoryVersion: V0, mediaIds: [C, A, B], ...over });
const writes = () => fake.calls.filter((c) => c.startsWith("memory.update") || c.startsWith("media.update"));
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.clearAllMocks();
  fake.reset();
  fake.memories.push(fakeMemory({ id: MEM, updatedAt: new Date(V0) }), fakeMemory({ id: OTHER }));
  fake.media.push(
    fakeMedia({ id: A, memoryId: MEM, sortOrder: 0 }),
    fakeMedia({ id: B, memoryId: MEM, sortOrder: 1 }),
    fakeMedia({ id: C, memoryId: MEM, sortOrder: 2 }),
  );
});
afterEach(() => { vi.useRealTimers(); });

describe("reorderMediaAsAdmin", () => {
  it("writes the new slots, copies each to its pending replacement, appends one revision and moves the version last, lock first", async () => {
    fake.media.push(fakeMedia({ id: REPL, memoryId: MEM, status: "PENDING", sortOrder: 0, replacesMediaId: A }));
    const result = await call();

    expect(result).toMatchObject({ ok: true, changed: true });
    expect([file(C).sortOrder, file(A).sortOrder, file(B).sortOrder]).toEqual([0, 1, 2]);
    expect(file(REPL).sortOrder).toBe(1);
    expect(fake.revisions).toHaveLength(1);
    expect(fake.revisions[0]).toMatchObject({ changedVia: "ADMIN", before: { mediaIds: [A, B, C] }, after: { mediaIds: [C, A, B] } });
    expect(fake.calls[0]).toBe(`lock:${MEM}`);
    expect(fake.calls.filter((c) => c.startsWith("memory.update"))).toEqual([`memory.update:${MEM}:updatedAt`]);
    expect(memory().updatedAt.toISOString()).toBe(NOW.toISOString());
    if (result.ok) {
      expect(result.current.media.map((m) => m.id)).toEqual([C, A, B]);
      expect(result.current.memoryVersion).toBe(NOW.toISOString());
    }
  });

  it("is a no-op when the id order is unchanged, even with gaps in the slots after a removal (George G3)", async () => {
    file(C).sortOrder = 4;
    fake.media.push(fakeMedia({ id: GONE, memoryId: MEM, sortOrder: 2, deletedAt: new Date("2026-11-08T18:00:00.000Z") }));
    const result = await call({ mediaIds: [A, B, C] });
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(writes()).toEqual([]);
    expect(fake.revisions).toHaveLength(0);
    expect(file(C).sortOrder).toBe(4);
  });

  it("takes FAILED rows as part of the visible list, and more than MAX_FILES_PER_MEMORY of them (D8)", async () => {
    const extra = Array.from({ length: 9 }, (_, i) => uuid(0x100 + i));
    extra.forEach((id, i) => fake.media.push(fakeMedia({ id, memoryId: MEM, sortOrder: 3 + i, status: i < 7 ? "READY" : "FAILED" })));
    const order = [...extra].reverse().concat([C, B, A]);
    const result = await call({ mediaIds: order });
    expect(result).toMatchObject({ ok: true, changed: true });
    if (result.ok) {
      expect(result.current.media.map((m) => m.id)).toEqual(order);
    }
  });

  it.each([
    ["a missing id", [C, A]],
    ["an id that is not one of this memory's files", [C, A, B, uuid(0x999)]],
    ["a removed file's id", [C, A, B, GONE]],
    ["a pending replacement's id", [C, A, B, REPL]],
  ])("answers mismatch with current for %s, and writes nothing", async (_label, mediaIds) => {
    fake.media.push(
      fakeMedia({ id: GONE, memoryId: MEM, sortOrder: 3, deletedAt: new Date("2026-11-08T18:00:00.000Z") }),
      fakeMedia({ id: REPL, memoryId: MEM, status: "PENDING", replacesMediaId: A }),
    );
    const result = await call({ mediaIds });
    expect(result).toMatchObject({ ok: false, code: "mismatch", current: { memoryVersion: V0 } });
    if (!result.ok && result.code === "mismatch") {
      expect(result.current.media.map((m) => m.id)).toEqual([A, B, C]);
    }
    expect(writes()).toEqual([]);
  });

  it("answers stale with current before comparing the list (D11)", async () => {
    memory().updatedAt = new Date("2026-11-08T19:00:00.000Z");
    expect(await call({ mediaIds: [A] })).toMatchObject({ ok: false, code: "stale", current: { memoryVersion: "2026-11-08T19:00:00.000Z" } });
    expect(writes()).toEqual([]);
  });

  it.each([
    ["a missing memory", () => {}, { memoryId: "00000000-0000-4000-8000-000000000009" }],
    ["a deleted memory", () => { memory().deletedAt = new Date("2026-11-08T18:00:00.000Z"); }, {}],
  ])("answers not_found for %s", async (_label, arrange, over) => {
    arrange();
    expect(await call(over)).toEqual({ ok: false, code: "not_found" });
  });

  it.each([
    ["an empty list", { mediaIds: [] }],
    ["a duplicate id", { mediaIds: [A, A, B] }],
    ["more than 100 ids", { mediaIds: Array.from({ length: 101 }, (_, i) => uuid(0x1000 + i)) }],
    ["an id that is not a uuid", { mediaIds: [A, "b7ba9311"] }],
  ])("answers invalid for %s without touching the database", async (_label, over) => {
    expect(await call(over)).toEqual({ ok: false, code: "invalid" });
    expect(fake.db.$transaction).not.toHaveBeenCalled();
  });
});
