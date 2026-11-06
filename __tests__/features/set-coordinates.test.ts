import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-memory Prisma stub for `setMemoryCoordinatesAsAdmin` (plan 2026-11-06 §4.2),
 * after the pattern in admin-memories.test.ts. Every call is logged in order so
 * the test can prove the row lock comes before the re-read and the write.
 */

const MEM = "00000000-0000-4000-8000-000000000001";
const MEM2 = "00000000-0000-4000-8000-000000000002";
const T0 = new Date("2026-11-04T10:00:00.000Z");
const T1 = new Date("2026-11-04T11:00:00.000Z");
const BROADMEAD = { latitude: 39.4815, longitude: -76.6447 };

interface MemoryRow { id: string; deletedAt: Date | null; updatedAt: Date; latitude: number | null; longitude: number | null; consentVersion: string }
interface Rev { memoryId: string; changedVia: string; before: Record<string, unknown>; after: Record<string, unknown>; createdAt: Date; id: string }

let memories: MemoryRow[] = [];
let revisions: Rev[] = [];
const calls: string[] = [];

const tx = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push(`lock:${strings.join("?").includes('"Memory"') ? "memory" : "other"}:${String(values[0])}`);
    return [{ id: values[0] }];
  }),
  memory: {
    findUnique: vi.fn(async ({ where, select }: { where: { id: string }; select: Record<string, boolean> }) => {
      calls.push(`read:${where.id}`);
      const row = memories.find((m) => m.id === where.id);
      if (!row) { return null; }
      // Answer only what was selected, as Prisma does, so a missing column in the select shows up as undefined.
      return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k as keyof MemoryRow]]));
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MemoryRow> }) => {
      calls.push(`update:${where.id}`);
      const row = memories.find((m) => m.id === where.id)!;
      Object.assign(row, data, { updatedAt: new Date(row.updatedAt.getTime() + 1000) });
      return row;
    }),
  },
  memoryRevision: {
    count: vi.fn(async ({ where }: { where: { memoryId: string } }) => revisions.filter((r) => r.memoryId === where.memoryId).length),
    findMany: vi.fn(async () => []),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    create: vi.fn(async ({ data }: { data: Omit<Rev, "createdAt" | "id"> }) => {
      calls.push(`revision:${data.memoryId}`);
      const row = { ...data, createdAt: new Date(), id: `rev_${revisions.length + 1}` };
      revisions.push(row);
      return row;
    }),
  },
};
const dbStub = { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));

import { setMemoryCoordinatesAsAdmin } from "@/features/admin/set-coordinates";

function memoryRow(over: Partial<MemoryRow> = {}): MemoryRow {
  return { id: MEM, deletedAt: null, updatedAt: T0, latitude: null, longitude: null, consentVersion: "2026-11-v2", ...over };
}
const version = () => memories.find((m) => m.id === MEM)!.updatedAt.toISOString();

beforeEach(() => {
  memories = [memoryRow()];
  revisions = [];
  calls.length = 0;
  tx.memory.update.mockClear();
});

describe("setMemoryCoordinatesAsAdmin", () => {
  it("locks the memory row before re-reading it, then writes both columns and one ADMIN revision", async () => {
    const result = await setMemoryCoordinatesAsAdmin({ memoryId: MEM, memoryVersion: version(), coordinates: BROADMEAD });
    // The committed version comes back (review R3), so the next write does not have to re-read first.
    expect(result).toEqual({ ok: true, changed: true, memoryVersion: version() });
    expect(version()).not.toBe(T0.toISOString());
    expect(calls).toEqual([`lock:memory:${MEM}`, `read:${MEM}`, `update:${MEM}`, `revision:${MEM}`]);
    expect(tx.memory.update).toHaveBeenCalledWith({ where: { id: MEM }, data: { latitude: 39.4815, longitude: -76.6447 }, select: { updatedAt: true } });
    expect(memories[0]).toMatchObject({ latitude: 39.4815, longitude: -76.6447 });
    expect(revisions).toHaveLength(1);
    // The first revision of a memory also records the consent version in force (appendRevision).
    expect(revisions[0]).toMatchObject({ memoryId: MEM, changedVia: "ADMIN", before: { coordinates: null }, after: { coordinates: BROADMEAD, consentVersion: "2026-11-v2" } });
  });

  it("clears both columns with null and records the old pair in the revision's before", async () => {
    memories[0] = memoryRow({ latitude: 39.4815, longitude: -76.6447 });
    revisions.push({ memoryId: MEM, changedVia: "ADMIN", before: {}, after: { note: "x" }, createdAt: T0, id: "rev_0" });
    const result = await setMemoryCoordinatesAsAdmin({ memoryId: MEM, memoryVersion: version(), coordinates: null });
    expect(result).toEqual({ ok: true, changed: true, memoryVersion: version() });
    expect(tx.memory.update).toHaveBeenCalledWith({ where: { id: MEM }, data: { latitude: null, longitude: null }, select: { updatedAt: true } });
    expect(memories[0]).toMatchObject({ latitude: null, longitude: null });
    expect(revisions).toHaveLength(2);
    // Not the first revision: no consent version is added. toEqual pins the exact snapshot keys.
    expect(revisions[1]!.before).toEqual({ coordinates: BROADMEAD });
    expect(revisions[1]!.after).toEqual({ coordinates: null });
  });

  it("answers changed: false with the unchanged version and writes nothing when the pair is already equal, including null to null", async () => {
    expect(await setMemoryCoordinatesAsAdmin({ memoryId: MEM, memoryVersion: version(), coordinates: null })).toEqual({ ok: true, changed: false, memoryVersion: T0.toISOString() });
    memories[0] = memoryRow({ latitude: 39.4815, longitude: -76.6447 });
    expect(await setMemoryCoordinatesAsAdmin({ memoryId: MEM, memoryVersion: version(), coordinates: { ...BROADMEAD } })).toEqual({ ok: true, changed: false, memoryVersion: T0.toISOString() });
    expect(tx.memory.update).not.toHaveBeenCalled();
    expect(revisions).toHaveLength(0);
    expect(memories[0]!.updatedAt).toEqual(T0);
  });

  it("treats a pair that differs in one coordinate as a change", async () => {
    memories[0] = memoryRow({ latitude: 39.4815, longitude: -76.6447 });
    expect(await setMemoryCoordinatesAsAdmin({ memoryId: MEM, memoryVersion: version(), coordinates: { latitude: 39.4815, longitude: -76.6448 } })).toEqual({ ok: true, changed: true, memoryVersion: expect.any(String) });
    expect(revisions[0]).toMatchObject({ before: { coordinates: BROADMEAD }, after: { coordinates: { latitude: 39.4815, longitude: -76.6448 } } });
  });

  it("chains: the returned memoryVersion opens the next write without a stale (review R3)", async () => {
    const first = await setMemoryCoordinatesAsAdmin({ memoryId: MEM, memoryVersion: version(), coordinates: BROADMEAD });
    if (!first.ok) { throw new Error("setup"); }
    const second = await setMemoryCoordinatesAsAdmin({ memoryId: MEM, memoryVersion: first.memoryVersion, coordinates: null });
    expect(second).toEqual({ ok: true, changed: true, memoryVersion: version() });
    if (!second.ok) { throw new Error("setup"); }
    expect(second.memoryVersion).not.toBe(first.memoryVersion);
    // An unchanged answer hands back a version that still works.
    const third = await setMemoryCoordinatesAsAdmin({ memoryId: MEM, memoryVersion: second.memoryVersion, coordinates: null });
    expect(third).toEqual({ ok: true, changed: false, memoryVersion: second.memoryVersion });
  });

  it("answers stale with the current version and pair when memoryVersion is old, and writes nothing", async () => {
    const old = version();
    memories[0] = memoryRow({ updatedAt: T1, latitude: 40, longitude: -75 });
    const result = await setMemoryCoordinatesAsAdmin({ memoryId: MEM, memoryVersion: old, coordinates: BROADMEAD });
    expect(result).toEqual({ ok: false, code: "stale", current: { memoryVersion: T1.toISOString(), coordinates: { latitude: 40, longitude: -75 } } });
    expect(tx.memory.update).not.toHaveBeenCalled();
    expect(revisions).toHaveLength(0);
    // The version from `current` opens the next attempt.
    if (result.ok || result.code !== "stale") { throw new Error("setup"); }
    expect(await setMemoryCoordinatesAsAdmin({ memoryId: MEM, memoryVersion: result.current.memoryVersion, coordinates: BROADMEAD })).toEqual({ ok: true, changed: true, memoryVersion: version() });
  });

  it("reports a stale row without coordinates as coordinates: null", async () => {
    memories[0] = memoryRow({ updatedAt: T1 });
    expect(await setMemoryCoordinatesAsAdmin({ memoryId: MEM, memoryVersion: T0.toISOString(), coordinates: BROADMEAD })).toEqual({ ok: false, code: "stale", current: { memoryVersion: T1.toISOString(), coordinates: null } });
  });

  it("answers not_found for a missing or deleted memory without writing", async () => {
    expect(await setMemoryCoordinatesAsAdmin({ memoryId: MEM2, memoryVersion: version(), coordinates: BROADMEAD })).toEqual({ ok: false, code: "not_found" });
    memories[0]!.deletedAt = T1;
    expect(await setMemoryCoordinatesAsAdmin({ memoryId: MEM, memoryVersion: version(), coordinates: BROADMEAD })).toEqual({ ok: false, code: "not_found" });
    expect(tx.memory.update).not.toHaveBeenCalled();
    expect(revisions).toHaveLength(0);
  });

  it("answers invalid before touching the database for a bad id, a half pair, an out-of-range value or an omitted coordinates key", async () => {
    for (const raw of [
      { memoryId: "mem_1", memoryVersion: version(), coordinates: BROADMEAD },
      { memoryId: MEM, memoryVersion: version(), coordinates: { latitude: 39.4815 } },
      { memoryId: MEM, memoryVersion: version(), coordinates: { latitude: 91, longitude: 0 } },
      { memoryId: MEM, memoryVersion: version() },
      { memoryId: MEM, memoryVersion: "yesterday", coordinates: null },
      null,
    ]) {
      expect(await setMemoryCoordinatesAsAdmin(raw), JSON.stringify(raw)).toEqual({ ok: false, code: "invalid" });
    }
    expect(calls).toEqual([]);
  });
});
