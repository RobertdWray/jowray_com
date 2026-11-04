import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { verifyUploadTicket } from "@/lib/upload-ticket";
import { resetEnvCache } from "@/server/config/env";

interface MemoryRow { id: string; memorialId: string; contributorId: string; type: string; source: string; status: string; claimTokenHash: string; consentVersion: string; consentedAt: Date; createdAt: Date; deletedAt: Date | null; approxDateText: string | null; contributorNote: string | null; visibility: string; notifyWhenPosted: boolean; uploadLeaseUntil?: Date | null }
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
    count: vi.fn(async ({ where }: { where?: { createdAt?: { gt: Date } } } = {}) => memories.filter((m) => !where?.createdAt || m.createdAt > where.createdAt.gt).length),
    create: vi.fn(async ({ data }: { data: Omit<MemoryRow, "id" | "createdAt" | "deletedAt"> }) => { const row: MemoryRow = { id: `mem_${memories.length + 1}`, createdAt: new Date(), deletedAt: null, ...data }; memories.push(row); return row; }),
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

import { createMemory, createReplacementTicket, createUploadTicket, issueUploadTicket, LEASE_MS } from "@/features/memories/create-memory";

const valid = {
  name: "Jo Friend",
  relationship: "neighbour",
  email: "jo@example.com",
  approxDateText: "Summer 1998",
  note: "We laughed a lot.",
  visibility: "FAMILY" as const,
  contactOptIn: false,
  mailingListOptIn: true,
  notifyWhenPosted: false,
  files: [{ name: "voice.m4a", type: "audio/mp4", size: 1024 * 1024 }],
};
const voice = valid.files[0]!;

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

describe("createMemory", () => {
  it("creates contributor, PENDING memory and PENDING media rows, a submission lease, and no tickets yet", async () => {
    const result = await createMemory(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.memoryId).toBe("mem_1");
    expect(result.claimToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(memories[0]?.claimTokenHash).toBe(hashClaimToken(result.claimToken));
    expect(memories[0]).toMatchObject({ type: "VOICE", source: "WEB_UPLOAD", status: "PENDING", consentVersion: "2026-11-v1", contributorNote: "We laughed a lot." });
    expect(memories[0]!.uploadLeaseUntil!.getTime()).toBeGreaterThan(Date.now() + LEASE_MS - 5_000);
    expect(contributors[0]).toMatchObject({ name: "Jo Friend", email: "jo@example.com", contactOptIn: false, mailingListOptIn: true, memorialId: "memorial_1" });
    expect(memories[0]).toMatchObject({ notifyWhenPosted: false });
    expect(result.media).toEqual([{ mediaId: "med_1", sortOrder: 0 }]);
    expect(medias[0]).toMatchObject({ status: "PENDING", mimeType: "audio/mp4", maxBytes: 100 * 1024 * 1024, sortOrder: 0 });
    expect(medias[0]!.storageKey).toMatch(/^dev\/originals\/mem_1\/[0-9a-f-]{36}\.m4a$/);
    expect("upload" in result).toBe(false);
  });

  it("creates one PENDING row per file in order, with each file's own caption, date and place, and sums the budget", async () => {
    const result = await createMemory({ ...valid, files: [
      { name: "a.jpg", type: "image/jpeg", size: 10, caption: "the lake", approxDateText: "1998", place: "Lake George" },
      { name: "b.png", type: "image/png", size: 10 },
      { name: "c.m4a", type: "audio/mp4", size: 10, caption: "her laugh" },
    ] });
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.media.map((m) => m.sortOrder)).toEqual([0, 1, 2]);
    expect(medias.map((m) => [m.sortOrder, m.mimeType, m.caption ?? null, m.approxDateText ?? null, m.place ?? null])).toEqual([
      [0, "image/jpeg", "the lake", "1998", "Lake George"],
      [1, "image/png", null, null, null],
      [2, "audio/mp4", "her laugh", null, null],
    ]);
    expect(memories[0]?.type).toBe("VOICE");
    // the budget reserved the sum of the three ticketed limits (25 + 25 + 100 MB), under the 600 MB test budget
    expect(medias.reduce((sum, m) => sum + m.maxBytes, 0)).toBe(25 * 1024 * 1024 + 25 * 1024 * 1024 + 100 * 1024 * 1024);
    expect(await createMemory({ ...valid, files: [{ name: "big.mov", type: "video/quicktime", size: 1 }] })).toMatchObject({ ok: false, code: "budget_exceeded" });
  });

  it("refuses more than the per-memory cap of files in one submission", async () => {
    const files = Array.from({ length: 11 }, (_, i) => ({ name: `p${i}.jpg`, type: "image/jpeg", size: 1 }));
    expect(await createMemory({ ...valid, files })).toMatchObject({ ok: false, code: "invalid" });
    expect(memories).toHaveLength(0);
  });

  it("normalizes a recorder MIME type with parameters before storing the row", async () => {
    const result = await createMemory({ ...valid, files: [{ name: "clip.webm", type: "audio/webm;codecs=opus", size: 10 }] });
    expect(result.ok).toBe(true);
    expect(medias[0]).toMatchObject({ mimeType: "audio/webm" });
    expect(medias[0]!.storageKey).toMatch(/\.webm$/);
  });

  it("stores durationSeconds for a recording", async () => {
    const result = await createMemory({ ...valid, files: [{ name: "clip.webm", type: "audio/webm;codecs=opus", size: 10, durationSeconds: 24 }] });
    expect(result.ok).toBe(true);
    expect(medias[0]?.durationSeconds).toBe(24);
  });

  it("stores null when no duration is sent", async () => {
    const result = await createMemory(valid);
    expect(result.ok).toBe(true);
    expect(medias[0]?.durationSeconds).toBeNull();
  });

  it("stores null for 0", async () => {
    const result = await createMemory({ ...valid, files: [{ ...voice, durationSeconds: 0 }] });
    expect(result.ok).toBe(true);
    expect(medias[0]?.durationSeconds).toBeNull();
  });

  it("ignores durationSeconds on a photo", async () => {
    const result = await createMemory({ ...valid, files: [{ name: "photo.jpg", type: "image/jpeg", size: 10, durationSeconds: 24 }] });
    expect(result.ok).toBe(true);
    expect(medias[0]?.durationSeconds).toBeNull();
  });

  it("rejects a negative durationSeconds", async () => {
    const result = await createMemory({ ...valid, files: [{ ...voice, durationSeconds: -1 }] });
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(memories).toHaveLength(0);
    expect(medias).toHaveLength(0);
    expect(contributors).toHaveLength(0);
  });

  it("maps an untyped iPhone photo from its extension", async () => {
    const result = await createMemory({ ...valid, files: [{ name: "IMG_1.HEIC", type: "", size: 10 }] });
    expect(result.ok).toBe(true);
    expect(medias[0]).toMatchObject({ mimeType: "image/heic" });
    expect(memories[0]?.type).toBe("PHOTO");
  });

  it("creates a TEXT memory with no media when there is no file", async () => {
    const result = await createMemory({ ...valid, files: [] });
    expect(result.ok).toBe(true);
    expect(result.ok && result.media).toEqual([]);
    expect(result.ok && result.emailed).toBe(true);
    expect(memories[0]?.uploadLeaseUntil ?? null).toBeNull();
    expect(confirmMock).toHaveBeenCalledWith({ memoryId: "mem_1", claimToken: result.ok ? result.claimToken : "" });
    expect(memories[0]?.type).toBe("TEXT");
    expect(medias).toHaveLength(0);
    // The admin alert runs after the response and needs only the id.
    expect(notifyMock).not.toHaveBeenCalled();
    expect(afterCalls).toHaveLength(1);
    await afterCalls[0]!();
    expect(notifyMock).toHaveBeenCalledWith({ memoryId: "mem_1" });
  });

  it("does not alert the admins for a memory with a file (finalizeUpload does, once the file is READY)", async () => {
    const result = await createMemory(valid);
    expect(result.ok).toBe(true);
    expect(afterCalls).toHaveLength(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("still returns the claim link for a text memory when the confirmation email throws", async () => {
    confirmMock.mockRejectedValueOnce(new Error("email service down"));
    const result = await createMemory({ ...valid, files: [] });
    expect(result.ok).toBe(true);
    expect(result.ok && result.emailed).toBe(false);
    expect(memories).toHaveLength(1);
  });

  it("rejects without note and file, or with a disallowed type", async () => {
    expect(await createMemory({ ...valid, note: "", files: [] })).toMatchObject({ ok: false, code: "invalid" });
    expect(await createMemory({ ...valid, files: [{ name: "x.svg", type: "image/svg+xml", size: 10 }] })).toMatchObject({ ok: false, code: "unsupported_type" });
    expect(await createMemory({ ...valid, files: [{ name: "big.mov", type: "video/quicktime", size: 501 * 1024 * 1024 }] })).toMatchObject({ ok: false, code: "too_large" });
    expect(memories).toHaveLength(0);
  });

  it("refuses when the daily memory budget is reached", async () => {
    for (let i = 0; i < 3; i += 1) { expect((await createMemory({ ...valid, files: [] })).ok).toBe(true); }
    expect(await createMemory({ ...valid, files: [] })).toMatchObject({ ok: false, code: "budget_exceeded" });
  });

  it("refuses when the daily byte budget would be exceeded", async () => {
    const video = { name: "a.mp4", type: "video/mp4", size: 1 };
    expect((await createMemory({ ...valid, files: [video] })).ok).toBe(true); // 500 MB ticketed
    expect(await createMemory({ ...valid, files: [video] })).toMatchObject({ ok: false, code: "budget_exceeded" });
  });
});

describe("createUploadTicket", () => {
  it("mints a ticket for an existing memory and caps at 10 media rows", async () => {
    const created = await createMemory({ ...valid, files: [] });
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
    const created = await createMemory({ ...valid, files: [] });
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
    const created = await createMemory({ ...valid, files: [{ name: "a.jpg", type: "image/jpeg", size: 1, caption: "first", approxDateText: "1998", place: "the lake" }] });
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

describe("issueUploadTicket", () => {
  it("mints a ticket for one of the memory's PENDING rows just before its upload and renews the lease", async () => {
    const created = await createMemory({ ...valid, files: [{ name: "a.jpg", type: "image/jpeg", size: 1 }, { name: "b.jpg", type: "image/jpeg", size: 1 }] });
    if (!created.ok) { throw new Error("setup"); }
    memories[0]!.uploadLeaseUntil = new Date(Date.now() + 60_000);
    medias[1]!.id = "00000000-0000-4000-8000-000000000002";
    const result = await issueUploadTicket({ claimToken: created.claimToken, mediaId: "00000000-0000-4000-8000-000000000002" });
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.upload.pathname).toBe(medias[1]!.storageKey);
    const verified = verifyUploadTicket(result.upload.ticket);
    expect(verified.ok && verified.claims).toMatchObject({ mediaId: "00000000-0000-4000-8000-000000000002", memoryId: "mem_1", mimeType: "image/jpeg", maxBytes: 25 * 1024 * 1024 });
    expect(memories[0]!.uploadLeaseUntil!.getTime()).toBeGreaterThan(Date.now() + LEASE_MS - 5_000);
    expect(lockCalls.at(-1)).toContain("FOR UPDATE|mem_1");
  });

  it("does not reopen a closed lease: a ticket for a leftover PENDING row after completion leaves cron free to reconcile", async () => {
    const created = await createMemory({ ...valid, files: [{ name: "a.jpg", type: "image/jpeg", size: 1 }] });
    if (!created.ok) { throw new Error("setup"); }
    memories[0]!.uploadLeaseUntil = null;
    medias[0]!.id = "00000000-0000-4000-8000-000000000003";
    expect((await issueUploadTicket({ claimToken: created.claimToken, mediaId: "00000000-0000-4000-8000-000000000003" })).ok).toBe(true);
    expect(memories[0]!.uploadLeaseUntil ?? null).toBeNull();
    memories[0]!.uploadLeaseUntil = new Date(Date.now() - 1_000);
    expect((await issueUploadTicket({ claimToken: created.claimToken, mediaId: "00000000-0000-4000-8000-000000000003" })).ok).toBe(true);
    expect(memories[0]!.uploadLeaseUntil!.getTime()).toBeLessThan(Date.now());
  });

  it("refuses a READY row, a cancelled row, another memory's row, a wrong token and invalid input", async () => {
    const created = await createMemory({ ...valid, files: [{ name: "a.jpg", type: "image/jpeg", size: 1 }] });
    if (!created.ok) { throw new Error("setup"); }
    medias[0]!.id = "00000000-0000-4000-8000-000000000001";
    medias[0]!.status = "READY";
    expect(await issueUploadTicket({ claimToken: created.claimToken, mediaId: "00000000-0000-4000-8000-000000000001" })).toEqual({ ok: false, code: "not_found" });
    medias[0]!.status = "PENDING"; medias[0]!.deletedAt = new Date();
    expect(await issueUploadTicket({ claimToken: created.claimToken, mediaId: "00000000-0000-4000-8000-000000000001" })).toEqual({ ok: false, code: "not_found" });
    medias[0]!.deletedAt = null;
    expect(await issueUploadTicket({ claimToken: "w".repeat(43), mediaId: "00000000-0000-4000-8000-000000000001" })).toEqual({ ok: false, code: "not_found" });
    expect(await issueUploadTicket({ claimToken: created.claimToken, mediaId: "nope" })).toEqual({ ok: false, code: "invalid" });
  });
});
