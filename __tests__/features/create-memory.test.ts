import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { verifyUploadTicket } from "@/lib/upload-ticket";
import { resetEnvCache } from "@/server/config/env";

interface MemoryRow { id: string; memorialId: string; contributorId: string; type: string; source: string; status: string; claimTokenHash: string; consentVersion: string; consentedAt: Date; createdAt: Date; deletedAt: Date | null; approxDateText: string | null; contributorNote: string | null; visibility: string; notifyWhenPosted: boolean; submissionId?: string | null; submissionIndex?: number | null; uploadLeaseUntil?: Date | null }
interface MediaRow { id: string; memoryId: string; storageKey: string; mimeType: string; maxBytes: number; status: string; createdAt: Date; originalFilename: string | null; durationSeconds?: number | null; deletedAt: Date | null; sortOrder: number; replacesMediaId: string | null; caption?: string | null; approxDateText?: string | null; place?: string | null }
const lockCalls: string[] = [];
function matchesMedia(row: MediaRow, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "status" && typeof v === "object" && v !== null && "in" in v) { if (!(v as { in: string[] }).in.includes(row.status)) { return false; } continue; }
    if (k === "createdAt") { continue; }
    if ((row as unknown as Record<string, unknown>)[k] !== v) { return false; }
  }
  return true;
}
const memories: MemoryRow[] = [];
const medias: MediaRow[] = [];
const contributors: Record<string, unknown>[] = [];
let memorial: { id: string; slug: string } | null = { id: "memorial_1", slug: "jo" };
const tx = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => { lockCalls.push(`${strings.join("?")}|${String(values[0])}`); return [{ id: values[0] }]; }),
  memorial: { findUnique: vi.fn(async () => memorial) },
  memory: {
    updateMany: vi.fn(async ({ where, data }: { where: { submissionId: string; submissionIndex: number }; data: { uploadLeaseUntil: Date } }) => {
      lockCalls.push(`lease|${where.submissionId}/${where.submissionIndex}`);
      const rows = memories.filter((m) => m.submissionId === where.submissionId && m.submissionIndex === where.submissionIndex);
      for (const r of rows) { r.uploadLeaseUntil = data.uploadLeaseUntil; }
      return { count: rows.length };
    }),
    count: vi.fn(async ({ where }: { where?: { createdAt?: { gt: Date } } } = {}) => memories.filter((m) => !where?.createdAt || m.createdAt > where.createdAt.gt).length),
    create: vi.fn(async ({ data }: { data: Omit<MemoryRow, "id" | "createdAt" | "deletedAt"> }) => { const row: MemoryRow = { id: `mem_${memories.length + 1}`, createdAt: new Date(), deletedAt: null, submissionId: null, submissionIndex: null, uploadLeaseUntil: null, ...data }; memories.push(row); return row; }),
    findUnique: vi.fn(async ({ where }: { where: { claimTokenHash: string } }) => memories.find((m) => m.claimTokenHash === where.claimTokenHash) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MemoryRow> }) => { const m = memories.find((x) => x.id === where.id)!; Object.assign(m, data); return m; }),
  },
  media: {
    aggregate: vi.fn(async ({ where }: { where?: { createdAt?: { gt: Date } } } = {}) => ({ _sum: { maxBytes: medias.filter((m) => !where?.createdAt || m.createdAt > where.createdAt.gt).reduce((s, m) => s + m.maxBytes, 0) || null } })),
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => medias.filter((m) => matchesMedia(m, where)).length),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => medias.find((m) => matchesMedia(m, where)) ?? null),
    create: vi.fn(async ({ data }: { data: Omit<MediaRow, "id" | "createdAt" | "deletedAt"> }) => { const row: MediaRow = { deletedAt: null, ...data, id: `med_${medias.length + 1}`, createdAt: new Date() }; medias.push(row); return row; }),
  },
  contributor: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `con_${contributors.length + 1}`, ...data }; contributors.push(row); return row; }) },
};
const dbStub = { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));

const confirmMock = vi.fn(async (_arg: unknown) => ({ sent: true, messageId: "m1" }));
vi.mock("@/features/memories/confirm", () => ({ confirmMemory: (arg: unknown) => confirmMock(arg) }));
const notifyMock = vi.fn(async (_arg: unknown) => ({ sent: true, messageId: "m2" }));
vi.mock("@/features/memories/notify-admins", () => ({ notifyAdminsOfMemory: (arg: unknown) => notifyMock(arg) }));
const afterCalls: Array<() => Promise<void>> = [];
vi.mock("@/lib/sentry/after-flush", () => ({ afterWithFlush: (cb: () => Promise<void>) => { afterCalls.push(cb); } }));

import { createReplacementTicket, createUploadTicket } from "@/features/memories/create-memory";

/** Seeds one legacy text memory the way the old one-memory form did, and returns its raw claim token. */
async function seedMemory(): Promise<{ ok: true; claimToken: string; memoryId: string }> {
  const claimToken = "t".repeat(43);
  const contributor = await tx.contributor.create({ data: { memorialId: "memorial_1", name: "Jo Friend", email: "jo@example.com", relationship: "neighbour", contactOptIn: false, mailingListOptIn: true } });
  const row = await tx.memory.create({ data: { memorialId: "memorial_1", contributorId: contributor.id as string, type: "TEXT", source: "WEB_UPLOAD", status: "PENDING", claimTokenHash: hashClaimToken(claimToken), consentVersion: "2026-11-v1", consentedAt: new Date(), approxDateText: "Summer 1998", contributorNote: "We laughed a lot.", visibility: "FAMILY", notifyWhenPosted: false } });
  return { ok: true, claimToken, memoryId: row.id };
}

beforeEach(() => {
  afterCalls.length = 0;
  notifyMock.mockClear();
  memories.length = 0; medias.length = 0; contributors.length = 0; lockCalls.length = 0; memorial = { id: "memorial_1", slug: "jo" };
  process.env.UPLOAD_TICKET_SECRET = "s".repeat(32);
  process.env.DAILY_MEMORY_BUDGET = "3";
  process.env.DAILY_BYTE_BUDGET = String(600 * 1024 * 1024);
  process.env.MEMORIAL_SLUG = "jo";
  process.env.CONSENT_VERSION = "2026-11-v1";
  resetEnvCache();
});

describe("createUploadTicket", () => {
  it("mints a ticket for an existing memory and caps at 10 media rows", async () => {
    const created = await seedMemory();
    if (!created.ok) { throw new Error("setup"); }
    process.env.DAILY_BYTE_BUDGET = String(100 * 1024 ** 3); resetEnvCache();
    for (let i = 0; i < 10; i += 1) {
      const t = await createUploadTicket({ claimToken: created.claimToken, file: { name: `p${i}.jpg`, type: "image/jpeg", size: 1 } });
      expect(t.ok).toBe(true);
    }
    expect(await createUploadTicket({ claimToken: created.claimToken, file: { name: "p.jpg", type: "image/jpeg", size: 1 } })).toEqual({ ok: false, code: "too_many_files" });
    expect(await createUploadTicket({ claimToken: "w".repeat(43), file: { name: "p.jpg", type: "image/jpeg", size: 1 } })).toEqual({ ok: false, code: "not_found" });
  });
});

describe("createUploadTicket cap counts live rows only", () => {
  it("frees a slot when a file is removed and ignores removed rows, under the memory lock", async () => {
    const created = await seedMemory();
    if (!created.ok) { throw new Error("setup"); }
    process.env.DAILY_BYTE_BUDGET = String(100 * 1024 ** 3); resetEnvCache();
    for (let i = 0; i < 10; i += 1) {
      expect((await createUploadTicket({ claimToken: created.claimToken, file: { name: `p${i}.jpg`, type: "image/jpeg", size: 1 } })).ok).toBe(true);
    }
    expect(lockCalls.at(-1)).toContain("FOR UPDATE|mem_1");
    expect(await createUploadTicket({ claimToken: created.claimToken, file: { name: "p.jpg", type: "image/jpeg", size: 1 } })).toEqual({ ok: false, code: "too_many_files" });
    expect(memories[0]!.uploadLeaseUntil ?? null).toBeNull();
    medias[3]!.deletedAt = new Date();
    expect((await createUploadTicket({ claimToken: created.claimToken, file: { name: "again.jpg", type: "image/jpeg", size: 1 } })).ok).toBe(true);
    expect(medias.at(-1)!.sortOrder).toBe(10);
  });
});

describe("createReplacementTicket", () => {
  async function seeded() {
    const created = await seedMemory();
    medias.push({ id: "med_1", memoryId: created.memoryId, storageKey: "k", mimeType: "image/jpeg", maxBytes: 1, status: "PENDING", createdAt: new Date(), originalFilename: "a.jpg", deletedAt: null, sortOrder: 0, replacesMediaId: null, caption: "first", approxDateText: "1998", place: "the lake" });
    if (!created.ok) { throw new Error("setup"); }
    memories[0]!.uploadLeaseUntil = null; // the submission was completed
    medias[0]!.status = "READY";
    medias[0]!.sortOrder = 4;
    medias[0]!.id = "00000000-0000-4000-8000-000000000001";
    return created.claimToken;
  }

  it("mints a ticket for a PENDING row that points at its target and copies the target's sort order", async () => {
    const claimToken = await seeded();
    const result = await createReplacementTicket({ claimToken, mediaId: "00000000-0000-4000-8000-000000000001", file: { name: "b.heic", type: "image/heic", size: 5 } });
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(lockCalls.at(-1)).toContain("FOR UPDATE|mem_1");
    expect(medias[1]).toMatchObject({ status: "PENDING", replacesMediaId: "00000000-0000-4000-8000-000000000001", sortOrder: 4, mimeType: "image/heic", caption: "first", approxDateText: "1998", place: "the lake" });
    // Claim-page tickets do not reopen the submission lease: the memory's one email was already handled.
    expect(memories[0]!.uploadLeaseUntil ?? null).toBeNull();
    expect(verifyUploadTicket(result.upload.ticket).ok).toBe(true);
  });

  it("allows one pending replacement per target and only one", async () => {
    const claimToken = await seeded();
    const req = { claimToken, mediaId: "00000000-0000-4000-8000-000000000001", file: { name: "b.jpg", type: "image/jpeg", size: 5 } };
    expect((await createReplacementTicket(req)).ok).toBe(true);
    expect(await createReplacementTicket(req)).toEqual({ ok: false, code: "replacement_pending" });
  });

  it("may exceed the file cap by exactly one (net zero once the swap lands)", async () => {
    const claimToken = await seeded();
    process.env.DAILY_BYTE_BUDGET = String(100 * 1024 ** 3); resetEnvCache();
    for (let i = 0; i < 9; i += 1) {
      expect((await createUploadTicket({ claimToken, file: { name: `p${i}.jpg`, type: "image/jpeg", size: 1 } })).ok).toBe(true);
    }
    expect(await createUploadTicket({ claimToken, file: { name: "p.jpg", type: "image/jpeg", size: 1 } })).toEqual({ ok: false, code: "too_many_files" });
    expect((await createReplacementTicket({ claimToken, mediaId: "00000000-0000-4000-8000-000000000001", file: { name: "b.jpg", type: "image/jpeg", size: 1 } })).ok).toBe(true);
  });

  it("refuses a removed or unknown target, a wrong token and invalid input", async () => {
    const claimToken = await seeded();
    const file = { name: "b.jpg", type: "image/jpeg", size: 1 };
    expect(await createReplacementTicket({ claimToken, mediaId: "00000000-0000-4000-8000-00000000000f", file })).toEqual({ ok: false, code: "not_found" });
    medias[0]!.deletedAt = new Date();
    expect(await createReplacementTicket({ claimToken, mediaId: "00000000-0000-4000-8000-000000000001", file })).toEqual({ ok: false, code: "not_found" });
    expect(await createReplacementTicket({ claimToken: "w".repeat(43), mediaId: "00000000-0000-4000-8000-000000000001", file })).toEqual({ ok: false, code: "not_found" });
    expect(await createReplacementTicket({ claimToken, mediaId: "nope", file })).toEqual({ ok: false, code: "invalid" });
    expect(medias).toHaveLength(1);
  });
});

describe("claim-page tickets on a memory that belongs to a send (Task 15)", () => {
  const SECOND = "b".repeat(43);
  function seedSend(): void {
    const base = { memorialId: "memorial_1", contributorId: "con_1", type: "TEXT", source: "WEB_UPLOAD", status: "PENDING", consentVersion: "v", consentedAt: new Date(), createdAt: new Date(), deletedAt: null, approxDateText: null, contributorNote: "words", visibility: "PUBLIC", notifyWhenPosted: true };
    memories.push({ ...base, id: "mem_1", claimTokenHash: hashClaimToken("a".repeat(43)), submissionId: "sub_1", submissionIndex: 0, uploadLeaseUntil: null });
    memories.push({ ...base, id: "mem_2", claimTokenHash: hashClaimToken(SECOND), submissionId: "sub_1", submissionIndex: 1, uploadLeaseUntil: null });
  }

  it("createUploadTicket renews the anchor's lease before taking the memory lock", async () => {
    seedSend();
    const result = await createUploadTicket({ claimToken: SECOND, file: { name: "p.jpg", type: "image/jpeg", size: 1 } });
    expect(result.ok).toBe(true);
    expect(lockCalls).toEqual(["lease|sub_1/0", expect.stringContaining("FOR UPDATE|mem_2")]);
    expect(memories[0]!.uploadLeaseUntil).toBeInstanceOf(Date);
    expect(memories[1]!.uploadLeaseUntil).toBeNull();
  });

  it("createReplacementTicket renews the anchor's lease before taking the memory lock", async () => {
    seedSend();
    const target = "00000000-0000-4000-8000-0000000000aa";
    medias.push({ id: target, memoryId: "mem_2", storageKey: "k", mimeType: "image/jpeg", maxBytes: 1, status: "READY", createdAt: new Date(), originalFilename: null, deletedAt: null, sortOrder: 0, replacesMediaId: null });
    const result = await createReplacementTicket({ claimToken: SECOND, mediaId: target, file: { name: "p.jpg", type: "image/jpeg", size: 1 } });
    expect(result).toMatchObject({ ok: true });
    expect(lockCalls).toEqual(["lease|sub_1/0", expect.stringContaining("FOR UPDATE|mem_2")]);
    expect(memories[0]!.uploadLeaseUntil).toBeInstanceOf(Date);
  });

  it("a legacy memory has no lease: the claim paths only take the lock", async () => {
    const created = await seedMemory();
    if (!created.ok) { throw new Error("setup"); }
    lockCalls.length = 0;
    await createUploadTicket({ claimToken: created.claimToken, file: { name: "p.jpg", type: "image/jpeg", size: 1 } });
    expect(lockCalls).toEqual([expect.stringContaining("FOR UPDATE|mem_1")]);
    expect(memories[0]!.uploadLeaseUntil ?? null).toBeNull();
  });
});
