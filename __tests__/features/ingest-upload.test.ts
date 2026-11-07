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
const memories = [{ id: "mem_1", claimTokenHash: hashClaimToken(CLAIM), deletedAt: null as Date | null, contributorNote: null as string | null, consentVersion: "2026-11-v2", submissionId: null as string | null }];
const afterCalls: Array<() => Promise<void>> = [];
/** The task name of each scheduled callback, index for index with afterCalls. */
const afterNames: string[] = [];
vi.mock("@/lib/sentry/after-flush", () => ({ afterWithFlush: (name: string, cb: () => Promise<void>) => { afterNames.push(name); afterCalls.push(cb); } }));
const identifyMock = vi.fn();
const tagIdsMock = vi.fn();
vi.mock("@/lib/sentry/user", () => ({ identifyContributor: (...a: unknown[]) => identifyMock(...a), tagIds: (...a: unknown[]) => tagIdsMock(...a) }));
const metricsMock = vi.hoisted(() => ({ memoryCreated: vi.fn(), uploadFinalized: vi.fn(), confirmationSent: vi.fn(), reconcileRun: vi.fn() }));
vi.mock("@/lib/sentry/metrics", () => metricsMock);
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
/** By default the blob's first bytes match the row's declared type (the honest case); tests override it. */
const readPrefixMock = vi.fn(async (pathname: string): Promise<Uint8Array | null> => SIGNATURE_SAMPLES[media.find((m) => m.storageKey === pathname)?.mimeType ?? ""] ?? null);
vi.mock("@/services/storage", () => ({
  createStorageService: () => ({ head: headMock, del: delMock, readPrefix: readPrefixMock, get: vi.fn(), put: vi.fn(), presignGet: vi.fn() }),
}));

const confirmMock = vi.fn(async (_arg: unknown) => ({ sent: true, messageId: "m1" }));
vi.mock("@/features/memories/confirm", () => ({ confirmMemory: (arg: unknown) => confirmMock(arg) }));
const deriveMock = vi.fn(async (_arg: unknown) => ({ WEB_IMAGE: "derived", THUMBNAIL: "derived" }));
vi.mock("@/features/memories/derive-media", () => ({ deriveMedia: (arg: unknown) => deriveMock(arg) }));
const notifyMock = vi.fn(async (_arg: unknown) => ({ sent: true, messageId: "m2" }));
vi.mock("@/features/memories/notify-admins", () => ({ notifyAdminsOfMemory: (arg: unknown) => notifyMock(arg) }));
const extractGpsMock = vi.fn(async (_arg: unknown) => "found");
vi.mock("@/features/media/extract-photo-gps", () => ({ extractPhotoGps: (arg: unknown) => extractGpsMock(arg) }));

import { finalizeUpload, recordMedia } from "@/features/memories/ingest-upload";
import { SIGNATURE_PREFIX_BYTES } from "@/lib/media-types";

import { NOT_MEDIA, REAL_BUT_NOT_ALLOWED, SIGNATURE_SAMPLES } from "../fixtures/signatures";

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
  afterNames.length = 0;
  extractGpsMock.mockClear();
  notifyMock.mockClear();
  media = [row()];
  memories[0]!.contributorNote = null;
  memoryTypes.mem_1 = "PHOTO";
  revisions.length = 0;
  lockCalls.length = 0;
  p2002Once = false;
  headMock.mockReset();
  delMock.mockReset();
  readPrefixMock.mockClear();
  deriveMock.mockClear();
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

describe("recordMedia byte check (issue #45): the declared type is a claim, the first bytes are the evidence", () => {
  it("reads only a bounded prefix and makes the row READY when the bytes match the declared type", async () => {
    expect((await recordMedia({ mediaId: "med_1" })).status).toBe("READY");
    expect(readPrefixMock).toHaveBeenCalledTimes(1);
    expect(readPrefixMock).toHaveBeenCalledWith("originals/mem_1/abc.jpg", SIGNATURE_PREFIX_BYTES);
    expect(delMock).not.toHaveBeenCalled();
  });

  it("bytes of another kind: FAILED as unrecognized_bytes, never READY, but the bytes are KEPT (a byte-check verdict alone deletes nothing)", async () => {
    readPrefixMock.mockResolvedValueOnce(SIGNATURE_SAMPLES["audio/wav"]!);
    const outcome = await recordMedia({ mediaId: "med_1" });
    expect(outcome).toMatchObject({ status: "FAILED", reason: "unrecognized_bytes" });
    expect(delMock).not.toHaveBeenCalled();
    // The row says the bytes exist, so a later purge can find them.
    expect(media[0]).toMatchObject({ status: "FAILED", blobUrl: "https://blob.test/originals/mem_1/abc.jpg" });
  });

  it("non-media bytes under a video label never become servable, and are kept likewise", async () => {
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 10, contentType: "video/mp4", uploadedAt: new Date() });
    media = [row({ mimeType: "video/mp4", maxBytes: 500 * 1024 * 1024 })];
    readPrefixMock.mockResolvedValueOnce(NOT_MEDIA.zip!);
    expect(await recordMedia({ mediaId: "med_1" })).toMatchObject({ status: "FAILED", reason: "unrecognized_bytes" });
    expect(delMock).not.toHaveBeenCalled();
    expect(media[0]!.status).toBe("FAILED");
  });

  it("a real file the allowlist does not carry (AIFF named .wav, TIFF named .jpg) is FAILED and kept, never deleted", async () => {
    for (const [mime, sample] of [["audio/wav", REAL_BUT_NOT_ALLOWED.aiff!], ["image/jpeg", REAL_BUT_NOT_ALLOWED.tiff!], ["image/jpeg", REAL_BUT_NOT_ALLOWED.bmp!]] as const) {
      media = [row({ mimeType: mime, maxBytes: 100 * 1024 * 1024 })];
      headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 10, contentType: mime, uploadedAt: new Date() });
      readPrefixMock.mockResolvedValueOnce(sample);
      expect(await recordMedia({ mediaId: "med_1" })).toMatchObject({ status: "FAILED", reason: "unrecognized_bytes" });
    }
    expect(delMock).not.toHaveBeenCalled();
  });

  it("still deletes on the checks main already had: over the ticketed size, or a declared type that is not the ticket's", async () => {
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 10, contentType: "text/html", uploadedAt: new Date() });
    expect(await recordMedia({ mediaId: "med_1" })).toMatchObject({ status: "FAILED", reason: "wrong_type" });
    expect(delMock).toHaveBeenCalledTimes(1);
    expect(readPrefixMock).not.toHaveBeenCalled();
  });

  it("leaves the row PENDING, deleting nothing, when the blob vanished between head() and the prefix read", async () => {
    readPrefixMock.mockResolvedValueOnce(null);
    expect((await recordMedia({ mediaId: "med_1" })).status).toBe("PENDING");
    expect(delMock).not.toHaveBeenCalled();
    expect(media[0]!.status).toBe("PENDING");
  });

  it("does not read any bytes of a file that already failed the size or label check", async () => {
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 26 * 1024 * 1024, contentType: "image/jpeg", uploadedAt: new Date() });
    expect(await recordMedia({ mediaId: "med_1" })).toMatchObject({ status: "FAILED", reason: "too_large" });
    expect(readPrefixMock).not.toHaveBeenCalled();
  });

  it("never re-reads a row that is already READY: files recorded before the byte check keep working", async () => {
    media = [row({ status: "READY", sizeBytes: 5, blobUrl: "u" })];
    expect((await recordMedia({ mediaId: "med_1" })).status).toBe("READY");
    expect(readPrefixMock).not.toHaveBeenCalled();
    expect(headMock).not.toHaveBeenCalled();
  });

  it("refuses an empty file before asking for a byte range (a range on nothing is a 416, not a prefix)", async () => {
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 0, contentType: "image/jpeg", uploadedAt: new Date() });
    expect(await recordMedia({ mediaId: "med_1" })).toMatchObject({ status: "FAILED", reason: "unrecognized_bytes" });
    expect(readPrefixMock).not.toHaveBeenCalled();
    expect(delMock).not.toHaveBeenCalled();
  });

  it("relabels a file whose bytes are another allowed type of the same kind instead of destroying it (JPEG saved as .heic)", async () => {
    media = [row({ mimeType: "image/heic", storageKey: "originals/mem_1/abc.heic" })];
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.heic", url: "u", size: 1234, contentType: "image/heic", uploadedAt: new Date() });
    readPrefixMock.mockResolvedValueOnce(SIGNATURE_SAMPLES["image/jpeg"]!);
    expect((await recordMedia({ mediaId: "med_1" })).status).toBe("READY");
    expect(media[0]).toMatchObject({ status: "READY", mimeType: "image/jpeg", sizeBytes: 1234 });
    expect(delMock).not.toHaveBeenCalled();
  });

  it("relabels a HEIC that arrived as image/jpeg and a Voice Memo that arrived as audio/mpeg", async () => {
    readPrefixMock.mockResolvedValueOnce(SIGNATURE_SAMPLES["image/heic"]!);
    expect((await recordMedia({ mediaId: "med_1" })).status).toBe("READY");
    expect(media[0]!.mimeType).toBe("image/heic");
    media = [row({ mimeType: "audio/mpeg", maxBytes: 100 * 1024 * 1024 })];
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 10, contentType: "audio/mpeg", uploadedAt: new Date() });
    readPrefixMock.mockResolvedValueOnce(SIGNATURE_SAMPLES["audio/x-m4a"]!);
    expect((await recordMedia({ mediaId: "med_1" })).status).toBe("READY");
    expect(media[0]!.mimeType).toBe("audio/mp4");
  });

  it("still refuses bytes of a different kind (a video labelled as a photo), keeping them", async () => {
    readPrefixMock.mockResolvedValueOnce(SIGNATURE_SAMPLES["video/mp4"]!);
    expect(await recordMedia({ mediaId: "med_1" })).toMatchObject({ status: "FAILED", reason: "unrecognized_bytes" });
    expect(delMock).not.toHaveBeenCalled();
  });
});

describe("finalizeUpload", () => {
  const claims = { mediaId: "med_1", memoryId: "mem_1", pathname: "originals/mem_1/abc.jpg", mimeType: "image/jpeg", maxBytes: 25 * 1024 * 1024 };

  it("verifies the ticket and the claim token, records the media and returns the claim link", async () => {
    const result = await finalizeUpload({ ticket: mintUploadTicket(claims), claimToken: CLAIM });
    expect(result).toEqual({ status: "READY", claimLink: `https://www.jowray.com/m/${CLAIM}`, emailed: true });
    expect(confirmMock).toHaveBeenCalledWith({ memoryId: "mem_1", claimToken: CLAIM });
    expect(media[0]?.status).toBe("READY");
    expect(afterNames).toEqual(["finalize.admin_alert", "finalize.checksum_and_derive", "finalize.photo_gps"]);
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

  it("derives the web copy and thumbnail after the response once a file is READY", async () => {
    await finalizeUpload({ ticket: mintUploadTicket(claims), claimToken: CLAIM });
    expect(deriveMock).not.toHaveBeenCalled();
    for (const cb of afterCalls) { await cb(); }
    expect(deriveMock).toHaveBeenCalledWith({ mediaId: "med_1", deadlineMs: 20_000 });
  });

  it("schedules the photo GPS step as its own after() task, apart from the derived copies, once a file is READY (B3, C41)", async () => {
    await finalizeUpload({ ticket: mintUploadTicket(claims), claimToken: CLAIM });
    expect(extractGpsMock).not.toHaveBeenCalled(); // nothing runs before the response
    const gpsTask = afterCalls[afterNames.indexOf("finalize.photo_gps")]!;
    await gpsTask();
    expect(extractGpsMock).toHaveBeenCalledTimes(1);
    expect(extractGpsMock).toHaveBeenCalledWith({ mediaId: "med_1" });
    expect(deriveMock).not.toHaveBeenCalled(); // the GPS task never waits on, or runs, the derived copies
    await afterCalls[afterNames.indexOf("finalize.checksum_and_derive")]!();
    expect(deriveMock).toHaveBeenCalledTimes(1);
    expect(extractGpsMock).toHaveBeenCalledTimes(1);
  });

  it("schedules the derivation even for files too large to hash inline", async () => {
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 60 * 1024 * 1024, contentType: "video/mp4", uploadedAt: new Date() });
    media = [row({ mimeType: "video/mp4", maxBytes: 500 * 1024 * 1024 })];
    await finalizeUpload({ ticket: mintUploadTicket({ ...claims, mimeType: "video/mp4", maxBytes: 500 * 1024 * 1024 }), claimToken: CLAIM });
    for (const cb of afterCalls) { await cb(); }
    expect(deriveMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { kind: "a MOV video", mimeType: "video/quicktime", maxBytes: 500 * 1024 * 1024, locationTasks: 1 },
    { kind: "an MP4 video", mimeType: "video/mp4", maxBytes: 500 * 1024 * 1024, locationTasks: 1 },
    { kind: "a voice note", mimeType: "audio/mp4", maxBytes: 100 * 1024 * 1024, locationTasks: 0 },
    { kind: "a WebM video", mimeType: "video/webm", maxBytes: 500 * 1024 * 1024, locationTasks: 0 },
  ])("schedules location for MOV/MP4 but not audio/WebM: $kind (final review, item 4; plan §9, R2)", async ({ mimeType, maxBytes, locationTasks }) => {
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 1234, contentType: mimeType, uploadedAt: new Date() });
    media = [row({ mimeType, maxBytes })];
    const result = await finalizeUpload({ ticket: mintUploadTicket({ ...claims, mimeType, maxBytes }), claimToken: CLAIM });
    expect(result.status).toBe("READY");
    expect(afterNames).toContain("finalize.checksum_and_derive");
    expect(afterNames.filter((name) => name === "finalize.photo_gps")).toHaveLength(locationTasks);
    expect(extractGpsMock).not.toHaveBeenCalled();
    for (const cb of afterCalls) { await cb(); }
    expect(extractGpsMock).toHaveBeenCalledTimes(locationTasks);
    if (locationTasks > 0) {
      expect(extractGpsMock).toHaveBeenCalledWith({ mediaId: "med_1" });
    }
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
    expect(extractGpsMock).not.toHaveBeenCalled();
  });

  it("does not schedule an inline checksum for a file over 50 MB (the admin alert is still scheduled)", async () => {
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 60 * 1024 * 1024, contentType: "video/mp4", uploadedAt: new Date() });
    media = [row({ mimeType: "video/mp4", maxBytes: 500 * 1024 * 1024 })];
    const result = await finalizeUpload({ ticket: mintUploadTicket({ ...claims, mimeType: "video/mp4", maxBytes: 500 * 1024 * 1024 }), claimToken: CLAIM });
    expect(result.status).toBe("READY");
    expect(afterNames).toEqual(["finalize.admin_alert", "finalize.checksum_and_derive", "finalize.photo_gps"]); // the cron hashes large files; MP4 still gets a location task
    for (const cb of afterCalls) { await cb(); }
    expect(notifyMock).toHaveBeenCalledWith({ memoryId: "mem_1" });
    expect(media[0]?.checksumSha256).toBeNull();
    expect(dbStub.media.update.mock.calls.some((c) => "checksumSha256" in ((c[0] as { data: Record<string, unknown> }).data ?? {}))).toBe(false);
  });
});

describe("finalizeUpload for a memory that belongs to a send (Task 15)", () => {
  it("records the file but sends no confirmation and schedules no admin alert; completion owns both", async () => {
    const claims = { mediaId: "med_1", memoryId: "mem_1", pathname: "originals/mem_1/abc.jpg", mimeType: "image/jpeg", maxBytes: 25 * 1024 * 1024 };
    confirmMock.mockClear();
    memories[0]!.submissionId = "sub_1";
    try {
      const result = await finalizeUpload({ ticket: mintUploadTicket(claims), claimToken: CLAIM });
      expect(result).toEqual({ status: "READY", claimLink: `https://www.jowray.com/m/${CLAIM}`, emailed: false });
      expect(confirmMock).not.toHaveBeenCalled();
      expect(afterNames).toEqual(["finalize.checksum_and_derive", "finalize.photo_gps"]); // no admin alert: completion owns it
      for (const cb of afterCalls) { await cb(); }
      expect(notifyMock).not.toHaveBeenCalled();
      expect(deriveMock).toHaveBeenCalled();
      expect(extractGpsMock).toHaveBeenCalledWith({ mediaId: "med_1" });
    } finally {
      memories[0]!.submissionId = null;
    }
  });
});

describe("Sentry tags and metrics in finalizeUpload (plan §8.2)", () => {
  it("tags the memory and the file once the token and ticket check out, and counts the outcome", async () => {
    tagIdsMock.mockClear(); metricsMock.uploadFinalized.mockClear(); identifyMock.mockClear();
    const ticket = mintUploadTicket({ mediaId: "med_1", memoryId: "mem_1", pathname: "originals/mem_1/abc.jpg", mimeType: "image/jpeg", maxBytes: 25 * 1024 * 1024 });
    const result = await finalizeUpload({ ticket, claimToken: CLAIM });
    expect(result.status).toBe("READY");
    expect(tagIdsMock).toHaveBeenCalledWith({ memoryId: "mem_1", mediaId: "med_1" });
    expect(metricsMock.uploadFinalized).toHaveBeenCalledWith("READY");
    expect(identifyMock).not.toHaveBeenCalled();
  });
});
