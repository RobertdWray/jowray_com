import { beforeEach, describe, expect, it, vi } from "vitest";

import { appendClaimRevision, appendRevision, MAX_REVISIONS_PER_MEMORY, snapshotsEqual } from "@/features/memories/media-state";

interface Rev { id: string; memoryId: string; changedVia: string; before: Record<string, unknown>; after: Record<string, unknown>; createdAt: Date }
const revisions: Rev[] = [];
let nextId = 0;
const tx = {
  memoryRevision: {
    count: vi.fn(async () => revisions.length),
    create: vi.fn(async ({ data }: { data: Omit<Rev, "id" | "createdAt"> }) => { const row = { id: `rev_${String(++nextId).padStart(4, "0")}`, createdAt: new Date(nextId), ...data }; revisions.push(row); return row; }),
    findMany: vi.fn(async ({ skip, take }: { skip: number; take: number }) => [...revisions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)).slice(skip, skip + take).map((r) => ({ id: r.id }))),
    deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => { const before = revisions.length; for (let i = revisions.length - 1; i >= 0; i -= 1) { if (where.id.in.includes(revisions[i]!.id)) { revisions.splice(i, 1); } } return { count: before - revisions.length }; }),
  },
} as unknown as Parameters<typeof appendRevision>[0];

beforeEach(() => { revisions.length = 0; nextId = 0; });

describe("appendRevision", () => {
  it("writes the revision with the given changedVia and records the consent version on a memory's first revision only", async () => {
    await appendRevision(tx, { memoryId: "mem_1", changedVia: "ADMIN", before: { status: "PENDING" }, after: { status: "APPROVED" }, consentVersion: "2026-11-v2" });
    await appendRevision(tx, { memoryId: "mem_1", changedVia: "ADMIN", before: { place: null }, after: { place: "Baltimore" }, consentVersion: "2026-11-v2" });
    expect(revisions[0]).toMatchObject({ memoryId: "mem_1", changedVia: "ADMIN", before: { status: "PENDING" }, after: { status: "APPROVED", consentVersion: "2026-11-v2" } });
    expect(revisions[1]).toMatchObject({ memoryId: "mem_1", changedVia: "ADMIN", before: { place: null }, after: { place: "Baltimore" } });
  });

  it("appendClaimRevision is the CLAIM_LINK wrapper", async () => {
    await appendClaimRevision(tx, { memoryId: "mem_1", before: {}, after: { note: "x" }, consentVersion: "v" });
    expect(revisions[0]).toMatchObject({ changedVia: "CLAIM_LINK", after: { note: "x", consentVersion: "v" } });
  });

  it("keeps at most MAX_REVISIONS_PER_MEMORY per memory: the first (consent record) and the latest, dropping the oldest of the rest (issue #44)", async () => {
    for (let i = 0; i < MAX_REVISIONS_PER_MEMORY; i += 1) {
      await appendRevision(tx, { memoryId: "mem_1", changedVia: "CLAIM_LINK", before: { n: i }, after: { n: i + 1 }, consentVersion: "v" });
    }
    expect(revisions).toHaveLength(MAX_REVISIONS_PER_MEMORY);
    expect(tx.memoryRevision.deleteMany).not.toHaveBeenCalled();
    await appendRevision(tx, { memoryId: "mem_1", changedVia: "CLAIM_LINK", before: { n: "x" }, after: { n: "y" }, consentVersion: "v" });
    await appendRevision(tx, { memoryId: "mem_1", changedVia: "CLAIM_LINK", before: { n: "y" }, after: { n: "z" }, consentVersion: "v" });
    expect(revisions).toHaveLength(MAX_REVISIONS_PER_MEMORY);
    // The first revision survives with its consent record; rev 2 and rev 3 (the oldest after it) are gone; the newest are present.
    expect(revisions[0]).toMatchObject({ id: "rev_0001", after: { n: 1, consentVersion: "v" } });
    expect(revisions.map((r) => r.id)).not.toContain("rev_0002");
    expect(revisions.map((r) => r.id)).not.toContain("rev_0003");
    expect(revisions.at(-1)).toMatchObject({ after: { n: "z" } });
    expect(tx.memoryRevision.deleteMany).toHaveBeenCalledTimes(2);
  });
});

describe("snapshotsEqual", () => {
  it("compares keys and values, Dates by instant and id lists element by element", () => {
    const when = new Date(1_700_000_000_000);
    expect(snapshotsEqual({ a: 1, b: null, when, ids: ["x", "y"] }, { a: 1, b: null, when: new Date(when.getTime()), ids: ["x", "y"] })).toBe(true);
    expect(snapshotsEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(snapshotsEqual({ a: 1 }, { a: 1, extra: "x" })).toBe(false);
    expect(snapshotsEqual({ ids: ["x", "y"] }, { ids: ["y", "x"] })).toBe(false);
    expect(snapshotsEqual({ when }, { when: new Date(when.getTime() + 1) })).toBe(false);
    expect(snapshotsEqual({ note: null }, { note: undefined })).toBe(false);
  });
});
