import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { resetEnvCache } from "@/server/config/env";

const T = (n: number) => String.fromCharCode(97 + n).repeat(43);
interface Derivative { kind: "WEB_IMAGE" | "THUMBNAIL"; status: "PENDING" | "READY" | "FAILED"; storageKey: string; width: number | null; height: number | null }
interface MediaRow { id: string; memoryId: string; status: "PENDING" | "READY" | "FAILED"; mimeType: string; originalFilename: string | null; durationSeconds: number | null; deletedAt: Date | null; sortOrder: number; createdAt: Date; storageKey: string; derivatives: Derivative[] }
interface MemoryRow { id: string; submissionId: string | null; submissionIndex: number | null; uploadLeaseUntil: Date | null; deletedAt: Date | null; claimTokenHash: string; type: string; contributorNote: string | null; approxDateText: string | null; place: string | null; createdAt: Date; contributor: { name: string | null; email: string | null; relationship: string | null } | null }
let memories: MemoryRow[] = [];
let media: MediaRow[] = [];
const transactions: unknown[] = [];

function withIncludes(row: MemoryRow, include: Record<string, unknown> | undefined) {
  type DerivativeFilter = { derivatives?: { where?: { kind?: string; status?: string } } };
  const inc = include as { media?: { include?: DerivativeFilter; select?: DerivativeFilter } } | undefined;
  const rows = media
    .filter((m) => m.memoryId === row.id && m.deletedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime())
    .map((m) => {
      const dw = (inc?.media?.include ?? inc?.media?.select)?.derivatives?.where;
      return { ...m, derivatives: m.derivatives.filter((d) => (!dw?.kind || d.kind === dw.kind) && (!dw?.status || d.status === dw.status)) };
    });
  return { ...row, media: rows };
}
let receiptRow: { status: string } | null = null;
const dbStub = {
  $transaction: vi.fn(async (ops: unknown) => { transactions.push(ops); return Array.isArray(ops) ? Promise.all(ops) : (ops as (t: unknown) => Promise<unknown>)(dbStub); }),
  emailLog: { findUnique: vi.fn(async () => receiptRow) },
  memory: {
    findUnique: vi.fn(async ({ where, include }: { where: { id?: string; claimTokenHash?: string }; include?: Record<string, unknown> }) => {
      const row = memories.find((m) => (where.id ? m.id === where.id : m.claimTokenHash === where.claimTokenHash));
      return row ? withIncludes(row, include) : null;
    }),
    findMany: vi.fn(async ({ where, include }: { where: { submissionId?: string; submissionIndex?: number; deletedAt?: null; claimTokenHash?: { in: string[] } }; include?: Record<string, unknown> }) =>
      memories
        .filter(
          (m) =>
            (where.submissionId ? m.submissionId === where.submissionId : true) &&
            (where.submissionIndex === undefined || m.submissionIndex === where.submissionIndex) &&
            (!("deletedAt" in where) || m.deletedAt === null) &&
            (where.claimTokenHash ? where.claimTokenHash.in.includes(m.claimTokenHash) : true)
        )
        .sort((a, b) => (a.submissionIndex ?? 0) - (b.submissionIndex ?? 0))
        .map((m) => withIncludes(m, include))
    ),
    updateMany: vi.fn(async ({ where, data }: { where: { submissionId: string; submissionIndex: number }; data: { uploadLeaseUntil: Date | null } }) => {
      const rows = memories.filter((m) => m.submissionId === where.submissionId && m.submissionIndex === where.submissionIndex);
      for (const r of rows) { r.uploadLeaseUntil = data.uploadLeaseUntil; }
      return { count: rows.length };
    }),
  },
  media: {
    findMany: vi.fn(async ({ where }: { where: { memory: { submissionId: string }; deletedAt: null; status: "READY"; mimeType: { startsWith: string } } }) => {
      const ids = new Set(memories.filter((m) => m.submissionId === where.memory.submissionId && m.deletedAt === null).map((m) => m.id));
      return media.filter((m) => ids.has(m.memoryId) && m.deletedAt === null && m.status === "READY" && m.mimeType.startsWith(where.mimeType.startsWith)).map((m) => ({ ...m, derivatives: m.derivatives.filter((d) => d.kind === "THUMBNAIL") }));
    }),
  },
};
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));

const sendMock = vi.fn(async (_arg: unknown): Promise<{ sent: boolean; messageId?: string; skipped?: string }> => ({ sent: true, messageId: "m1" }));
const skipMock = vi.fn(async (_arg: unknown) => ({ sent: false as const, skipped: "nothing_to_send" as const }));
vi.mock("@/services/email", () => ({ sendSubmissionConfirmation: (arg: unknown) => sendMock(arg), skipDelivery: (arg: unknown) => skipMock(arg) }));

const recordMediaAsIs = async ({ mediaId }: { mediaId: string }) => { const row = media.find((m) => m.id === mediaId)!; return { status: row.status, mediaId, memoryId: row.memoryId, sizeBytes: 1 }; };
const recordMediaMock = vi.fn(recordMediaAsIs);
const notifyMock = vi.fn(async (_memoryId: string) => true);
vi.mock("@/features/memories/ingest-upload", () => ({ recordMedia: (arg: { mediaId: string }) => recordMediaMock(arg), notifyAdminsQuietly: (id: string) => notifyMock(id) }));

const storageGetMock = vi.fn(async (pathname: string) => ({ stream: new Blob([Buffer.from(`bytes-of-${pathname}`)]).stream(), contentType: "image/jpeg", contentLength: 10 }));
vi.mock("@/services/storage", () => ({ createStorageService: () => ({ get: storageGetMock, head: vi.fn(), del: vi.fn(), put: vi.fn(), presignGet: vi.fn() }) }));

const afterCalls: Array<() => Promise<void>> = [];
vi.mock("@/lib/sentry/after-flush", () => ({ afterWithFlush: (_name: string, cb: () => Promise<void>) => { afterCalls.push(cb); } }));
const identifyMock = vi.fn();
const tagIdsMock = vi.fn();
vi.mock("@/lib/sentry/user", () => ({ identifyContributor: (...a: unknown[]) => identifyMock(...a), tagIds: (...a: unknown[]) => tagIdsMock(...a) }));
const metricsMock = vi.hoisted(() => ({ memoryCreated: vi.fn(), uploadFinalized: vi.fn(), confirmationSent: vi.fn(), reconcileRun: vi.fn() }));
vi.mock("@/lib/sentry/metrics", () => metricsMock);

import { completeSubmission, COMPLETION_GRACE_MS, confirmSubmission } from "@/features/memories/complete-submission";

const contributor = { name: "Kay", email: "kay@example.com", relationship: "former student" };
function mem(i: number, over: Partial<MemoryRow> = {}): MemoryRow {
  return { id: `mem_${i}`, submissionId: "sub_1", submissionIndex: i, uploadLeaseUntil: null, deletedAt: null, claimTokenHash: hashClaimToken(T(i)), type: "TEXT", contributorNote: `Memory ${i + 1} words.`, approxDateText: null, place: null, createdAt: new Date(Date.now() - 60 * 60_000), contributor, ...over };
}
function photo(id: string, memoryId: string, over: Partial<MediaRow> = {}): MediaRow {
  return { id, memoryId, status: "READY", mimeType: "image/jpeg", originalFilename: `${id}.jpg`, durationSeconds: null, deletedAt: null, sortOrder: 0, createdAt: new Date(), storageKey: `dev/originals/${memoryId}/${id}.jpg`, derivatives: [], ...over };
}
const thumb = (id: string, status: Derivative["status"] = "READY"): Derivative => ({ kind: "THUMBNAIL", status, storageKey: `dev/derived/${id}-thumb.jpg`, width: 520, height: 390 });
type SendArg = { anchorMemoryId: string; to: string; name?: unknown; relationship?: unknown; memories: Array<{ position: number; claimLink: string; media: Array<{ preview: { contentId: string; contentBase64: string; width: number; height: number } | null; originalFilename?: unknown }>; missingFiles: number; hasWords: boolean; note?: unknown }>; rotations?: Array<{ memoryId: string; claimTokenHash: string }> };
const lastSend = () => sendMock.mock.calls.at(-1)?.[0] as SendArg;

beforeEach(() => {
  memories = [mem(0), mem(1), mem(2)];
  media = [];
  receiptRow = null;
  transactions.length = 0; afterCalls.length = 0;
  sendMock.mockClear(); skipMock.mockClear(); recordMediaMock.mockReset(); recordMediaMock.mockImplementation(recordMediaAsIs); notifyMock.mockClear(); storageGetMock.mockClear();
  dbStub.$transaction.mockClear(); dbStub.memory.updateMany.mockClear();
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.jowray.com";
  resetEnvCache();
});

describe("completeSubmission (request path)", () => {
  it("refuses an incomplete, mixed or unknown token set and changes nothing", async () => {
    memories[0]!.uploadLeaseUntil = new Date(Date.now() + 60_000);
    expect(await completeSubmission({ claimTokens: [T(0), T(1)] })).toEqual({ ok: false, code: "not_found" });
    memories.push(mem(0, { id: "other_anchor", submissionId: "sub_2", claimTokenHash: hashClaimToken(T(5)) }));
    expect(await completeSubmission({ claimTokens: [T(0), T(1), T(2), T(5)] })).toEqual({ ok: false, code: "not_found" });
    expect(await completeSubmission({ claimTokens: [T(0), T(1), T(9)] })).toEqual({ ok: false, code: "not_found" });
    expect(await completeSubmission({ claimTokens: ["short"] })).toEqual({ ok: false, code: "invalid" });
    expect(sendMock).not.toHaveBeenCalled();
    expect(memories[0]!.uploadLeaseUntil).toBeInstanceOf(Date);
    expect(afterCalls).toHaveLength(0);
  });

  it("shortens the anchor's lease to a brief grace (never clears it under a live request), then sends once with every raw link in index order, without rotating and never inside a transaction", async () => {
    memories[0]!.uploadLeaseUntil = new Date(Date.now() + 60 * 60_000);
    const before = Date.now();
    const result = await completeSubmission({ claimTokens: [T(2), T(0), T(1)] });
    expect(result).toEqual({ ok: true, emailed: true });
    // A slow send that has run past the cron's 30-minute age must not have its tokens rotated by (e3)
    // during the thumbnail wait: the lease stays live for a couple of minutes and runs out on its own.
    const lease = memories[0]!.uploadLeaseUntil!.getTime();
    expect(lease).toBeGreaterThan(before + 60_000);
    expect(lease).toBeLessThanOrEqual(Date.now() + COMPLETION_GRACE_MS);
    expect(dbStub.memory.updateMany).toHaveBeenCalledWith({ where: { submissionId: "sub_1", submissionIndex: 0 }, data: { uploadLeaseUntil: expect.any(Date) } });
    // While that grace lease is live the cron path still answers `leased`.
    expect(await confirmSubmission({ anchorId: "mem_0" })).toEqual({ sent: false, skipped: "leased" });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = lastSend();
    expect(arg.anchorMemoryId).toBe("mem_0");
    expect(arg.to).toBe("kay@example.com");
    expect(arg.memories.map((m) => [m.position, m.claimLink])).toEqual([[1, `https://www.jowray.com/m/${T(0)}`], [2, `https://www.jowray.com/m/${T(1)}`], [3, `https://www.jowray.com/m/${T(2)}`]]);
    expect(arg.rotations).toBeUndefined();
    expect(dbStub.$transaction).not.toHaveBeenCalled();
    expect(memories.map((m) => m.claimTokenHash)).toEqual([hashClaimToken(T(0)), hashClaimToken(T(1)), hashClaimToken(T(2))]);
  });

  it("waits up to the budget for READY thumbnails, attaches them as previews, and sends with whatever is ready", async () => {
    media = [photo("p1", "mem_0", { derivatives: [thumb("p1", "PENDING")] }), photo("p2", "mem_1", { derivatives: [thumb("p2")] })];
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => { clock += ms; if (clock >= 3_000) { media[0]!.derivatives[0]!.status = "READY"; } });
    const result = await completeSubmission({ claimTokens: [T(0), T(1), T(2)] }, { thumbnailWaitMs: 10_000, sleep, now: () => clock });
    expect(result.ok).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(3);
    const arg = lastSend();
    expect(arg.memories[0]!.media[0]!.preview).toEqual({ contentId: "thumb-p1", contentBase64: Buffer.from("bytes-of-dev/derived/p1-thumb.jpg").toString("base64"), width: 520, height: 390 });
    expect(arg.memories[1]!.media[0]!.preview?.contentId).toBe("thumb-p2");

    // Never ready: stop at the budget and send with the badge.
    sendMock.mockClear();
    media[0]!.derivatives[0]!.status = "PENDING";
    clock = 0;
    const slowSleep = vi.fn(async (ms: number) => { clock += ms; });
    await completeSubmission({ claimTokens: [T(0), T(1), T(2)] }, { thumbnailWaitMs: 10_000, sleep: slowSleep, now: () => clock });
    expect(clock).toBeGreaterThanOrEqual(10_000);
    expect(clock).toBeLessThan(12_000);
    expect(lastSend().memories[0]!.media[0]!.preview).toBeNull();
    expect(lastSend().memories[1]!.media[0]!.preview?.contentId).toBe("thumb-p2");

    // No photos: no waiting at all.
    media = [];
    const noSleep = vi.fn(async () => {});
    await completeSubmission({ claimTokens: [T(0), T(1), T(2)] }, { thumbnailWaitMs: 10_000, sleep: noSleep, now: () => 0 });
    expect(noSleep).not.toHaveBeenCalled();
  });

  it("answers already_sent before fetching any thumbnail when the receipt row is already SENT", async () => {
    media = [photo("p1", "mem_0", { derivatives: [thumb("p1")] })];
    receiptRow = { status: "SENT" };
    expect(await completeSubmission({ claimTokens: [T(0), T(1), T(2)] }, { thumbnailWaitMs: 0 })).toEqual({ ok: true, emailed: true });
    expect(await confirmSubmission({ anchorId: "mem_0" })).toEqual({ sent: false, skipped: "already_sent" });
    expect(storageGetMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("fetches at most four thumbnails per send", async () => {
    media = Array.from({ length: 6 }, (_, i) => photo(`p${i}`, `mem_${i % 3}`, { sortOrder: i, derivatives: [thumb(`p${i}`)] }));
    await completeSubmission({ claimTokens: [T(0), T(1), T(2)] }, { thumbnailWaitMs: 0 });
    expect(storageGetMock).toHaveBeenCalledTimes(4);
    const previews = lastSend().memories.flatMap((m) => m.media.map((x) => x.preview?.contentId ?? null));
    expect(previews.filter((p) => p !== null)).toHaveLength(4);
  });

  it("re-checks PENDING rows against the store before building, so a file that landed late is not called missing", async () => {
    media = [photo("p1", "mem_0"), photo("p2", "mem_0", { status: "PENDING", sortOrder: 1, originalFilename: "late.jpg" })];
    recordMediaMock.mockImplementation(async ({ mediaId }) => {
      const row = media.find((m) => m.id === mediaId)!;
      row.status = "READY";
      return { status: "READY", mediaId, memoryId: row.memoryId, sizeBytes: 1 };
    });
    await completeSubmission({ claimTokens: [T(0), T(1), T(2)] }, { thumbnailWaitMs: 0 });
    expect(recordMediaMock).toHaveBeenCalledWith({ mediaId: "p2" });
    expect(recordMediaMock).not.toHaveBeenCalledWith({ mediaId: "p1" });
    const arg = lastSend();
    expect(arg.memories[0]!.missingFiles).toBe(0);
    expect(arg.memories[0]!.media).toHaveLength(2);
  });

  it("counts files that are not READY as missing (never naming them), so the person can add them again", async () => {
    media = [photo("p1", "mem_0"), photo("p2", "mem_0", { status: "PENDING", sortOrder: 1, originalFilename: "IMG_2231.MOV", mimeType: "video/quicktime" }), photo("p3", "mem_1", { status: "FAILED", originalFilename: "big.mp4", mimeType: "video/mp4" })];
    await completeSubmission({ claimTokens: [T(0), T(1), T(2)] }, { thumbnailWaitMs: 0 });
    const arg = lastSend();
    expect(arg.memories[0]!.missingFiles).toBe(1);
    expect(arg.memories[0]!.media).toHaveLength(1);
    expect(arg.memories[1]!.missingFiles).toBe(1);
    expect(arg.memories[2]!.missingFiles).toBe(0);
    // Fixed-content receipt (issue #46, D1): nothing the contributor typed reaches the email service.
    expect(JSON.stringify(arg)).not.toContain("IMG_2231.MOV");
    expect(JSON.stringify(arg)).not.toContain("big.mp4");
    expect(arg).not.toHaveProperty("name");
    expect(arg).not.toHaveProperty("relationship");
    for (const m of arg.memories) {
      expect(m).not.toHaveProperty("note");
      expect(m).not.toHaveProperty("approxDateText");
      expect(m).not.toHaveProperty("place");
      for (const file of m.media) {
        expect(file).not.toHaveProperty("originalFilename");
      }
    }
  });

  it("maps already_sent and in_progress to emailed, other skips and errors to not emailed, and never throws", async () => {
    sendMock.mockResolvedValueOnce({ sent: false, skipped: "already_sent" });
    expect(await completeSubmission({ claimTokens: [T(0), T(1), T(2)] }, { thumbnailWaitMs: 0 })).toEqual({ ok: true, emailed: true });
    sendMock.mockResolvedValueOnce({ sent: false, skipped: "in_progress" });
    expect(await completeSubmission({ claimTokens: [T(0), T(1), T(2)] }, { thumbnailWaitMs: 0 })).toEqual({ ok: true, emailed: true });
    sendMock.mockResolvedValueOnce({ sent: false, skipped: "recipient_capped" });
    expect(await completeSubmission({ claimTokens: [T(0), T(1), T(2)] }, { thumbnailWaitMs: 0 })).toEqual({ ok: true, emailed: false });
    sendMock.mockRejectedValueOnce(new Error("sendgrid down"));
    expect(await completeSubmission({ claimTokens: [T(0), T(1), T(2)] }, { thumbnailWaitMs: 0 })).toEqual({ ok: true, emailed: false });
    for (const m of memories) { m.contributor = { ...contributor, email: null }; }
    expect(await completeSubmission({ claimTokens: [T(0), T(1), T(2)] }, { thumbnailWaitMs: 0 })).toEqual({ ok: true, emailed: false });
  });

  it("schedules one admin alert per live memory after the response, none before", async () => {
    memories[1]!.deletedAt = new Date();
    await completeSubmission({ claimTokens: [T(0), T(2)] }, { thumbnailWaitMs: 0 });
    expect(notifyMock).not.toHaveBeenCalled();
    expect(afterCalls.length).toBeGreaterThan(0);
    for (const cb of afterCalls) { await cb(); }
    expect(notifyMock.mock.calls.map((c) => c[0])).toEqual(["mem_0", "mem_2"]);
  });
});

describe("confirmSubmission (cron path)", () => {
  it("returns leased while the anchor's lease is live and touches nothing", async () => {
    memories[0]!.uploadLeaseUntil = new Date(Date.now() + 60_000);
    expect(await confirmSubmission({ anchorId: "mem_0" })).toEqual({ sent: false, skipped: "leased" });
    expect(sendMock).not.toHaveBeenCalled();
    expect(recordMediaMock).not.toHaveBeenCalled();
  });

  it("after expiry it re-checks PENDING rows, sends with the missing files counted, and rotates every live token in a pinned order", async () => {
    memories[0]!.uploadLeaseUntil = new Date(Date.now() - 1_000);
    media = [
      photo("p1", "mem_0", { status: "PENDING", originalFilename: "landed.jpg" }),
      photo("p2", "mem_2", { status: "PENDING", originalFilename: "lost.mov", mimeType: "video/quicktime" }),
    ];
    recordMediaMock.mockImplementation(async ({ mediaId }) => {
      const row = media.find((m) => m.id === mediaId)!;
      if (mediaId === "p1") { row.status = "READY"; }
      return { status: row.status, mediaId, memoryId: row.memoryId, sizeBytes: 1 };
    });
    const before = memories.map((m) => m.claimTokenHash);
    const result = await confirmSubmission({ anchorId: "mem_0" });
    expect(result).toEqual({ sent: true, messageId: "m1" });
    expect(recordMediaMock.mock.calls.map((c) => c[0].mediaId).sort()).toEqual(["p1", "p2"]);
    const arg = lastSend();
    expect(arg.memories[0]!.media).toHaveLength(1);
    expect(arg.memories[0]!.missingFiles).toBe(0);
    expect(arg.memories[2]!.missingFiles).toBe(1);
    expect(arg.rotations?.map((r) => r.memoryId)).toEqual(["mem_0", "mem_1", "mem_2"]);
    for (const [i, rotation] of arg.rotations!.entries()) {
      const token = arg.memories[i]!.claimLink.split("/m/")[1]!;
      expect(rotation.claimTokenHash).toBe(hashClaimToken(token));
      expect(rotation.claimTokenHash).not.toBe(before[i]);
    }
    // The service commits the rotations with SENT; the feature itself writes no hash.
    expect(dbStub.$transaction).not.toHaveBeenCalled();
  });

  it("gives a soft-deleted memory no link and no rotation, keeps a wordless fileless memory, and skips terminally when nothing is live", async () => {
    memories[1]!.deletedAt = new Date();
    memories[2]!.contributorNote = null;
    await confirmSubmission({ anchorId: "mem_0" });
    const arg = lastSend();
    expect(arg.memories.map((m) => m.position)).toEqual([1, 3]);
    expect(arg.rotations?.map((r) => r.memoryId)).toEqual(["mem_0", "mem_2"]);
    expect(arg.memories[1]!.hasWords).toBe(false);
    expect(arg.memories[0]!.hasWords).toBe(true);

    sendMock.mockClear();
    memories[0]!.deletedAt = new Date();
    await confirmSubmission({ anchorId: "mem_0" });
    expect(lastSend().anchorMemoryId).toBe("mem_0");
    expect(lastSend().memories.map((m) => m.position)).toEqual([3]);

    sendMock.mockClear();
    memories[2]!.deletedAt = new Date();
    expect(await confirmSubmission({ anchorId: "mem_0" })).toEqual({ sent: false, skipped: "nothing_to_send" });
    expect(sendMock).not.toHaveBeenCalled();
    expect(skipMock).toHaveBeenCalledWith(expect.objectContaining({ memoryId: "mem_0", emailType: "SUBMISSION_CONFIRMATION", reason: "nothing_to_send" }));
  });

  it("refuses a memory that is not an anchor, an unknown id, and a send with no address", async () => {
    expect(await confirmSubmission({ anchorId: "mem_1" })).toEqual({ sent: false, skipped: "not_found" });
    expect(await confirmSubmission({ anchorId: "nope" })).toEqual({ sent: false, skipped: "not_found" });
    memories.push(mem(7, { id: "legacy", submissionId: null, submissionIndex: null }));
    expect(await confirmSubmission({ anchorId: "legacy" })).toEqual({ sent: false, skipped: "not_found" });
    for (const m of memories) { m.contributor = { ...contributor, email: null }; }
    expect(await confirmSubmission({ anchorId: "mem_0" })).toEqual({ sent: false, skipped: "no_email" });
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("Sentry identity, tags and metrics (plan §8.2)", () => {
  it("completeSubmission tags the send; confirmSubmission identifies the anchor's contributor once the rows are loaded and records the outcome", async () => {
    identifyMock.mockClear(); tagIdsMock.mockClear(); metricsMock.confirmationSent.mockClear();
    const result = await completeSubmission({ claimTokens: [T(0), T(1), T(2)] });
    expect(result).toEqual({ ok: true, emailed: true });
    expect(tagIdsMock).toHaveBeenCalledWith({ submissionId: "sub_1", memoryId: "mem_0" });
    expect(identifyMock).toHaveBeenCalledWith({ email: "kay@example.com", name: "Kay" });
    expect(metricsMock.confirmationSent).toHaveBeenCalledWith("sent");
  });

  it("records a skipped confirmation by its reason", async () => {
    metricsMock.confirmationSent.mockClear();
    memories[0]!.uploadLeaseUntil = new Date(Date.now() + 60 * 60_000);
    expect(await confirmSubmission({ anchorId: "mem_0" })).toEqual({ sent: false, skipped: "leased" });
    expect(metricsMock.confirmationSent).toHaveBeenCalledWith("leased");
  });
});
