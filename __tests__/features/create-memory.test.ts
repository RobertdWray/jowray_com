import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { BLOB_TOKEN_LIFETIME_MS, UPLOAD_WINDOW_MS, verifyUploadTicket } from "@/lib/upload-ticket";
import { resetEnvCache } from "@/server/config/env";

import { budgetStats, isBudgetStatsQuery } from "../helpers/budget-stats";

interface MemoryRow { id: string; memorialId: string; contributorId: string; type: string; source: string; status: string; claimTokenHash: string; consentVersion: string; consentedAt: Date; createdAt: Date; deletedAt: Date | null; approxDateText: string | null; contributorNote: string | null; visibility: string; notifyWhenPosted: boolean; submissionId?: string | null; submissionIndex?: number | null; uploadLeaseUntil?: Date | null }
interface MediaRow { id: string; memoryId: string; storageKey: string; mimeType: string; maxBytes: number; status: string; createdAt: Date; originalFilename: string | null; durationSeconds?: number | null; deletedAt: Date | null; sortOrder: number; replacesMediaId: string | null; caption?: string | null; approxDateText?: string | null; place?: string | null; reservedUntil?: Date | null; sizeBytes?: number | null }
interface DerivedRow { mediaId: string; status: string; sizeBytes: number | null }
const lockCalls: string[] = [];
/** Every statement in issue order, so a test can prove the budget lock precedes the budget reads. */
const order: string[] = [];
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
const derived: DerivedRow[] = [];
const contributors: Record<string, unknown>[] = [];
let memorial: { id: string; slug: string } | null = { id: "memorial_1", slug: "jo" };
/** Both raw channels record the same way: row locks go through $queryRaw, the void-returning advisory lock through $executeRaw. */
function recordLock(strings: TemplateStringsArray, values: unknown[]): void {
  const sql = strings.join("?");
  if (sql.startsWith("SET LOCAL lock_timeout")) {
    order.push("set:lock_timeout");
    return;
  }
  lockCalls.push(`${sql}|${String(values[0])}`);
  order.push(sql.includes("pg_advisory_xact_lock") ? "lock:budget" : `lock:memory:${String(values[0])}`);
}
/** The budget's one statement is answered from the tables; everything else through $queryRaw is a row lock. */
function queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> {
  if (isBudgetStatsQuery(strings)) {
    order.push("budget.read");
    return Promise.resolve([budgetStats({ memories, media: medias, derived })]);
  }
  recordLock(strings, values);
  return Promise.resolve([{ id: values[0] }]);
}
const tx = {
  $queryRaw: vi.fn(queryRaw),
  $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => { recordLock(strings, values); return 1; }),
  memorial: { findUnique: vi.fn(async () => memorial) },
  memory: {
    updateMany: vi.fn(async ({ where, data }: { where: { submissionId: string; submissionIndex: number }; data: { uploadLeaseUntil: Date } }) => {
      lockCalls.push(`lease|${where.submissionId}/${where.submissionIndex}`);
      const rows = memories.filter((m) => m.submissionId === where.submissionId && m.submissionIndex === where.submissionIndex);
      for (const r of rows) { r.uploadLeaseUntil = data.uploadLeaseUntil; }
      return { count: rows.length };
    }),
    count: vi.fn(async ({ where }: { where?: { createdAt?: { gt: Date } } } = {}) => { order.push("memory.count"); return memories.filter((m) => !where?.createdAt || m.createdAt > where.createdAt.gt).length; }),
    create: vi.fn(async ({ data }: { data: Omit<MemoryRow, "id" | "createdAt" | "deletedAt"> }) => { const row: MemoryRow = { id: `mem_${memories.length + 1}`, createdAt: new Date(), deletedAt: null, submissionId: null, submissionIndex: null, uploadLeaseUntil: null, ...data }; memories.push(row); return row; }),
    findUnique: vi.fn(async ({ where }: { where: { claimTokenHash: string } }) => memories.find((m) => m.claimTokenHash === where.claimTokenHash) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MemoryRow> }) => { const m = memories.find((x) => x.id === where.id)!; Object.assign(m, data); return m; }),
  },
  media: {
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
vi.mock("@/lib/sentry/after-flush", () => ({ afterWithFlush: (_name: string, cb: () => Promise<void>) => { afterCalls.push(cb); } }));
const identifyMock = vi.fn();
const tagIdsMock = vi.fn();
vi.mock("@/lib/sentry/user", () => ({ identifyContributor: (...a: unknown[]) => identifyMock(...a), tagIds: (...a: unknown[]) => tagIdsMock(...a) }));

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
  memories.length = 0; medias.length = 0; derived.length = 0; contributors.length = 0; lockCalls.length = 0; order.length = 0; memorial = { id: "memorial_1", slug: "jo" };
  process.env.UPLOAD_TICKET_SECRET = "s".repeat(32);
  process.env.DAILY_MEMORY_BUDGET = "3";
  process.env.DAILY_BYTE_BUDGET = String(600 * 1024 * 1024);
  delete process.env.TOTAL_BYTE_CEILING;
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
    expect(lockCalls.at(-2)).toContain("FOR UPDATE|mem_1");
    expect(lockCalls.at(-1)).toContain("pg_advisory_xact_lock");
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
    expect(lockCalls.at(-2)).toContain("FOR UPDATE|mem_1");
    expect(lockCalls.at(-1)).toContain("pg_advisory_xact_lock");
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
    expect(lockCalls).toEqual(["lease|sub_1/0", expect.stringContaining("FOR UPDATE|mem_2"), expect.stringContaining("pg_advisory_xact_lock")]);
    expect(memories[0]!.uploadLeaseUntil).toBeInstanceOf(Date);
    expect(memories[1]!.uploadLeaseUntil).toBeNull();
  });

  it("createReplacementTicket renews the anchor's lease before taking the memory lock", async () => {
    seedSend();
    const target = "00000000-0000-4000-8000-0000000000aa";
    medias.push({ id: target, memoryId: "mem_2", storageKey: "k", mimeType: "image/jpeg", maxBytes: 1, status: "READY", createdAt: new Date(), originalFilename: null, deletedAt: null, sortOrder: 0, replacesMediaId: null });
    const result = await createReplacementTicket({ claimToken: SECOND, mediaId: target, file: { name: "p.jpg", type: "image/jpeg", size: 1 } });
    expect(result).toMatchObject({ ok: true });
    expect(lockCalls).toEqual(["lease|sub_1/0", expect.stringContaining("FOR UPDATE|mem_2"), expect.stringContaining("pg_advisory_xact_lock")]);
    expect(memories[0]!.uploadLeaseUntil).toBeInstanceOf(Date);
  });

  it("a legacy memory has no lease: the claim paths only take the lock", async () => {
    const created = await seedMemory();
    if (!created.ok) { throw new Error("setup"); }
    lockCalls.length = 0;
    await createUploadTicket({ claimToken: created.claimToken, file: { name: "p.jpg", type: "image/jpeg", size: 1 } });
    expect(lockCalls).toEqual([expect.stringContaining("FOR UPDATE|mem_1"), expect.stringContaining("pg_advisory_xact_lock")]);
    expect(memories[0]!.uploadLeaseUntil ?? null).toBeNull();
  });
});

describe("daily byte budget and total ceiling (issue #44)", () => {
  const MB = 1024 * 1024;
  const PHOTO_MAX = 25 * MB;
  const jpeg = (name: string) => ({ name, type: "image/jpeg", size: 1 });
  /** A row created `ageMs` ago; the budget sees it through `status`, `deletedAt` and `reservedUntil`. */
  function row(overrides: Partial<MediaRow> & { id: string; status: string }, ageMs = 60_000): MediaRow {
    return { memoryId: "mem_x", storageKey: `k_${overrides.id}`, mimeType: "video/mp4", maxBytes: 500 * MB, createdAt: new Date(Date.now() - ageMs), originalFilename: null, deletedAt: null, sortOrder: 0, replacesMediaId: null, reservedUntil: null, sizeBytes: null, ...overrides };
  }

  it("takes the budget lock after the memory lock and before the one budget read; the lock is the transaction's last lock", async () => {
    const { claimToken } = await seedMemory();
    order.length = 0;
    expect((await createUploadTicket({ claimToken, file: jpeg("a.jpg") })).ok).toBe(true);
    expect(order.indexOf("lock:memory:mem_1")).toBeLessThan(order.indexOf("set:lock_timeout"));
    expect(order.indexOf("set:lock_timeout")).toBeLessThan(order.indexOf("lock:budget"));
    expect(order.indexOf("lock:budget")).toBeLessThan(order.indexOf("budget.read"));
    // One statement, one snapshot (TCR #10): never a second budget read in the same transaction.
    expect(order.filter((o) => o === "budget.read")).toHaveLength(1);
    expect(order.filter((o) => o.startsWith("lock:")).at(-1)).toBe("lock:budget");
  });

  it("answers budget_exceeded, not a 500, when the budget lock wait runs out (TCR #4)", async () => {
    const { claimToken } = await seedMemory();
    const timeout = Object.assign(new Error("Raw query failed. Code: `55P03`. Message: `canceling statement due to lock timeout`"), { code: "P2010", meta: { driverAdapterError: { cause: { code: "55P03" } } } });
    tx.$executeRaw.mockImplementationOnce(async () => 1).mockImplementationOnce(async () => { throw timeout; }); // SET LOCAL succeeds, the lock wait times out
    expect(await createUploadTicket({ claimToken, file: jpeg("a.jpg") })).toEqual({ ok: false, code: "budget_exceeded" });
    expect(medias).toHaveLength(0);
    medias.push({ id: "00000000-0000-4000-8000-000000000001", memoryId: "mem_1", storageKey: "k", mimeType: "image/jpeg", maxBytes: 1, status: "READY", createdAt: new Date(), originalFilename: "a.jpg", deletedAt: null, sortOrder: 0, replacesMediaId: null, sizeBytes: 1 });
    tx.$executeRaw.mockImplementationOnce(async () => 1).mockImplementationOnce(async () => { throw timeout; }); // SET LOCAL succeeds, the lock wait times out
    expect(await createReplacementTicket({ claimToken, mediaId: "00000000-0000-4000-8000-000000000001", file: { name: "b.jpg", type: "image/jpeg", size: 5 } })).toEqual({ ok: false, code: "budget_exceeded" });
    expect(medias).toHaveLength(1);
  });

  it("fits exactly at the boundary and refuses one byte past it", async () => {
    const { claimToken } = await seedMemory();
    process.env.DAILY_BYTE_BUDGET = String(2 * PHOTO_MAX); resetEnvCache();
    medias.push(row({ id: "ready", status: "READY", maxBytes: PHOTO_MAX, sizeBytes: 3 * MB }));
    expect((await createUploadTicket({ claimToken, file: jpeg("fits.jpg") })).ok).toBe(true);
    expect(await createUploadTicket({ claimToken, file: jpeg("over.jpg") })).toEqual({ ok: false, code: "budget_exceeded" });
    process.env.DAILY_BYTE_BUDGET = String(3 * PHOTO_MAX - 1); resetEnvCache();
    expect(await createUploadTicket({ claimToken, file: jpeg("still-over.jpg") })).toEqual({ ok: false, code: "budget_exceeded" });
    process.env.DAILY_BYTE_BUDGET = String(3 * PHOTO_MAX); resetEnvCache();
    expect((await createUploadTicket({ claimToken, file: jpeg("exactly.jpg") })).ok).toBe(true);
  });

  it("counts READY rows and open reservations only: expired and FAILED reservations stop holding the budget; cancelled ones hold it until their window closes", async () => {
    const { claimToken } = await seedMemory();
    process.env.DAILY_BYTE_BUDGET = String(PHOTO_MAX + 1); resetEnvCache();
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 1);
    medias.push(row({ id: "expired", status: "PENDING", reservedUntil: past }));
    medias.push(row({ id: "cancelled_closed", status: "PENDING", reservedUntil: past, deletedAt: new Date() }));
    medias.push(row({ id: "failed", status: "FAILED", reservedUntil: future }));
    medias.push(row({ id: "yesterday", status: "READY", maxBytes: 500 * MB, sizeBytes: 500 * MB }, 25 * 60 * 60 * 1000));
    expect((await createUploadTicket({ claimToken, file: jpeg("ok.jpg") })).ok).toBe(true);
    // An open reservation (window ahead), a legacy row with no window written yet, and a READY row all count.
    medias.push(row({ id: "open", status: "PENDING", reservedUntil: future, maxBytes: 2 }));
    expect(await createUploadTicket({ claimToken, file: jpeg("no.jpg") })).toEqual({ ok: false, code: "budget_exceeded" });
    medias.pop();
    medias.push(row({ id: "legacy", status: "PENDING", reservedUntil: null, maxBytes: 2 }));
    expect(await createUploadTicket({ claimToken, file: jpeg("no2.jpg") })).toEqual({ ok: false, code: "budget_exceeded" });
    medias.pop();
    medias.push(row({ id: "stored", status: "READY", maxBytes: 2, sizeBytes: 1 }));
    expect(await createUploadTicket({ claimToken, file: jpeg("no3.jpg") })).toEqual({ ok: false, code: "budget_exceeded" });
    medias.pop();
    // Cancelling cannot recall a Blob token already handed out: a cancelled reservation holds its bytes until its window closes (TCR #3/#9).
    medias.push(row({ id: "cancelled_open", status: "PENDING", reservedUntil: future, deletedAt: new Date(), maxBytes: 2 }));
    expect(await createUploadTicket({ claimToken, file: jpeg("no4.jpg") })).toEqual({ ok: false, code: "budget_exceeded" });
  });

  it("an open reservation counts toward the day whatever its createdAt: being open means it was ticketed within the last 75 minutes (TCR #5)", async () => {
    const { claimToken } = await seedMemory();
    process.env.DAILY_BYTE_BUDGET = String(PHOTO_MAX + 1); resetEnvCache();
    medias.push(row({ id: "old_but_open", status: "PENDING", reservedUntil: new Date(Date.now() + 60_000), maxBytes: 2 }, 25 * 60 * 60 * 1000));
    expect(await createUploadTicket({ claimToken, file: jpeg("no.jpg") })).toEqual({ ok: false, code: "budget_exceeded" });
    medias[0]!.reservedUntil = new Date(Date.now() - 1);
    expect((await createUploadTicket({ claimToken, file: jpeg("ok.jpg") })).ok).toBe(true);
  });

  it("stamps a new reservation with reservedUntil = now + UPLOAD_WINDOW_MS, exactly the ticket's expiry plus the token's life (TCR #6)", async () => {
    const { claimToken } = await seedMemory();
    const before = Date.now();
    const result = await createUploadTicket({ claimToken, file: jpeg("a.jpg") });
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    const reservedUntil = medias.at(-1)!.reservedUntil!.getTime();
    expect(reservedUntil).toBeGreaterThanOrEqual(before + UPLOAD_WINDOW_MS - 50);
    expect(reservedUntil).toBeLessThanOrEqual(Date.now() + UPLOAD_WINDOW_MS + 50);
    expect(reservedUntil).toBe(result.upload.ticket.expiresAt + BLOB_TOKEN_LIFETIME_MS);
  });

  it("refuses a reservation that would take retained originals, derived copies and open reservations past TOTAL_BYTE_CEILING, whatever the day's budget", async () => {
    const { claimToken } = await seedMemory();
    process.env.DAILY_BYTE_BUDGET = String(100 * 1024 ** 3);
    process.env.TOTAL_BYTE_CEILING = String(100 * MB + PHOTO_MAX); resetEnvCache();
    const old = 3 * 24 * 60 * 60 * 1000;
    medias.push(row({ id: "stored_old", status: "READY", sizeBytes: 60 * MB }, old));
    derived.push({ mediaId: "stored_old", status: "READY", sizeBytes: 30 * MB }, { mediaId: "stored_old", status: "FAILED", sizeBytes: 999 * MB });
    medias.push(row({ id: "open_old", status: "PENDING", reservedUntil: new Date(Date.now() + 60_000), maxBytes: 10 * MB }, old));
    // 60 + 30 + 10 = 100 MB in stock; one photo ceiling fits exactly, a second does not.
    expect((await createUploadTicket({ claimToken, file: jpeg("fits.jpg") })).ok).toBe(true);
    expect(await createUploadTicket({ claimToken, file: jpeg("over.jpg") })).toEqual({ ok: false, code: "budget_exceeded" });
    process.env.TOTAL_BYTE_CEILING = String(100 * MB + 2 * PHOTO_MAX); resetEnvCache();
    expect((await createUploadTicket({ claimToken, file: jpeg("now-fits.jpg") })).ok).toBe(true);
  });

  it("a replacement reserves the kind's full ceiling, never the declared size (George #1 sub-claim, verified not a bug)", async () => {
    const { claimToken } = await seedMemory();
    medias.push({ id: "00000000-0000-4000-8000-000000000001", memoryId: "mem_1", storageKey: "k", mimeType: "image/jpeg", maxBytes: 1, status: "READY", createdAt: new Date(), originalFilename: "a.jpg", deletedAt: null, sortOrder: 0, replacesMediaId: null, sizeBytes: 1 });
    process.env.DAILY_BYTE_BUDGET = String(PHOTO_MAX); resetEnvCache();
    expect(await createReplacementTicket({ claimToken, mediaId: "00000000-0000-4000-8000-000000000001", file: { name: "b.jpg", type: "image/jpeg", size: 5 } })).toEqual({ ok: false, code: "budget_exceeded" });
    process.env.DAILY_BYTE_BUDGET = String(PHOTO_MAX + 1); resetEnvCache();
    const result = await createReplacementTicket({ claimToken, mediaId: "00000000-0000-4000-8000-000000000001", file: { name: "b.jpg", type: "image/jpeg", size: 5 } });
    expect(result.ok).toBe(true);
    expect(medias.at(-1)!.maxBytes).toBe(PHOTO_MAX);
  });
});

describe("Sentry tags (plan §8.2)", () => {
  it("tags the memory and the new file for an added file and for a replacement", async () => {
    tagIdsMock.mockClear();
    const { claimToken: TOKEN } = await seedMemory();
    const added = await createUploadTicket({ claimToken: TOKEN, file: { name: "b.jpg", type: "image/jpeg", size: 10 } });
    expect(added.ok).toBe(true);
    expect(tagIdsMock).toHaveBeenLastCalledWith({ memoryId: "mem_1", mediaId: added.ok ? added.upload.ticket.mediaId : "" });
    medias[0]!.status = "READY";
    medias[0]!.id = "00000000-0000-4000-8000-000000000001";
    const replaced = await createReplacementTicket({ claimToken: TOKEN, mediaId: medias[0]!.id, file: { name: "c.jpg", type: "image/jpeg", size: 10 } });
    expect(replaced.ok).toBe(true);
    expect(tagIdsMock).toHaveBeenLastCalledWith({ memoryId: "mem_1", mediaId: replaced.ok ? replaced.upload.ticket.mediaId : "" });
    expect(identifyMock).not.toHaveBeenCalled();
  });
});
