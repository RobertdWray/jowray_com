import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { resetEnvCache } from "@/server/config/env";

interface MemoryRow { id: string; memorialId: string; contributorId: string; type: string; source: string; sourceRef: string | null; status: string; claimTokenHash: string; consentVersion: string; consentedAt: Date | null; contributorNote: string | null; visibility: string; notifyWhenPosted: boolean; createdAt: Date; deletedAt: Date | null }
interface Rev { memoryId: string; changedVia: string; before: Record<string, unknown>; after: Record<string, unknown> }
const memories: MemoryRow[] = [];
const contributors: Record<string, unknown>[] = [];
const revisions: Rev[] = [];
let memorial: { id: string; slug: string } | null = { id: "memorial_1", slug: "jo" };
let createThrows: unknown = null;

function findMemory(where: { sourceRef?: string; id?: string }): MemoryRow | null {
  return memories.find((m) => (where.sourceRef !== undefined ? m.sourceRef === where.sourceRef : m.id === where.id)) ?? null;
}
const lockCalls: string[] = [];
const tx = {
  // The budget helper takes the global advisory lock before counting (issue #44); the admin draft path is one of its callers.
  $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => { lockCalls.push(`${strings.join("?")}|${String(values[0])}`); return 1; }),
  memorial: { findUnique: vi.fn(async () => memorial) },
  memory: {
    count: vi.fn(async ({ where }: { where?: { createdAt?: { gt: Date } } } = {}) => memories.filter((m) => !where?.createdAt || m.createdAt > where.createdAt.gt).length),
    findUnique: vi.fn(async ({ where }: { where: { sourceRef?: string; id?: string } }) => findMemory(where)),
    create: vi.fn(async ({ data }: { data: Omit<MemoryRow, "id" | "createdAt" | "deletedAt"> }) => {
      if (createThrows) { throw createThrows; }
      const row: MemoryRow = { id: `mem_${memories.length + 1}`, createdAt: new Date(), deletedAt: null, ...data };
      memories.push(row);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string; deletedAt: null }; data: { claimTokenHash: string } }) => {
      const rows = memories.filter((m) => m.id === where.id && m.status === where.status && m.deletedAt === null);
      for (const r of rows) { r.claimTokenHash = data.claimTokenHash; }
      return { count: rows.length };
    }),
  },
  media: { aggregate: vi.fn(async () => ({ _sum: { maxBytes: null } })) },
  contributor: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `con_${contributors.length + 1}`, ...data }; contributors.push(row); return row; }) },
  memoryRevision: { create: vi.fn(async ({ data }: { data: Rev }) => { revisions.push(data); return { id: `rev_${revisions.length}`, ...data }; }) },
};
const dbStub = { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));

import { draftMemory, reissueDraftClaimLink } from "@/features/memories/draft-memory";

const valid = {
  contributor: { name: "Joyce Gilley", email: "joyce@example.com", relationship: "Friend from church" },
  note: "Jo always had a kind word for everyone.\n\nShe will be missed.",
  source: "EMAIL",
  sourceRef: "gmail:1a1a2317fba34eec",
};

beforeEach(() => {
  memories.length = 0; contributors.length = 0; revisions.length = 0;
  memorial = { id: "memorial_1", slug: "jo" };
  createThrows = null;
  process.env.UPLOAD_TICKET_SECRET = "s".repeat(32);
  process.env.DAILY_MEMORY_BUDGET = "3";
  process.env.MEMORIAL_SLUG = "jo";
  process.env.CONSENT_VERSION = "2026-11-v2";
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.jowray.com";
  resetEnvCache();
});

describe("draftMemory", () => {
  it("creates a Contributor and a DRAFT TEXT memory with no consent stamp, a hashed claim token and an ADMIN revision", async () => {
    const result = await draftMemory(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.claimLink).toBe(`https://www.jowray.com/m/${result.claimToken}`);
    const memory = memories[0]!;
    expect(result.memoryId).toBe(memory.id);
    expect(memory).toMatchObject({ type: "TEXT", status: "DRAFT", source: "EMAIL", sourceRef: "gmail:1a1a2317fba34eec", consentedAt: null, consentVersion: "2026-11-v2", visibility: "PUBLIC", notifyWhenPosted: true, contributorNote: valid.note });
    expect(memory.claimTokenHash).toBe(hashClaimToken(result.claimToken));
    // Preferences are the person's to give: nothing is opted in until they press Share (the page prefills both on).
    expect(contributors[0]).toMatchObject({ memorialId: "memorial_1", name: "Joyce Gilley", email: "joyce@example.com", relationship: "Friend from church", contactOptIn: false });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ memoryId: memory.id, changedVia: "ADMIN", before: {} });
    expect(revisions[0]!.after).toMatchObject({ note: valid.note, name: "Joyce Gilley", relationship: "Friend from church", source: "EMAIL", sourceRef: "gmail:1a1a2317fba34eec", approxDateText: null, place: null, visibility: "PUBLIC", status: "DRAFT" });
  });

  it("rejects a missing email, an empty note and a bad sourceRef without writing", async () => {
    expect(await draftMemory({ ...valid, contributor: { name: "Joyce" } })).toMatchObject({ ok: false, code: "invalid" });
    expect(await draftMemory({ ...valid, note: "  " })).toMatchObject({ ok: false, code: "invalid" });
    expect(await draftMemory({ ...valid, sourceRef: "gmail:thread-f:1" })).toMatchObject({ ok: false, code: "invalid" });
    expect(memories).toHaveLength(0);
    expect(contributors).toHaveLength(0);
  });

  it("answers duplicate with the existing id and status before creating anything (no orphan Contributor)", async () => {
    const first = await draftMemory(valid);
    if (!first.ok) { throw new Error("setup"); }
    memories[0]!.status = "PENDING";
    const again = await draftMemory({ ...valid, note: "a different cut of the same message" });
    expect(again).toEqual({ ok: false, code: "duplicate", memoryId: first.memoryId, status: "PENDING" });
    expect(contributors).toHaveLength(1);
    expect(revisions).toHaveLength(1);
  });

  it("treats a unique-constraint race (P2002, no meta.target) as duplicate by re-reading outside the transaction", async () => {
    memories.push({ id: "mem_race", memorialId: "memorial_1", contributorId: "con_x", type: "TEXT", source: "EMAIL", sourceRef: valid.sourceRef, status: "DRAFT", claimTokenHash: "h", consentVersion: "2026-11-v2", consentedAt: null, contributorNote: "x", visibility: "PUBLIC", notifyWhenPosted: true, createdAt: new Date(), deletedAt: null });
    // The pre-check misses the row (as if another request committed between the check and the insert) and the insert collides.
    tx.memory.findUnique.mockImplementationOnce(async () => null);
    createThrows = Object.assign(new Error("Unique constraint failed on the fields: (`sourceRef`)"), { code: "P2002", meta: { driverAdapterError: {} } });
    const result = await draftMemory(valid);
    expect(result).toEqual({ ok: false, code: "duplicate", memoryId: "mem_race", status: "DRAFT" });
  });

  it("rethrows a P2002 that is not about sourceRef (no matching row afterwards)", async () => {
    createThrows = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    await expect(draftMemory(valid)).rejects.toThrow("Unique constraint failed");
  });

  it("refuses when the daily memory budget is spent", async () => {
    for (let i = 0; i < 3; i += 1) {
      memories.push({ id: `old_${i}`, memorialId: "memorial_1", contributorId: "c", type: "TEXT", source: "WEB_UPLOAD", sourceRef: null, status: "PENDING", claimTokenHash: `h${i}`, consentVersion: "v", consentedAt: new Date(), contributorNote: "x", visibility: "PUBLIC", notifyWhenPosted: true, createdAt: new Date(), deletedAt: null });
    }
    expect(await draftMemory(valid)).toEqual({ ok: false, code: "budget_exceeded" });
    expect(contributors).toHaveLength(0);
  });
});

describe("reissueDraftClaimLink", () => {
  async function seedDraft(): Promise<{ memoryId: string; claimToken: string }> {
    const result = await draftMemory(valid);
    if (!result.ok) { throw new Error("setup"); }
    memories[0]!.id = "00000000-0000-4000-8000-000000000001";
    revisions.length = 0;
    return { memoryId: memories[0]!.id, claimToken: result.claimToken };
  }

  it("rotates the token of a DRAFT (the old link stops working) and records an ADMIN revision", async () => {
    const { memoryId, claimToken } = await seedDraft();
    const result = await reissueDraftClaimLink({ memoryId });
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.claimLink).toMatch(/^https:\/\/www\.jowray\.com\/m\/[A-Za-z0-9_-]{43}$/);
    const newToken = result.claimLink.split("/m/")[1]!;
    expect(newToken).not.toBe(claimToken);
    expect(memories[0]!.claimTokenHash).toBe(hashClaimToken(newToken));
    expect(revisions).toEqual([expect.objectContaining({ memoryId, changedVia: "ADMIN", before: {}, after: { claimLinkReissued: true } })]);
  });

  it("answers not_draft for a memory the person already shared, and leaves its token alone", async () => {
    const { memoryId } = await seedDraft();
    memories[0]!.status = "PENDING";
    const hashBefore = memories[0]!.claimTokenHash;
    expect(await reissueDraftClaimLink({ memoryId })).toEqual({ ok: false, code: "not_draft" });
    expect(memories[0]!.claimTokenHash).toBe(hashBefore);
    expect(revisions).toHaveLength(0);
  });

  it("answers not_found for a missing or deleted memory and invalid for a malformed id", async () => {
    expect(await reissueDraftClaimLink({ memoryId: "00000000-0000-4000-8000-00000000000f" })).toEqual({ ok: false, code: "not_found" });
    const { memoryId } = await seedDraft();
    memories[0]!.deletedAt = new Date();
    expect(await reissueDraftClaimLink({ memoryId })).toEqual({ ok: false, code: "not_found" });
    expect(await reissueDraftClaimLink({ memoryId: "mem_1" })).toEqual({ ok: false, code: "invalid" });
  });

  it("re-reads when the conditional update touches no row (a concurrent Share won the race) and answers not_draft", async () => {
    const { memoryId } = await seedDraft();
    tx.memory.updateMany.mockImplementationOnce(async () => { memories[0]!.status = "PENDING"; return { count: 0 }; });
    expect(await reissueDraftClaimLink({ memoryId })).toEqual({ ok: false, code: "not_draft" });
    expect(revisions).toHaveLength(0);
  });
});
