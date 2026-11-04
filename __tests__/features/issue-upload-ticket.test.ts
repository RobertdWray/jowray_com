import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { UPLOAD_LEASE_MS, verifyUploadTicket } from "@/lib/upload-ticket";
import { resetEnvCache } from "@/server/config/env";

const ANCHOR_TOKEN = "a".repeat(43);
const SECOND_TOKEN = "b".repeat(43);
interface MemoryRow { id: string; claimTokenHash: string; deletedAt: Date | null; submissionId: string | null; submissionIndex: number | null; uploadLeaseUntil: Date | null }
interface MediaRow { id: string; memoryId: string; storageKey: string; mimeType: string; maxBytes: number; status: "PENDING" | "READY" | "FAILED"; deletedAt: Date | null }
let memories: MemoryRow[] = [];
let media: MediaRow[] = [];
const calls: string[] = [];
const dbStub = {
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
  },
};
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));

import { issueUploadTicket } from "@/features/memories/issue-upload-ticket";

beforeEach(() => {
  calls.length = 0;
  memories = [
    { id: "mem_anchor", claimTokenHash: hashClaimToken(ANCHOR_TOKEN), deletedAt: null, submissionId: "sub_1", submissionIndex: 0, uploadLeaseUntil: new Date(Date.now() + 60_000) },
    { id: "mem_second", claimTokenHash: hashClaimToken(SECOND_TOKEN), deletedAt: null, submissionId: "sub_1", submissionIndex: 1, uploadLeaseUntil: null },
    { id: "mem_legacy", claimTokenHash: hashClaimToken("c".repeat(43)), deletedAt: null, submissionId: null, submissionIndex: null, uploadLeaseUntil: null },
  ];
  media = [
    { id: "med_1", memoryId: "mem_second", storageKey: "dev/originals/mem_second/x.jpg", mimeType: "image/jpeg", maxBytes: 2_000_000, status: "PENDING", deletedAt: null },
    { id: "med_ready", memoryId: "mem_second", storageKey: "dev/originals/mem_second/y.jpg", mimeType: "image/jpeg", maxBytes: 2_000_000, status: "READY", deletedAt: null },
    { id: "med_removed", memoryId: "mem_second", storageKey: "dev/originals/mem_second/z.jpg", mimeType: "image/jpeg", maxBytes: 2_000_000, status: "PENDING", deletedAt: new Date() },
    { id: "med_other", memoryId: "mem_anchor", storageKey: "dev/originals/mem_anchor/w.jpg", mimeType: "image/jpeg", maxBytes: 2_000_000, status: "PENDING", deletedAt: null },
    { id: "med_legacy", memoryId: "mem_legacy", storageKey: "dev/originals/mem_legacy/v.m4a", mimeType: "audio/mp4", maxBytes: 100_000_000, status: "PENDING", deletedAt: null },
  ];
  process.env.UPLOAD_TICKET_SECRET = "s".repeat(32);
  resetEnvCache();
});

describe("issueUploadTicket", () => {
  it("mints a ticket for the row and renews the anchor's lease, from any memory of the send", async () => {
    const before = Date.now();
    const result = await issueUploadTicket({ claimToken: SECOND_TOKEN, mediaId: "med_1" });
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.upload.pathname).toBe("dev/originals/mem_second/x.jpg");
    const verified = verifyUploadTicket(result.upload.ticket);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.claims).toMatchObject({ mediaId: "med_1", memoryId: "mem_second", pathname: "dev/originals/mem_second/x.jpg", mimeType: "image/jpeg", maxBytes: 2_000_000 });
    }
    const anchor = memories[0]!;
    expect(anchor.uploadLeaseUntil!.getTime()).toBeGreaterThanOrEqual(before + UPLOAD_LEASE_MS - 50);
    expect(anchor.uploadLeaseUntil!.getTime()).toBeLessThanOrEqual(Date.now() + UPLOAD_LEASE_MS + 50);
    expect(memories[1]!.uploadLeaseUntil).toBeNull();
    expect(dbStub.memory.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { submissionId: "sub_1", submissionIndex: 0 } }));
  });

  it("refuses READY, removed and foreign rows, a wrong token and bad input, and renews nothing", async () => {
    expect(await issueUploadTicket({ claimToken: SECOND_TOKEN, mediaId: "med_ready" })).toEqual({ ok: false, code: "not_pending" });
    expect(await issueUploadTicket({ claimToken: SECOND_TOKEN, mediaId: "med_removed" })).toEqual({ ok: false, code: "not_found" });
    expect(await issueUploadTicket({ claimToken: SECOND_TOKEN, mediaId: "med_other" })).toEqual({ ok: false, code: "not_found" });
    expect(await issueUploadTicket({ claimToken: "x".repeat(43), mediaId: "med_1" })).toEqual({ ok: false, code: "not_found" });
    expect(await issueUploadTicket({ claimToken: "short", mediaId: "med_1" })).toEqual({ ok: false, code: "invalid" });
    memories[1]!.deletedAt = new Date();
    expect(await issueUploadTicket({ claimToken: SECOND_TOKEN, mediaId: "med_1" })).toEqual({ ok: false, code: "not_found" });
    expect(dbStub.memory.updateMany).not.toHaveBeenCalled();
  });

  it("a legacy memory (no submission) gets its ticket and has no lease to renew", async () => {
    const result = await issueUploadTicket({ claimToken: "c".repeat(43), mediaId: "med_legacy" });
    expect(result.ok).toBe(true);
    expect(dbStub.memory.updateMany).not.toHaveBeenCalled();
    expect(memories.every((m) => m.id !== "mem_legacy" || m.uploadLeaseUntil === null)).toBe(true);
  });
});
