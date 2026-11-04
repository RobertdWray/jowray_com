import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { verifyUploadTicket } from "@/lib/upload-ticket";
import { resetEnvCache } from "@/server/config/env";

interface MemoryRow { id: string; memorialId: string; contributorId: string; type: string; source: string; status: string; claimTokenHash: string; consentVersion: string; consentedAt: Date; createdAt: Date; deletedAt: Date | null; approxDateText: string | null; contributorNote: string | null; visibility: string; notifyWhenPosted: boolean; submissionId?: string | null; submissionIndex?: number | null; uploadLeaseUntil?: Date | null }
interface MediaRow { id: string; memoryId: string; storageKey: string; mimeType: string; maxBytes: number; status: string; createdAt: Date; originalFilename: string | null; durationSeconds?: number | null; deletedAt: Date | null; sortOrder: number; replacesMediaId: string | null }
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

import { createMemory, createReplacementTicket, createUploadTicket } from "@/features/memories/create-memory";

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
  file: { name: "voice.m4a", type: "audio/mp4", size: 1024 * 1024 },
};

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
  it("creates contributor, PENDING memory and PENDING media, returns a verifiable ticket", async () => {
    const result = await createMemory(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.memoryId).toBe("mem_1");
    expect(result.claimToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(memories[0]?.claimTokenHash).toBe(hashClaimToken(result.claimToken));
    expect(memories[0]).toMatchObject({ type: "VOICE", source: "WEB_UPLOAD", status: "PENDING", consentVersion: "2026-11-v1", contributorNote: "We laughed a lot." });
    expect(contributors[0]).toMatchObject({ name: "Jo Friend", email: "jo@example.com", contactOptIn: false, mailingListOptIn: true, memorialId: "memorial_1" });
    expect(memories[0]).toMatchObject({ notifyWhenPosted: false });
    expect(result.upload?.pathname).toMatch(/^dev\/originals\/mem_1\/[0-9a-f-]{36}\.m4a$/);
    expect(medias[0]).toMatchObject({ status: "PENDING", mimeType: "audio/mp4", maxBytes: 100 * 1024 * 1024, storageKey: result.upload?.pathname });
    const verified = verifyUploadTicket(result.upload!.ticket);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.claims).toMatchObject({ mediaId: "med_1", memoryId: "mem_1", pathname: result.upload?.pathname, mimeType: "audio/mp4", maxBytes: 100 * 1024 * 1024 });
    }
  });

  it("normalizes a recorder MIME type with parameters before ticketing", async () => {
    const result = await createMemory({ ...valid, file: { name: "clip.webm", type: "audio/webm;codecs=opus", size: 10 } });
    expect(result.ok && result.upload?.ticket.mimeType).toBe("audio/webm");
    expect(result.ok && result.upload?.pathname).toMatch(/\.webm$/);
  });

  it("stores durationSeconds for a recording", async () => {
    const result = await createMemory({ ...valid, file: { name: "clip.webm", type: "audio/webm;codecs=opus", size: 10, durationSeconds: 24 } });
    expect(result.ok).toBe(true);
    expect(medias[0]?.durationSeconds).toBe(24);
  });

  it("stores null when no duration is sent", async () => {
    const result = await createMemory(valid);
    expect(result.ok).toBe(true);
    expect(medias[0]?.durationSeconds).toBeNull();
  });

  it("stores null for 0", async () => {
    const result = await createMemory({ ...valid, file: { ...valid.file, durationSeconds: 0 } });
    expect(result.ok).toBe(true);
    expect(medias[0]?.durationSeconds).toBeNull();
  });

  it("ignores durationSeconds on a photo", async () => {
    const result = await createMemory({ ...valid, file: { name: "photo.jpg", type: "image/jpeg", size: 10, durationSeconds: 24 } });
    expect(result.ok).toBe(true);
    expect(medias[0]?.durationSeconds).toBeNull();
  });

  it("rejects a negative durationSeconds", async () => {
    const result = await createMemory({ ...valid, file: { ...valid.file, durationSeconds: -1 } });
    expect(result).toMatchObject({ ok: false, code: "invalid" });
    expect(memories).toHaveLength(0);
    expect(medias).toHaveLength(0);
    expect(contributors).toHaveLength(0);
  });

  it("maps an untyped iPhone photo from its extension", async () => {
    const result = await createMemory({ ...valid, file: { name: "IMG_1.HEIC", type: "", size: 10 } });
    expect(result.ok && result.upload?.ticket.mimeType).toBe("image/heic");
    expect(memories[0]?.type).toBe("PHOTO");
  });

  it("creates a TEXT memory with no media when there is no file", async () => {
    const result = await createMemory({ ...valid, file: null });
    expect(result.ok).toBe(true);
    expect(result.ok && result.upload).toBeNull();
    expect(result.ok && result.emailed).toBe(true);
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
    const result = await createMemory({ ...valid, file: null });
    expect(result.ok).toBe(true);
    expect(result.ok && result.emailed).toBe(false);
    expect(memories).toHaveLength(1);
  });

  it("rejects without note and file, or with a disallowed type", async () => {
    expect(await createMemory({ ...valid, note: "", file: null })).toMatchObject({ ok: false, code: "invalid" });
    expect(await createMemory({ ...valid, file: { name: "x.svg", type: "image/svg+xml", size: 10 } })).toMatchObject({ ok: false, code: "unsupported_type" });
    expect(await createMemory({ ...valid, file: { name: "big.mov", type: "video/quicktime", size: 501 * 1024 * 1024 } })).toMatchObject({ ok: false, code: "too_large" });
    expect(memories).toHaveLength(0);
  });

  it("refuses when the daily memory budget is reached", async () => {
    for (let i = 0; i < 3; i += 1) { expect((await createMemory({ ...valid, file: null })).ok).toBe(true); }
    expect(await createMemory({ ...valid, file: null })).toMatchObject({ ok: false, code: "budget_exceeded" });
  });

  it("refuses when the daily byte budget would be exceeded", async () => {
    const video = { name: "a.mp4", type: "video/mp4", size: 1 };
    expect((await createMemory({ ...valid, file: video })).ok).toBe(true); // 500 MB ticketed
    expect(await createMemory({ ...valid, file: video })).toMatchObject({ ok: false, code: "budget_exceeded" });
  });
});

describe("createUploadTicket", () => {
  it("mints a ticket for an existing memory and caps at 10 media rows", async () => {
    const created = await createMemory({ ...valid, file: null });
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
    const created = await createMemory({ ...valid, file: null });
    if (!created.ok) { throw new Error("setup"); }
    process.env.DAILY_BYTE_BUDGET = String(100 * 1024 ** 3); resetEnvCache();
    for (let i = 0; i < 10; i += 1) {
      expect((await createUploadTicket({ claimToken: created.claimToken, file: { name: `p${i}.jpg`, type: "image/jpeg", size: 1 } })).ok).toBe(true);
    }
    expect(lockCalls.at(-1)).toContain("FOR UPDATE|mem_1");
    expect(await createUploadTicket({ claimToken: created.claimToken, file: { name: "p.jpg", type: "image/jpeg", size: 1 } })).toEqual({ ok: false, code: "too_many_files" });
    medias[3]!.deletedAt = new Date();
    expect((await createUploadTicket({ claimToken: created.claimToken, file: { name: "again.jpg", type: "image/jpeg", size: 1 } })).ok).toBe(true);
    expect(medias.at(-1)!.sortOrder).toBe(10);
  });
});

describe("createReplacementTicket", () => {
  async function seeded() {
    const created = await createMemory({ ...valid, file: { name: "a.jpg", type: "image/jpeg", size: 1 } });
    if (!created.ok) { throw new Error("setup"); }
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
    expect(medias[1]).toMatchObject({ status: "PENDING", replacesMediaId: "00000000-0000-4000-8000-000000000001", sortOrder: 4, mimeType: "image/heic" });
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
    const created = await createMemory({ ...valid, file: null });
    if (!created.ok) { throw new Error("setup"); }
    lockCalls.length = 0;
    await createUploadTicket({ claimToken: created.claimToken, file: { name: "p.jpg", type: "image/jpeg", size: 1 } });
    expect(lockCalls).toEqual([expect.stringContaining("FOR UPDATE|mem_1")]);
    expect(memories[0]!.uploadLeaseUntil ?? null).toBeNull();
  });
});
