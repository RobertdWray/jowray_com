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
  deletedAt: Date | null;
  replacesMediaId: string | null;
  memory: { deletedAt: Date | null; contributorNote: string | null };
}
const memoryTypes: Record<string, string> = { mem_1: "PHOTO" };
const revisions: Array<{ memoryId: string; before: Record<string, unknown>; after: Record<string, unknown> }> = [];
const lockCalls: string[] = [];
function matches(row: MediaRow, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "status" && typeof v === "object" && v !== null && "in" in v) { if (!(v as { in: string[] }).in.includes(row.status)) { return false; } continue; }
    if ((row as unknown as Record<string, unknown>)[k] !== v) { return false; }
  }
  return true;
}
let media: MediaRow[] = [];
let p2002Once = false;
const memories = [{ id: "mem_1", claimTokenHash: hashClaimToken(CLAIM), deletedAt: null as Date | null, contributorNote: null as string | null, consentVersion: "2026-11-v2" }];
const afterCalls: Array<() => Promise<void>> = [];
vi.mock("@/lib/sentry/after-flush", () => ({ afterWithFlush: (cb: () => Promise<void>) => { afterCalls.push(cb); } }));
const dbStub = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => { lockCalls.push(`${strings.join("?")}|${String(values[0])}`); return [{ id: values[0] }]; }),
  $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(dbStub)),
  memory: {
    findUnique: vi.fn(async ({ where }: { where: { claimTokenHash: string } }) => memories.find((m) => m.claimTokenHash === where.claimTokenHash) ?? null),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => { const m = memories.find((x) => x.id === where.id); if (!m) { throw Object.assign(new Error("not found"), { code: "P2025" }); } return m; }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { type: string } }) => { memoryTypes[where.id] = data.type; return { id: where.id, ...data }; }),
  },
  memoryRevision: { count: vi.fn(async () => revisions.length), create: vi.fn(async ({ data }: { data: { memoryId: string; before: Record<string, unknown>; after: Record<string, unknown> } }) => { revisions.push(data); return data; }) },
  media: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => media.find((m) => m.id === where.id) ?? null),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => media.filter((m) => matches(m, where))),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<MediaRow> }) => { const rows = media.filter((m) => matches(m, where)); for (const r of rows) { Object.assign(r, data); } return { count: rows.length }; }),
    update: vi.fn(async ({ where, data }: { where: { id: string; status?: "PENDING" }; data: Partial<MediaRow> }) => {
      const row = media.find((m) => m.id === where.id);
      if (!row || (where.status && row.status !== where.status)) {
        const err = Object.assign(new Error("Record to update not found."), { code: "P2025" });
        throw err;
      }
      if (p2002Once) {
        p2002Once = false;
        row.status = "READY"; row.sizeBytes = 1234; row.blobUrl = "https://blob.test/originals/mem_1/abc.jpg";
        throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
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
const notifyMock = vi.fn(async (_arg: unknown) => ({ sent: true, messageId: "m2" }));
vi.mock("@/features/memories/notify-admins", () => ({ notifyAdminsOfMemory: (arg: unknown) => notifyMock(arg) }));

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
    deletedAt: null,
    replacesMediaId: null,
    memory: { deletedAt: null, contributorNote: null },
    ...over,
  };
}

beforeEach(() => {
  process.env.UPLOAD_TICKET_SECRET = "s".repeat(32);
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.jowray.com";
  afterCalls.length = 0;
  notifyMock.mockClear();
  media = [row()];
  memories[0]!.contributorNote = null;
  memoryTypes.mem_1 = "PHOTO";
  revisions.length = 0;
  lockCalls.length = 0;
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

  it("recomputes the memory type on READY and FAILED transitions under the memory lock", async () => {
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 10, contentType: "audio/mp4", uploadedAt: new Date() });
    media = [row({ mimeType: "audio/mp4", maxBytes: 100 * 1024 * 1024 }), row({ id: "med_0", status: "READY", mimeType: "image/jpeg", storageKey: "originals/mem_1/old.jpg" })];
    expect((await recordMedia({ mediaId: "med_1" })).status).toBe("READY");
    expect(memoryTypes.mem_1).toBe("VOICE");
    expect(lockCalls[0]).toContain("FOR UPDATE|mem_1");

    media = [row({ mimeType: "video/mp4", maxBytes: 500 * 1024 * 1024 }), row({ id: "med_0", status: "READY", mimeType: "image/jpeg", storageKey: "originals/mem_1/old.jpg" })];
    memoryTypes.mem_1 = "VIDEO";
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 10, contentType: "text/html", uploadedAt: new Date() });
    expect((await recordMedia({ mediaId: "med_1" })).status).toBe("FAILED");
    expect(memoryTypes.mem_1).toBe("PHOTO");
  });

  it("swaps a replacement into place when it reaches READY: the target is retired, order kept, revision written", async () => {
    media = [
      row({ id: "med_old", status: "READY", storageKey: "originals/mem_1/old.jpg", sizeBytes: 5, blobUrl: "u" }),
      row({ id: "med_1", replacesMediaId: "med_old" }),
    ];
    expect((await recordMedia({ mediaId: "med_1" })).status).toBe("READY");
    expect(media.find((m) => m.id === "med_old")!.deletedAt).toBeInstanceOf(Date);
    expect(media.find((m) => m.id === "med_1")).toMatchObject({ status: "READY", deletedAt: null });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.before).toMatchObject({ mediaIds: ["med_old"] });
    expect(revisions[0]!.after).toMatchObject({ mediaIds: ["med_1"] });
  });

  it("cancels a replacement whose target was removed meanwhile instead of resurrecting it", async () => {
    media = [
      row({ id: "med_old", status: "READY", storageKey: "originals/mem_1/old.jpg", deletedAt: new Date("2026-11-03T12:00:00Z") }),
      row({ id: "med_1", replacesMediaId: "med_old" }),
    ];
    expect(await recordMedia({ mediaId: "med_1" })).toMatchObject({ status: "FAILED", reason: "retired" });
    expect(media.find((m) => m.id === "med_1")!.deletedAt).toBeInstanceOf(Date);
    expect(revisions).toHaveLength(0);
  });

  it("does not let a cancelled replacement retire its target when the upload lands anyway", async () => {
    media = [
      row({ id: "med_old", status: "READY", storageKey: "originals/mem_1/old.jpg", sizeBytes: 5, blobUrl: "u" }),
      row({ id: "med_1", replacesMediaId: "med_old", deletedAt: new Date("2026-11-03T12:00:00Z") }),
    ];
    expect(await recordMedia({ mediaId: "med_1" })).toMatchObject({ status: "FAILED", reason: "retired" });
    expect(media.find((m) => m.id === "med_old")!.deletedAt).toBeNull();
    const cancelled = media.find((m) => m.id === "med_1")!;
    expect(cancelled.status).toBe("READY");
    expect(cancelled.deletedAt).toBeInstanceOf(Date);
    expect(cancelled.blobUrl).toBe("https://blob.test/originals/mem_1/abc.jpg");
    expect(revisions).toHaveLength(0);
  });

  it("reads the note inside the locked transaction, not from the pre-lock row", async () => {
    // A concurrent edit that committed words just before our lock must be seen by the type recompute.
    dbStub.$queryRaw.mockImplementationOnce(async (strings: TemplateStringsArray, ...values: unknown[]) => { memories[0]!.contributorNote = "words added meanwhile"; lockCalls.push(`${strings.join("?")}|${String(values[0])}`); return [{ id: values[0] }]; });
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 10, contentType: "text/html", uploadedAt: new Date() });
    media = [row()];
    expect((await recordMedia({ mediaId: "med_1" })).status).toBe("FAILED");
    expect(memoryTypes.mem_1).toBe("TEXT");
  });

  it("retires a replacement that fails validation so it never blocks its target", async () => {
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 10, contentType: "text/html", uploadedAt: new Date() });
    media = [
      row({ id: "med_old", status: "READY", storageKey: "originals/mem_1/old.jpg", sizeBytes: 5, blobUrl: "u" }),
      row({ id: "med_1", replacesMediaId: "med_old" }),
    ];
    expect((await recordMedia({ mediaId: "med_1" })).status).toBe("FAILED");
    expect(media.find((m) => m.id === "med_1")).toMatchObject({ status: "FAILED" });
    expect(media.find((m) => m.id === "med_1")!.deletedAt).toBeInstanceOf(Date);
    expect(media.find((m) => m.id === "med_old")!.deletedAt).toBeNull();
  });

  it("reports a cancelled or orphaned replacement as FAILED (retired) instead of READY", async () => {
    media = [
      row({ id: "med_old", status: "READY", storageKey: "originals/mem_1/old.jpg", deletedAt: new Date("2026-11-03T12:00:00Z") }),
      row({ id: "med_1", replacesMediaId: "med_old" }),
    ];
    expect(await recordMedia({ mediaId: "med_1" })).toEqual({ status: "FAILED", mediaId: "med_1", memoryId: "mem_1", reason: "retired" });
    media = [
      row({ id: "med_old", status: "READY", storageKey: "originals/mem_1/old.jpg", sizeBytes: 5, blobUrl: "u" }),
      row({ id: "med_1", replacesMediaId: "med_old", deletedAt: new Date("2026-11-03T12:00:00Z") }),
    ];
    expect(await recordMedia({ mediaId: "med_1" })).toEqual({ status: "FAILED", mediaId: "med_1", memoryId: "mem_1", reason: "retired" });
  });

  it("the first revision written by a swap records the consent version in force", async () => {
    media = [
      row({ id: "med_old", status: "READY", storageKey: "originals/mem_1/old.jpg", sizeBytes: 5, blobUrl: "u" }),
      row({ id: "med_1", replacesMediaId: "med_old" }),
    ];
    await recordMedia({ mediaId: "med_1" });
    expect(revisions[0]!.after).toMatchObject({ consentVersion: "2026-11-v2" });
  });

  it("ignores soft-deleted memories and unknown ids", async () => {
    media = [row({ memory: { deletedAt: new Date(), contributorNote: null } })];
    expect(await recordMedia({ mediaId: "med_1" })).toEqual({ status: "NOT_FOUND", mediaId: "med_1" });
    expect(await recordMedia({ mediaId: "nope" })).toEqual({ status: "NOT_FOUND", mediaId: "nope" });
    expect(headMock).not.toHaveBeenCalled();
  });

  it("survives a concurrent writer: a lost race (P2025) re-reads the row once and never throws", async () => {
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
    expect(afterCalls).toHaveLength(2); // admin alert, then the inline checksum for a small file
  });

  it("alerts the admins after the response (before the checksum), and a throwing alert never changes the result", async () => {
    const result = await finalizeUpload({ ticket: mintUploadTicket(claims), claimToken: CLAIM });
    expect(result).toMatchObject({ status: "READY", emailed: true });
    expect(notifyMock).not.toHaveBeenCalled(); // nothing runs before the response
    await afterCalls[0]!();
    expect(notifyMock).toHaveBeenCalledWith({ memoryId: "mem_1" });
    expect(media[0]?.checksumSha256).toBeNull(); // the checksum is the second callback
    notifyMock.mockRejectedValueOnce(new Error("SENDGRID_API_KEY is required"));
    await expect(afterCalls[0]!()).resolves.toBeUndefined();
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

  it("does not confirm or hash a replacement that was cancelled while uploading", async () => {
    media = [
      row({ id: "med_old", status: "READY", storageKey: "originals/mem_1/old.jpg", sizeBytes: 5, blobUrl: "u" }),
      row({ id: "med_1", replacesMediaId: "med_old", deletedAt: new Date("2026-11-03T12:00:00Z") }),
    ];
    const result = await finalizeUpload({ ticket: mintUploadTicket(claims), claimToken: CLAIM });
    expect(result.status).toBe("FAILED");
    expect(confirmMock).not.toHaveBeenCalled();
    expect(afterCalls).toHaveLength(0);
  });

  it("does not schedule an inline checksum for a file over 50 MB (the admin alert is still scheduled)", async () => {
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 60 * 1024 * 1024, contentType: "video/mp4", uploadedAt: new Date() });
    media = [row({ mimeType: "video/mp4", maxBytes: 500 * 1024 * 1024 })];
    const result = await finalizeUpload({ ticket: mintUploadTicket({ ...claims, mimeType: "video/mp4", maxBytes: 500 * 1024 * 1024 }), claimToken: CLAIM });
    expect(result.status).toBe("READY");
    expect(afterCalls).toHaveLength(1); // the admin alert only; the cron hashes large files
    await afterCalls[0]!();
    expect(notifyMock).toHaveBeenCalledWith({ memoryId: "mem_1" });
    expect(media[0]?.checksumSha256).toBeNull();
  });
});
