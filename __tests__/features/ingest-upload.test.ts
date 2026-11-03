import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { mintUploadTicket } from "@/lib/upload-ticket";
import { resetEnvCache } from "@/server/config/env";

const CLAIM = "c".repeat(43);

interface MediaRow {
  id: string;
  memoryId: string;
  storageKey: string;
  mimeType: string;
  maxBytes: number;
  status: "PENDING" | "READY" | "FAILED";
  sizeBytes: number | null;
  blobUrl: string | null;
  checksumSha256: string | null;
  memory: { deletedAt: Date | null };
}
let media: MediaRow[] = [];
let p2002Once = false;
const memories = [{ id: "mem_1", claimTokenHash: hashClaimToken(CLAIM), deletedAt: null as Date | null }];
const afterCalls: Array<() => Promise<void>> = [];
vi.mock("@/lib/sentry/after-flush", () => ({ afterWithFlush: (cb: () => Promise<void>) => { afterCalls.push(cb); } }));
const dbStub = {
  memory: { findUnique: vi.fn(async ({ where }: { where: { claimTokenHash: string } }) => memories.find((m) => m.claimTokenHash === where.claimTokenHash) ?? null) },
  media: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => media.find((m) => m.id === where.id) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string; status?: "PENDING" }; data: Partial<MediaRow> }) => {
      const row = media.find((m) => m.id === where.id);
      if (!row || (where.status && row.status !== where.status)) {
        const err = Object.assign(new Error("Record to update not found."), { code: "P2025" });
        throw err;
      }
      if (p2002Once) {
        p2002Once = false;
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      Object.assign(row, data);
      return row;
    }),
  },
};
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));

const headMock = vi.fn();
const delMock = vi.fn();
vi.mock("@/services/storage", () => ({
  createStorageService: () => ({ head: headMock, del: delMock, get: vi.fn(), put: vi.fn(), presignGet: vi.fn() }),
}));

const confirmMock = vi.fn(async (_arg: unknown) => ({ sent: true, messageId: "m1" }));
vi.mock("@/features/memories/confirm", () => ({ confirmMemory: (arg: unknown) => confirmMock(arg) }));

import { finalizeUpload, recordMedia } from "@/features/memories/ingest-upload";

function row(over: Partial<MediaRow> = {}): MediaRow {
  return {
    id: "med_1",
    memoryId: "mem_1",
    storageKey: "originals/mem_1/abc.jpg",
    mimeType: "image/jpeg",
    maxBytes: 25 * 1024 * 1024,
    status: "PENDING",
    sizeBytes: null,
    blobUrl: null,
    checksumSha256: null,
    memory: { deletedAt: null },
    ...over,
  };
}

beforeEach(() => {
  process.env.UPLOAD_TICKET_SECRET = "s".repeat(32);
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.jowray.com";
  afterCalls.length = 0;
  media = [row()];
  p2002Once = false;
  headMock.mockReset();
  delMock.mockReset();
  headMock.mockResolvedValue({
    pathname: "originals/mem_1/abc.jpg",
    url: "https://blob.test/originals/mem_1/abc.jpg",
    size: 1234,
    contentType: "image/jpeg",
    uploadedAt: new Date(),
  });
  resetEnvCache();
});

describe("recordMedia", () => {
  it("marks a PENDING row READY from head() by pathname and is idempotent", async () => {
    const first = await recordMedia({ mediaId: "med_1" });
    expect(first).toEqual({ status: "READY", mediaId: "med_1", memoryId: "mem_1", sizeBytes: 1234 });
    expect(headMock).toHaveBeenCalledWith("originals/mem_1/abc.jpg");
    expect(media[0]?.status).toBe("READY");
    expect(media[0]?.blobUrl).toBe("https://blob.test/originals/mem_1/abc.jpg");

    const second = await recordMedia({ mediaId: "med_1" });
    expect(second.status).toBe("READY");
    expect(headMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the row PENDING when the blob is not there yet", async () => {
    headMock.mockResolvedValue(null);
    expect(await recordMedia({ mediaId: "med_1" })).toEqual({ status: "PENDING", mediaId: "med_1", memoryId: "mem_1" });
    expect(media[0]?.status).toBe("PENDING");
  });

  it("fails and deletes the blob when it is too large or the wrong type", async () => {
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 26 * 1024 * 1024, contentType: "image/jpeg", uploadedAt: new Date() });
    expect((await recordMedia({ mediaId: "med_1" })).status).toBe("FAILED");
    expect(delMock).toHaveBeenCalledWith("originals/mem_1/abc.jpg");

    media = [row()];
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 10, contentType: "text/html", uploadedAt: new Date() });
    expect((await recordMedia({ mediaId: "med_1" })).status).toBe("FAILED");
    expect(delMock).toHaveBeenCalledTimes(2);
  });

  it("ignores soft-deleted memories and unknown ids", async () => {
    media = [row({ memory: { deletedAt: new Date() } })];
    expect(await recordMedia({ mediaId: "med_1" })).toEqual({ status: "NOT_FOUND", mediaId: "med_1" });
    expect(await recordMedia({ mediaId: "nope" })).toEqual({ status: "NOT_FOUND", mediaId: "nope" });
    expect(headMock).not.toHaveBeenCalled();
  });

  it("survives a concurrent writer: a lost race re-reads the row and never throws", async () => {
    p2002Once = true;
    const results = await Promise.all([recordMedia({ mediaId: "med_1" }), recordMedia({ mediaId: "med_1" })]);
    expect(results.map((r) => r.status).sort()).toEqual(["READY", "READY"]);
    expect(media).toHaveLength(1);
  });
});

describe("finalizeUpload", () => {
  const claims = { mediaId: "med_1", memoryId: "mem_1", pathname: "originals/mem_1/abc.jpg", mimeType: "image/jpeg", maxBytes: 25 * 1024 * 1024 };

  it("verifies the ticket and the claim token, records the media and returns the claim link", async () => {
    const result = await finalizeUpload({ ticket: mintUploadTicket(claims), claimToken: CLAIM });
    expect(result).toEqual({ status: "READY", claimLink: `https://www.jowray.com/m/${CLAIM}`, emailed: true });
    expect(confirmMock).toHaveBeenCalledWith({ memoryId: "mem_1", claimToken: CLAIM });
    expect(media[0]?.status).toBe("READY");
    expect(afterCalls).toHaveLength(1); // inline checksum scheduled for a small file
  });

  it("rejects a tampered ticket, a mismatched claim token, and does not touch the row", async () => {
    const ticket = mintUploadTicket(claims);
    expect(await finalizeUpload({ ticket: { ...ticket, maxBytes: 1 }, claimToken: CLAIM })).toEqual({ status: "REJECTED", reason: "bad_signature" });
    expect(await finalizeUpload({ ticket, claimToken: "x".repeat(43) })).toEqual({ status: "REJECTED", reason: "not_found" });
    expect(media[0]?.status).toBe("PENDING");
    expect(headMock).not.toHaveBeenCalled();
  });

  it("accepts an expired ticket at finalize (the claim token is the authority; the upload took longer than 15 minutes)", async () => {
    const result = await finalizeUpload({ ticket: mintUploadTicket(claims, { now: Date.now() - 20 * 60_000 }), claimToken: CLAIM });
    expect(result.status).toBe("READY");
  });

  it("still returns the claim link when the confirmation email throws", async () => {
    confirmMock.mockRejectedValueOnce(new Error("SENDGRID_FROM_EMAIL is required"));
    const result = await finalizeUpload({ ticket: mintUploadTicket(claims), claimToken: CLAIM });
    expect(result).toEqual({ status: "READY", claimLink: `https://www.jowray.com/m/${CLAIM}`, emailed: false });
  });

  it("does not schedule an inline checksum for a file over 50 MB", async () => {
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 60 * 1024 * 1024, contentType: "video/mp4", uploadedAt: new Date() });
    media = [row({ mimeType: "video/mp4", maxBytes: 500 * 1024 * 1024 })];
    const result = await finalizeUpload({ ticket: mintUploadTicket({ ...claims, mimeType: "video/mp4", maxBytes: 500 * 1024 * 1024 }), claimToken: CLAIM });
    expect(result.status).toBe("READY");
    expect(afterCalls).toHaveLength(0);
  });
});
