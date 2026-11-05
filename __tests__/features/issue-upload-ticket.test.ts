import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { BLOB_TOKEN_LIFETIME_MS, UPLOAD_LEASE_MS, UPLOAD_WINDOW_MS, verifyUploadTicket } from "@/lib/upload-ticket";
import { resetEnvCache } from "@/server/config/env";

import { aggregateMock, matchesWhere } from "../helpers/prisma-where";

const ANCHOR_TOKEN = "a".repeat(43);
const SECOND_TOKEN = "b".repeat(43);
const HOUR = 60 * 60 * 1000;
interface MemoryRow { id: string; claimTokenHash: string; deletedAt: Date | null; submissionId: string | null; submissionIndex: number | null; uploadLeaseUntil: Date | null }
interface MediaRow { id: string; memoryId: string; storageKey: string; mimeType: string; maxBytes: number; status: "PENDING" | "READY" | "FAILED"; deletedAt: Date | null; createdAt: Date; reservedUntil: Date | null; sizeBytes?: number | null }
let memories: MemoryRow[] = [];
let media: MediaRow[] = [];
const calls: string[] = [];
const dbStub = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => { calls.push(`lock:${String(values[0])}`); return [{ id: values[0] }]; }),
  $executeRaw: vi.fn(async (strings: TemplateStringsArray) => { calls.push(strings.join("?").includes("pg_advisory_xact_lock") ? "lock:budget" : "execute"); return 1; }),
  $transaction: vi.fn(async (fn: (t: typeof dbStub) => Promise<unknown>) => fn(dbStub)),
  derivedMedia: { aggregate: vi.fn(aggregateMock(() => [])) },
  memory: {
    findUnique: vi.fn(async ({ where }: { where: { claimTokenHash: string } }) => { calls.push("memory.findUnique"); return memories.find((m) => m.claimTokenHash === where.claimTokenHash) ?? null; }),
    updateMany: vi.fn(async ({ where, data }: { where: { submissionId: string; submissionIndex: number }; data: { uploadLeaseUntil: Date } }) => {
      calls.push("memory.updateMany");
      const rows = memories.filter((m) => m.submissionId === where.submissionId && m.submissionIndex === where.submissionIndex);
      for (const r of rows) { r.uploadLeaseUntil = data.uploadLeaseUntil; }
      return { count: rows.length };
    }),
  },
  media: {
    findFirst: vi.fn(async ({ where }: { where: { id: string; memoryId: string; deletedAt: null } }) => { calls.push("media.findFirst"); return media.find((m) => m.id === where.id && m.memoryId === where.memoryId && m.deletedAt === null) ?? null; }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: { reservedUntil: Date } }) => {
      calls.push("media.updateMany");
      const rows = media.filter((m) => matchesWhere(m as unknown as Record<string, unknown>, where));
      for (const r of rows) { r.reservedUntil = data.reservedUntil; }
      return { count: rows.length };
    }),
    aggregate: vi.fn(async (args: { where?: Record<string, unknown>; _sum: Record<string, boolean> }) => { calls.push("media.aggregate"); return aggregateMock(() => media as unknown as Record<string, unknown>[])(args); }),
  },
};
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));
const identifyMock = vi.fn();
const tagIdsMock = vi.fn();
vi.mock("@/lib/sentry/user", () => ({ identifyContributor: (...a: unknown[]) => identifyMock(...a), tagIds: (...a: unknown[]) => tagIdsMock(...a) }));

import { issueUploadTicket } from "@/features/memories/issue-upload-ticket";

beforeEach(() => {
  calls.length = 0;
  memories = [
    { id: "mem_anchor", claimTokenHash: hashClaimToken(ANCHOR_TOKEN), deletedAt: null, submissionId: "sub_1", submissionIndex: 0, uploadLeaseUntil: new Date(Date.now() + 60_000) },
    { id: "mem_second", claimTokenHash: hashClaimToken(SECOND_TOKEN), deletedAt: null, submissionId: "sub_1", submissionIndex: 1, uploadLeaseUntil: null },
    { id: "mem_legacy", claimTokenHash: hashClaimToken("c".repeat(43)), deletedAt: null, submissionId: null, submissionIndex: null, uploadLeaseUntil: null },
  ];
  const fresh = { createdAt: new Date(Date.now() - 60_000), reservedUntil: new Date(Date.now() + UPLOAD_WINDOW_MS - 60_000) };
  media = [
    { id: "med_1", memoryId: "mem_second", storageKey: "dev/originals/mem_second/x.jpg", mimeType: "image/jpeg", maxBytes: 2_000_000, status: "PENDING", deletedAt: null, ...fresh },
    { id: "med_ready", memoryId: "mem_second", storageKey: "dev/originals/mem_second/y.jpg", mimeType: "image/jpeg", maxBytes: 2_000_000, status: "READY", deletedAt: null, ...fresh },
    { id: "med_removed", memoryId: "mem_second", storageKey: "dev/originals/mem_second/z.jpg", mimeType: "image/jpeg", maxBytes: 2_000_000, status: "PENDING", deletedAt: new Date(), ...fresh },
    { id: "med_other", memoryId: "mem_anchor", storageKey: "dev/originals/mem_anchor/w.jpg", mimeType: "image/jpeg", maxBytes: 2_000_000, status: "PENDING", deletedAt: null, ...fresh },
    { id: "med_legacy", memoryId: "mem_legacy", storageKey: "dev/originals/mem_legacy/v.m4a", mimeType: "audio/mp4", maxBytes: 100_000_000, status: "PENDING", deletedAt: null, createdAt: new Date(Date.now() - 2 * HOUR), reservedUntil: null },
  ];
  process.env.UPLOAD_TICKET_SECRET = "s".repeat(32);
  process.env.DAILY_BYTE_BUDGET = String(20 * 1024 ** 3);
  delete process.env.TOTAL_BYTE_CEILING;
  resetEnvCache();
});

describe("issueUploadTicket", () => {
  it("mints a ticket for the row, renews the anchor's lease and pushes the row's window out to the token's last possible byte, from any memory of the send", async () => {
    const before = Date.now();
    const result = await issueUploadTicket({ claimToken: SECOND_TOKEN, mediaId: "med_1" });
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.upload.pathname).toBe("dev/originals/mem_second/x.jpg");
    const verified = verifyUploadTicket(result.upload.ticket);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.claims).toMatchObject({ mediaId: "med_1", memoryId: "mem_second", pathname: "dev/originals/mem_second/x.jpg", mimeType: "image/jpeg", maxBytes: 2_000_000 });
      // The window is exactly when the Blob token obtained with this ticket at the last moment would expire (issue #44, Oscar #18).
      expect(media[0]!.reservedUntil!.getTime()).toBe(verified.claims.expiresAt + BLOB_TOKEN_LIFETIME_MS);
    }
    expect(media[0]!.reservedUntil!.getTime()).toBeGreaterThanOrEqual(before + UPLOAD_WINDOW_MS - 50);
    const anchor = memories[0]!;
    expect(anchor.uploadLeaseUntil!.getTime()).toBeGreaterThanOrEqual(before + UPLOAD_LEASE_MS - 50);
    expect(anchor.uploadLeaseUntil!.getTime()).toBeLessThanOrEqual(Date.now() + UPLOAD_LEASE_MS + 50);
    expect(memories[1]!.uploadLeaseUntil).toBeNull();
    expect(dbStub.memory.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { submissionId: "sub_1", submissionIndex: 0 } }));
    // Inside one transaction: the lease first (anchor lock order C24), then the row's own conditional stamp; an open window needs no budget lock.
    expect(dbStub.$transaction).toHaveBeenCalledTimes(1);
    expect(calls.indexOf("memory.updateMany")).toBeLessThan(calls.indexOf("media.updateMany"));
    expect(calls).not.toContain("lock:budget");
    expect(dbStub.media.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "med_1", status: "PENDING", deletedAt: null } }));
  });

  it("refuses READY, removed and foreign rows, a wrong token and bad input, and renews or stamps nothing", async () => {
    expect(await issueUploadTicket({ claimToken: SECOND_TOKEN, mediaId: "med_ready" })).toEqual({ ok: false, code: "not_pending" });
    expect(await issueUploadTicket({ claimToken: SECOND_TOKEN, mediaId: "med_removed" })).toEqual({ ok: false, code: "not_found" });
    expect(await issueUploadTicket({ claimToken: SECOND_TOKEN, mediaId: "med_other" })).toEqual({ ok: false, code: "not_found" });
    expect(await issueUploadTicket({ claimToken: "x".repeat(43), mediaId: "med_1" })).toEqual({ ok: false, code: "not_found" });
    expect(await issueUploadTicket({ claimToken: "short", mediaId: "med_1" })).toEqual({ ok: false, code: "invalid" });
    memories[1]!.deletedAt = new Date();
    expect(await issueUploadTicket({ claimToken: SECOND_TOKEN, mediaId: "med_1" })).toEqual({ ok: false, code: "not_found" });
    expect(dbStub.memory.updateMany).not.toHaveBeenCalled();
    expect(dbStub.media.updateMany).not.toHaveBeenCalled();
  });

  it("a legacy memory (no submission) gets its ticket and has no lease to renew; a row with no window yet is open and gets one", async () => {
    const result = await issueUploadTicket({ claimToken: "c".repeat(43), mediaId: "med_legacy" });
    expect(result.ok).toBe(true);
    expect(dbStub.memory.updateMany).not.toHaveBeenCalled();
    expect(memories.every((m) => m.id !== "mem_legacy" || m.uploadLeaseUntil === null)).toBe(true);
    expect(calls).not.toContain("lock:budget");
    expect(media.find((m) => m.id === "med_legacy")!.reservedUntil).toBeInstanceOf(Date);
  });

  it("a reservation whose window has closed is a new promise: it re-reserves its bytes under the budget lock, after the lease, or is refused unchanged (issue #44)", async () => {
    const closed = new Date(Date.now() - 1);
    media[0]!.reservedUntil = closed;
    process.env.DAILY_BYTE_BUDGET = "1"; resetEnvCache();
    expect(await issueUploadTicket({ claimToken: SECOND_TOKEN, mediaId: "med_1" })).toEqual({ ok: false, code: "budget_exceeded" });
    expect(media[0]!.reservedUntil).toBe(closed);
    expect(dbStub.media.updateMany).not.toHaveBeenCalled();
    expect(calls.indexOf("memory.updateMany")).toBeLessThan(calls.indexOf("lock:budget"));
    expect(calls.indexOf("lock:budget")).toBeLessThan(calls.indexOf("media.aggregate"));

    calls.length = 0;
    process.env.DAILY_BYTE_BUDGET = String(20 * 1024 ** 3); resetEnvCache();
    const result = await issueUploadTicket({ claimToken: SECOND_TOKEN, mediaId: "med_1" });
    expect(result.ok).toBe(true);
    expect(calls).toContain("lock:budget");
    expect(media[0]!.reservedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("a reservation older than a day is expired: no token is minted for it, so its window can never outrun the cron (issue #44)", async () => {
    media[0]!.createdAt = new Date(Date.now() - 24 * HOUR - 1);
    media[0]!.reservedUntil = new Date(Date.now() + 60_000);
    expect(await issueUploadTicket({ claimToken: SECOND_TOKEN, mediaId: "med_1" })).toEqual({ ok: false, code: "expired" });
    expect(dbStub.memory.updateMany).not.toHaveBeenCalled();
    expect(dbStub.media.updateMany).not.toHaveBeenCalled();
  });

  it("mints nothing when the row left PENDING between the read and the stamp (the conditional update is the authorisation)", async () => {
    dbStub.media.updateMany.mockImplementationOnce(async () => ({ count: 0 }));
    expect(await issueUploadTicket({ claimToken: SECOND_TOKEN, mediaId: "med_1" })).toEqual({ ok: false, code: "not_pending" });
  });
});

describe("Sentry tags (plan §8.2)", () => {
  it("tags the memory and the file of an issued ticket, and nothing for a refused request", async () => {
    tagIdsMock.mockClear();
    const issued = await issueUploadTicket({ claimToken: SECOND_TOKEN, mediaId: "med_1" });
    expect(issued.ok).toBe(true);
    expect(tagIdsMock).toHaveBeenCalledWith({ memoryId: "mem_second", mediaId: "med_1" });
    tagIdsMock.mockClear();
    await issueUploadTicket({ claimToken: "x".repeat(43), mediaId: "med_1" });
    expect(tagIdsMock).not.toHaveBeenCalled();
    expect(identifyMock).not.toHaveBeenCalled();
  });
});
