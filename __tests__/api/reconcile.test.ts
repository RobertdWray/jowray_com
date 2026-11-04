import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/server/config/env";

const SECRET = "c".repeat(40);
const HOUR = 60 * 60 * 1000;

interface DerivedRow { kind: string; status: string; error: string | null; attempts: number; claimedAt: Date | null; storageKey: string }
interface MediaRow { id: string; memoryId: string; status: "PENDING" | "READY" | "FAILED"; checksumSha256: string | null; createdAt: Date; storageKey: string; blobUrl: string | null; deletedAt: Date | null; mimeType?: string; derivatives?: DerivedRow[]; memory: { deletedAt: Date | null } }
interface EventRow { id: string; processedAt: Date | null; attempts: number; error: string | null; payload: { tokenPayload: string | null } }
type EmailType = "MEMORY_CONFIRMATION" | "ADMIN_NEW_MEMORY";
interface EmailRow { id: string; memoryId: string; emailType: EmailType; status: "PENDING" | "SENT" | "FAILED" | "SKIPPED"; attempts: number; nextAttemptAt: Date | null; createdAt: Date; memory?: { deletedAt: Date | null } }
interface MemoryRow { id: string; type: string; status?: "DRAFT" | "PENDING" | "APPROVED" | "HIDDEN"; source?: "WEB_UPLOAD" | "EMAIL" | "SMS" | "OTHER" | "PHONE_CALL"; deletedAt: Date | null; createdAt: Date; contributorNote?: string | null; contributor: { email: string | null } | null; media: Array<{ status: string; deletedAt: Date | null; createdAt?: Date }>; emails: EmailRow[] }

let media: MediaRow[] = [];
let events: EventRow[] = [];
let emails: EmailRow[] = [];
let memories: MemoryRow[] = [];

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "memory") { return matches(row.memory as Record<string, unknown>, v as Record<string, unknown>); }
    if (k === "NOT") { return !matches(row, v as Record<string, unknown>); }
    if (k === "OR") { return (v as Record<string, unknown>[]).some((w) => matches(row, w)); }
    if (k === "AND") { return (v as Record<string, unknown>[]).every((w) => matches(row, w)); }
    if (k === "emails") { const n = v as { none?: Record<string, unknown> }; return n.none !== undefined ? !(row.emails as Record<string, unknown>[]).some((e) => matches(e, n.none!)) : true; }
    if (k === "media") { const s = v as { some?: Record<string, unknown> }; return s.some ? (row.media as Record<string, unknown>[]).some((m) => matches(m, s.some!)) : true; }
    if (k === "derivatives") { const d = v as { some?: Record<string, unknown>; none?: Record<string, unknown> }; const rows = (row.derivatives as Record<string, unknown>[] | undefined) ?? []; if (d.none) { return !rows.some((r) => matches(r, d.none!)); } if (d.some) { return rows.some((r) => matches(r, d.some!)); } return true; }
    if (k === "contributor") { const c = v as { email?: { not: null } }; if (c.email?.not !== null) { return true; } const email = (row.contributor as { email: string | null } | null)?.email; return email !== null && email !== undefined; }
    const actual = row[k];
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const cond = v as { lt?: Date; lte?: Date; gt?: Date; gte?: Date; not?: unknown; startsWith?: string; in?: unknown[] };
      if (cond.in !== undefined && !cond.in.includes(actual)) { return false; }
      if (cond.lt !== undefined && !((actual as Date) < cond.lt)) { return false; }
      if (cond.gte !== undefined && !((actual as Date) >= cond.gte)) { return false; }
      if (cond.lte !== undefined && !((actual as Date) <= cond.lte)) { return false; }
      if (cond.gt !== undefined && !((actual as Date) > cond.gt)) { return false; }
      if ("not" in cond && actual === cond.not) { return false; }
      if ("startsWith" in cond && typeof actual === "string" && !actual.startsWith(cond.startsWith as string)) { return false; }
      return true;
    }
    return actual === v;
  });
}
function finder<T extends Record<string, unknown>>(rows: () => T[]) {
  return vi.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) => rows().filter((r) => matches(r, where)).slice(0, take ?? 1000));
}
const derivedDeletes: Array<Record<string, unknown>> = [];
/** Fixture rows are /share memories unless a row says otherwise (the real columns are NOT NULL). */
function shareMemory(row: MemoryRow): MemoryRow {
  return { status: "PENDING", source: "WEB_UPLOAD", ...row };
}
const dbStub = {
  // Prisma always returns `derivatives` as an array when it is included; fixtures may omit it.
  media: { findMany: vi.fn(async (args: { where: Record<string, unknown>; take?: number }) => (await finder(() => media as unknown as Record<string, unknown>[])(args)).map((r) => ({ derivatives: [], mimeType: "image/jpeg", ...r }))), update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MediaRow> }) => { Object.assign(media.find((m) => m.id === where.id)!, data); }) },
  derivedMedia: { deleteMany: vi.fn(async ({ where }: { where: { mediaId: string; storageKey?: { in: string[] } } }) => { derivedDeletes.push(where); const m = media.find((x) => x.id === where.mediaId); if (m?.derivatives) { m.derivatives = m.derivatives.filter((d) => where.storageKey ? !where.storageKey.in.includes(d.storageKey) : false); } return { count: 1 }; }) },
  webhookEvent: { findMany: finder(() => events as unknown as Record<string, unknown>[]), update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<EventRow> }) => { Object.assign(events.find((e) => e.id === where.id)!, data); }) },
  emailLog: { findMany: finder(() => emails as unknown as Record<string, unknown>[]) },
  memory: { findMany: finder(() => memories.map(shareMemory) as unknown as Record<string, unknown>[]) },
};
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));

type RecordOutcome = { status: "READY"; mediaId: string; memoryId: string; sizeBytes: number } | { status: "PENDING"; mediaId: string; memoryId: string };
const recordMediaMock = vi.fn(async ({ mediaId }: { mediaId: string }): Promise<RecordOutcome> => ({ status: "READY", mediaId, memoryId: "mem_1", sizeBytes: 5 }));
const checksumMock = vi.fn(async ({ mediaId }: { mediaId: string }) => { media.find((m) => m.id === mediaId)!.checksumSha256 = "a".repeat(64); return "a".repeat(64); });
vi.mock("@/features/memories/ingest-upload", () => ({ recordMedia: (a: { mediaId: string }) => recordMediaMock(a), computeChecksum: (a: { mediaId: string }) => checksumMock(a) }));
/** Records a SENT row of one type for the memory (or flips its existing row of that type to SENT), like the real service. */
function recordSent(memoryId: string, emailType: EmailType) {
  const existing = emails.find((e) => e.memoryId === memoryId && e.emailType === emailType);
  if (existing) { existing.status = "SENT"; } else { emails.push({ id: `log_${emailType}_${memoryId}`, memoryId, emailType, status: "SENT", attempts: 1, nextAttemptAt: null, createdAt: new Date(), memory: { deletedAt: null } }); }
  const mem = memories.find((m) => m.id === memoryId);
  if (mem) { mem.emails = emails.filter((e) => e.memoryId === memoryId); }
  return { sent: true };
}
const confirmMock = vi.fn(async ({ memoryId }: { memoryId: string }) => recordSent(memoryId, "MEMORY_CONFIRMATION"));
vi.mock("@/features/memories/confirm", () => ({ confirmMemory: (a: { memoryId: string }) => confirmMock(a) }));
// The activation cutoff is a day in the past here so the fixtures (created 2 h ago) fall after it; the real constant is the merge day.
const ADMIN_ALERT_SINCE = vi.hoisted(() => new Date(Date.now() - 24 * 60 * 60 * 1000));
const notifyMock = vi.fn(async ({ memoryId }: { memoryId: string }) => recordSent(memoryId, "ADMIN_NEW_MEMORY"));
vi.mock("@/features/memories/notify-admins", () => ({ ADMIN_ALERT_SINCE, notifyAdminsOfMemory: (a: { memoryId: string }) => notifyMock(a) }));
const deriveMediaMock = vi.fn(async ({ mediaId }: { mediaId: string; deadlineMs: number }) => { const m = media.find((x) => x.id === mediaId)!; m.derivatives = [{ kind: "WEB_IMAGE", status: "READY", error: null, attempts: 1, claimedAt: new Date(), storageKey: "dev/derived/x/a.jpg" }, { kind: "THUMBNAIL", status: "READY", error: null, attempts: 1, claimedAt: new Date(), storageKey: "dev/derived/x/b.jpg" }]; return { WEB_IMAGE: "derived", THUMBNAIL: "derived" }; });
vi.mock("@/features/memories/derive-media", async (importOriginal) => { const actual = await importOriginal<Record<string, unknown>>(); return { ...actual, deriveMedia: (a: { mediaId: string; deadlineMs: number }) => deriveMediaMock(a) }; });
const delMock = vi.fn();
vi.mock("@/services/storage", () => ({ createStorageService: () => ({ del: delMock, head: vi.fn(), get: vi.fn(), put: vi.fn(), presignGet: vi.fn() }) }));

import { GET } from "@/app/api/cron/reconcile-uploads/route";

function run(auth?: string) {
  return GET(new NextRequest("http://localhost:3000/api/cron/reconcile-uploads", { headers: auth ? { authorization: auth } : {} }));
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  resetEnvCache();
  const old = new Date(Date.now() - 2 * HOUR);
  const ancient = new Date(Date.now() - 30 * HOUR);
  media = [
    { id: "med_stale", memoryId: "mem_1", status: "PENDING", checksumSha256: null, createdAt: old, storageKey: "originals/mem_1/a", blobUrl: "u", deletedAt: null, memory: { deletedAt: null } },
    { id: "med_fresh", memoryId: "mem_1", status: "PENDING", checksumSha256: null, createdAt: new Date(), storageKey: "originals/mem_1/b", blobUrl: "u", deletedAt: null, memory: { deletedAt: null } },
    { id: "med_orphan", memoryId: "mem_2", status: "PENDING", checksumSha256: null, createdAt: ancient, storageKey: "originals/mem_2/c", blobUrl: "u", deletedAt: null, memory: { deletedAt: null } },
    { id: "med_nohash", memoryId: "mem_1", status: "READY", checksumSha256: null, createdAt: old, storageKey: "originals/mem_1/d", blobUrl: "u", deletedAt: null, memory: { deletedAt: null } },
    { id: "med_gone", memoryId: "mem_3", status: "READY", checksumSha256: "b".repeat(64), createdAt: old, storageKey: "dev/originals/mem_3/0f6a1c7e-3f1a-4b5e-9c2d-1234567890ab.jpg", blobUrl: "u", deletedAt: null, mimeType: "image/jpeg", derivatives: [{ kind: "WEB_IMAGE", status: "READY", error: null, attempts: 1, claimedAt: ancient, storageKey: "dev/derived/mem_3/w.jpg" }, { kind: "THUMBNAIL", status: "FAILED", error: "too_large", attempts: 1, claimedAt: ancient, storageKey: "dev/derived/mem_3/t.jpg" }], memory: { deletedAt: ancient } },
    // Already purged last run (no blob, no derivatives): must not be selected again.
    { id: "med_gone_done", memoryId: "mem_3", status: "READY", checksumSha256: "b".repeat(64), createdAt: old, storageKey: "dev/originals/mem_3/done.jpg", blobUrl: null, deletedAt: null, mimeType: "image/jpeg", derivatives: [], memory: { deletedAt: ancient } },
    // Removed file whose copy is being (re)made right now: the fresh claim is left for the worker to finish.
    { id: "med_removed_claimed", memoryId: "mem_1", status: "READY", checksumSha256: null, createdAt: old, storageKey: "dev/originals/mem_1/claimed.jpg", blobUrl: null, deletedAt: old, mimeType: "image/jpeg", derivatives: [{ kind: "WEB_IMAGE", status: "PENDING", error: null, attempts: 1, claimedAt: new Date(), storageKey: "dev/derived/mem_1/fresh.jpg" }], memory: { deletedAt: null } },
    // A row copied from production into this branch: its blob must never be touched from here.
    { id: "med_prod_copy", memoryId: "mem_9", status: "READY", checksumSha256: "c".repeat(64), createdAt: old, storageKey: "originals/mem_9/f", blobUrl: "u", deletedAt: null, memory: { deletedAt: ancient } },
    // Removed through the claim page: never re-recorded or hashed; its blob is purged from this environment.
    { id: "med_cancelled", memoryId: "mem_1", status: "PENDING", checksumSha256: null, createdAt: old, storageKey: "dev/originals/mem_1/g", blobUrl: null, deletedAt: old, memory: { deletedAt: null } },
    { id: "med_removed", memoryId: "mem_1", status: "READY", checksumSha256: null, createdAt: old, storageKey: "dev/originals/mem_1/h", blobUrl: "u", deletedAt: old, memory: { deletedAt: null } },
    // (g) candidates: a READY photo in this environment without copies; one with copies; one whose claim went stale; one from production (never from here)
    { id: "med_photo_new", memoryId: "mem_1", status: "READY", checksumSha256: "d".repeat(64), createdAt: old, storageKey: "dev/originals/mem_1/p1.heic", blobUrl: "u", deletedAt: null, mimeType: "image/heic", derivatives: [], memory: { deletedAt: null } },
    { id: "med_photo_done", memoryId: "mem_1", status: "READY", checksumSha256: "d".repeat(64), createdAt: old, storageKey: "dev/originals/mem_1/p2.jpg", blobUrl: "u", deletedAt: null, mimeType: "image/jpeg", derivatives: [{ kind: "WEB_IMAGE", status: "READY", error: null, attempts: 1, claimedAt: old, storageKey: "dev/derived/mem_1/w.jpg" }, { kind: "THUMBNAIL", status: "READY", error: null, attempts: 1, claimedAt: old, storageKey: "dev/derived/mem_1/t.jpg" }], memory: { deletedAt: null } },
    { id: "med_photo_stale", memoryId: "mem_1", status: "READY", checksumSha256: "d".repeat(64), createdAt: old, storageKey: "dev/originals/mem_1/p3.png", blobUrl: "u", deletedAt: null, mimeType: "image/png", derivatives: [{ kind: "WEB_IMAGE", status: "PENDING", error: null, attempts: 1, claimedAt: old, storageKey: "dev/derived/mem_1/s.png" }, { kind: "THUMBNAIL", status: "READY", error: null, attempts: 1, claimedAt: old, storageKey: "dev/derived/mem_1/t3.jpg" }], memory: { deletedAt: null } },
    { id: "med_photo_terminal", memoryId: "mem_1", status: "READY", checksumSha256: "d".repeat(64), createdAt: old, storageKey: "dev/originals/mem_1/p4.jpg", blobUrl: "u", deletedAt: null, mimeType: "image/jpeg", derivatives: [{ kind: "WEB_IMAGE", status: "FAILED", error: "too_many_pixels:30000000", attempts: 1, claimedAt: old, storageKey: "dev/derived/mem_1/f.jpg" }, { kind: "THUMBNAIL", status: "FAILED", error: "too_large", attempts: 1, claimedAt: old, storageKey: "dev/derived/mem_1/f2.jpg" }], memory: { deletedAt: null } },
    { id: "med_photo_nullclaim", memoryId: "mem_1", status: "READY", checksumSha256: "d".repeat(64), createdAt: old, storageKey: "dev/originals/mem_1/p5.jpg", blobUrl: "u", deletedAt: null, mimeType: "image/jpeg", derivatives: [{ kind: "WEB_IMAGE", status: "PENDING", error: null, attempts: 1, claimedAt: null, storageKey: "dev/derived/mem_1/n.jpg" }, { kind: "THUMBNAIL", status: "READY", error: null, attempts: 1, claimedAt: old, storageKey: "dev/derived/mem_1/t5.jpg" }], memory: { deletedAt: null } },
    { id: "med_photo_prod", memoryId: "mem_9", status: "READY", checksumSha256: "d".repeat(64), createdAt: old, storageKey: "originals/mem_9/p.heic", blobUrl: "u", deletedAt: null, mimeType: "image/heic", derivatives: [], memory: { deletedAt: null } },
    // Cancelled minutes ago: its Blob token is still valid, so the pathname is left alone until the grace period passes.
    { id: "med_cancelled_fresh", memoryId: "mem_1", status: "READY", checksumSha256: null, createdAt: new Date(), storageKey: "dev/originals/mem_1/i", blobUrl: "u", deletedAt: new Date(), memory: { deletedAt: null } },
  ];
  events = [{ id: "evt_1", processedAt: null, attempts: 1, error: "boom", payload: { tokenPayload: JSON.stringify({ mediaId: "med_stale" }) } }];
  emails = [
    { id: "log_1", memoryId: "mem_4", emailType: "MEMORY_CONFIRMATION", status: "FAILED", attempts: 1, nextAttemptAt: old, createdAt: old, memory: { deletedAt: null } },
    { id: "log_gone", memoryId: "mem_gone", emailType: "MEMORY_CONFIRMATION", status: "FAILED", attempts: 1, nextAttemptAt: old, createdAt: old, memory: { deletedAt: ancient } },
    { id: "log_skipped", memoryId: "mem_skipped", emailType: "MEMORY_CONFIRMATION", status: "SKIPPED", attempts: 0, nextAttemptAt: null, createdAt: old, memory: { deletedAt: null } },
    // A failed admin alert is retried through the admin path, never the confirmation.
    { id: "log_admin_failed", memoryId: "mem_4", emailType: "ADMIN_NEW_MEMORY", status: "FAILED", attempts: 1, nextAttemptAt: old, createdAt: old, memory: { deletedAt: null } },
    // An admin row alone must not stop the contributor's confirmation (step (e) filters `none` by type).
    { id: "log_admin_only", memoryId: "mem_adminonly", emailType: "ADMIN_NEW_MEMORY", status: "SENT", attempts: 1, nextAttemptAt: null, createdAt: old, memory: { deletedAt: null } },
  ];
  memories = [
    { id: "mem_4", type: "PHOTO", deletedAt: null, createdAt: old, contributor: { email: "a@example.com" }, media: [{ status: "READY", deletedAt: null }], emails: [emails[0]!, emails[3]!] },
    { id: "mem_adminonly", type: "PHOTO", deletedAt: null, createdAt: old, contributor: { email: "g@example.com" }, media: [{ status: "READY", deletedAt: null }], emails: [emails[4]!] },
    // No contributor address: the confirmation cannot go, the admin alert must.
    { id: "mem_noemail", type: "PHOTO", deletedAt: null, createdAt: old, contributor: { email: null }, media: [{ status: "READY", deletedAt: null }], emails: [] },
    // Words saved, upload still in flight (20 minutes): the alert waits for the file.
    { id: "mem_pending_upload", type: "VIDEO", deletedAt: null, createdAt: old, contributorNote: "words", contributor: { email: null }, media: [{ status: "PENDING", deletedAt: null, createdAt: new Date(Date.now() - 20 * 60 * 1000) }], emails: [] },
    // Existed before the alert feature: never announced as new.
    { id: "mem_before_cutoff", type: "PHOTO", deletedAt: null, createdAt: new Date(ADMIN_ALERT_SINCE.getTime() - HOUR), contributor: { email: null }, media: [{ status: "READY", deletedAt: null }], emails: [] },
    { id: "mem_5", type: "PHOTO", deletedAt: null, createdAt: old, contributor: { email: "b@example.com" }, media: [{ status: "READY", deletedAt: null }], emails: [] },
    { id: "mem_young", type: "PHOTO", deletedAt: null, createdAt: new Date(), contributor: { email: "c@example.com" }, media: [{ status: "READY", deletedAt: null }], emails: [] },
    { id: "mem_gone", type: "PHOTO", deletedAt: ancient, createdAt: old, contributor: { email: "d@example.com" }, media: [{ status: "READY", deletedAt: null }], emails: [emails[1]!] },
    { id: "mem_skipped", type: "PHOTO", deletedAt: null, createdAt: old, contributor: { email: "e@example.com" }, media: [{ status: "READY", deletedAt: null }], emails: [emails[2]!] },
    // Its only READY file was removed and it has no words: nothing to confirm.
    { id: "mem_emptied", type: "PHOTO", deletedAt: null, createdAt: old, contributorNote: null, contributor: { email: "f@example.com" }, media: [{ status: "READY", deletedAt: old }], emails: [] },
    // Drafted by the admin on a sender's behalf and not yet shared: no confirmation (Rob's reply is the only message;
    // a cron confirmation would also rotate the token and kill the link he sent) and no admin alert (Rob made it).
    { id: "mem_draft", type: "TEXT", status: "DRAFT", source: "EMAIL", deletedAt: null, createdAt: old, contributorNote: "words from a condolence note", contributor: { email: "h@example.com" }, media: [], emails: [] },
    // The same memory after the person pressed Share: still no site confirmation, but the admins are told it landed.
    { id: "mem_draft_shared", type: "TEXT", status: "PENDING", source: "EMAIL", deletedAt: null, createdAt: old, contributorNote: "words from a condolence note", contributor: { email: "i@example.com" }, media: [], emails: [] },
    // Drafted and shared within the same half hour: no request-path alert exists for a Share, so the 30-minute
    // "finalize may still be running" wait does not apply; the admins hear on the next run.
    { id: "mem_draft_shared_young", type: "TEXT", status: "PENDING", source: "EMAIL", deletedAt: null, createdAt: new Date(), contributorNote: "words", contributor: { email: "j@example.com" }, media: [], emails: [] },
  ];
  recordMediaMock.mockClear(); checksumMock.mockClear(); confirmMock.mockClear(); notifyMock.mockClear(); delMock.mockClear(); deriveMediaMock.mockClear(); derivedDeletes.length = 0;
  recordMediaMock.mockImplementation(async ({ mediaId }) => mediaId === "med_orphan" ? { status: "PENDING", mediaId, memoryId: "mem_2" } : { status: "READY", mediaId, memoryId: "mem_1", sizeBytes: 5 });
});

describe("GET /api/cron/reconcile-uploads", () => {
  it("401s without the bearer secret or with the wrong one, and fails closed when CRON_SECRET is unset", async () => {
    expect((await run()).status).toBe(401);
    expect((await run("Bearer nope")).status).toBe(401);
    delete process.env.CRON_SECRET; resetEnvCache();
    expect((await run(`Bearer ${SECRET}`)).status).toBe(401);
  });

  it("runs every step once and reports counts", async () => {
    const res = await run(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Record<string, number> };
    expect(body.success).toBe(true);
    // (a) stale PENDING (>1h) re-recorded; the fresh one untouched; the >24h orphan whose blob is still missing → FAILED
    // step (a) re-records both stale rows; step (c) replays med_stale once more from the event
    expect(new Set(recordMediaMock.mock.calls.map((c) => c[0].mediaId))).toEqual(new Set(["med_orphan", "med_stale"]));
    expect(recordMediaMock).toHaveBeenCalledTimes(3);
    expect(media.find((m) => m.id === "med_orphan")?.status).toBe("FAILED");
    // (b) checksum backfill
    expect(checksumMock).toHaveBeenCalledWith({ mediaId: "med_nohash" });
    // (c) unprocessed webhook events re-run
    expect(events[0]?.processedAt).toBeInstanceOf(Date);
    // (d) failed email retried (not for a deleted memory), (e) READY memory with email and no log confirmed
    // (not one younger than 30 minutes, not one with a terminal SKIPPED row)
    expect(confirmMock.mock.calls.map((c) => c[0].memoryId).sort()).toEqual(["mem_4", "mem_5", "mem_adminonly"]);
    // (d) the failed admin alert is retried through the admin path; (e2) ready memories without an admin row are
    // alerted (with or without a contributor address, and even when the contributor's confirmation was skipped),
    // not the young one, not the one with a 20-minute-old upload, not the pre-cutoff one
    expect(notifyMock.mock.calls.map((c) => c[0].memoryId).sort()).toEqual(["mem_4", "mem_5", "mem_draft_shared", "mem_draft_shared_young", "mem_noemail", "mem_skipped"]);
    expect(confirmMock.mock.calls.map((c) => c[0].memoryId)).not.toContain("mem_draft_shared_young");
    // admin-drafted memories: never confirmed by the site (DRAFT or shared), never alerted while DRAFT (see the fixture comments)
    expect(confirmMock.mock.calls.map((c) => c[0].memoryId)).not.toContain("mem_draft");
    expect(confirmMock.mock.calls.map((c) => c[0].memoryId)).not.toContain("mem_draft_shared");
    expect(notifyMock.mock.calls.map((c) => c[0].memoryId)).not.toContain("mem_draft");
    // removed rows are neither re-recorded (a) nor hashed (b)
    expect(recordMediaMock.mock.calls.map((c) => c[0].mediaId)).not.toContain("med_cancelled");
    expect(checksumMock).not.toHaveBeenCalledWith({ mediaId: "med_removed" });
    // (f) blobs of soft-deleted memories and of removed files deleted, this environment only
    expect(delMock).toHaveBeenCalledWith("dev/originals/mem_3/0f6a1c7e-3f1a-4b5e-9c2d-1234567890ab.jpg");
    // its derived copies (any non-fresh status) and its poster staging pathname go too, and the rows are dropped
    expect(delMock).toHaveBeenCalledWith("dev/derived/mem_3/w.jpg");
    expect(delMock).toHaveBeenCalledWith("dev/derived/mem_3/t.jpg");
    expect(derivedDeletes.some((w) => w.mediaId === "med_gone")).toBe(true);
    expect(media.find((m) => m.id === "med_gone")?.derivatives).toEqual([]);
    expect(delMock).not.toHaveBeenCalledWith("dev/derived/mem_1/fresh.jpg");
    expect(delMock).not.toHaveBeenCalledWith("dev/originals/mem_3/done.jpg");
    expect(delMock).toHaveBeenCalledWith("dev/originals/mem_1/h");
    expect(delMock).not.toHaveBeenCalledWith("originals/mem_9/f");
    expect(media.find((m) => m.id === "med_removed")?.blobUrl).toBeNull();
    // a cancelled reservation older than the Blob token lifetime: its pathname is deleted (idempotent) and the row leaves PENDING
    expect(delMock).toHaveBeenCalledWith("dev/originals/mem_1/g");
    expect(delMock).not.toHaveBeenCalledWith("dev/originals/mem_1/i");
    expect(media.find((m) => m.id === "med_cancelled")?.status).toBe("FAILED");
    // (g) derived copies: the photo without copies, the one with a stale claim and the one whose claim has no timestamp, this environment only, terminal failures left alone
    expect(deriveMediaMock.mock.calls.map((c) => c[0].mediaId).sort()).toEqual(["med_photo_new", "med_photo_nullclaim", "med_photo_stale"]);
    expect(deriveMediaMock.mock.calls[0]![0].deadlineMs).toBeLessThanOrEqual(30_000);
    expect(deriveMediaMock.mock.calls[0]![0].deadlineMs).toBeGreaterThan(25_000);
    // the staging pathname is only ever deleted for videos
    expect(delMock.mock.calls.map((c) => c[0] as string).filter((k) => k.endsWith(".upload.jpg"))).toEqual([]);
    expect(body.data).toMatchObject({ pendingRechecked: 2, orphansFailed: 1, checksumsComputed: 1, eventsReplayed: 1, emailsRetried: 2, confirmationsSent: 2, adminAlertsSent: 5, deletedBlobsRemoved: 3, derived: 3 });
  });

  it("alerts a failed upload only when words were saved, and never resends", async () => {
    const old = new Date(Date.now() - 2 * HOUR);
    memories.push(
      { id: "mem_failed_words", type: "VIDEO", deletedAt: null, createdAt: old, contributorNote: "the words were saved", contributor: { email: null }, media: [{ status: "FAILED", deletedAt: null, createdAt: old }], emails: [] },
      { id: "mem_failed_nowords", type: "VIDEO", deletedAt: null, createdAt: old, contributorNote: null, contributor: { email: null }, media: [{ status: "FAILED", deletedAt: null, createdAt: old }], emails: [] }
    );
    await run(`Bearer ${SECRET}`);
    expect(notifyMock).toHaveBeenCalledWith({ memoryId: "mem_failed_words" });
    expect(notifyMock).not.toHaveBeenCalledWith({ memoryId: "mem_failed_nowords" });
    notifyMock.mockClear();
    const res = await run(`Bearer ${SECRET}`);
    expect(notifyMock).not.toHaveBeenCalledWith({ memoryId: "mem_failed_words" });
    expect(((await res.json()) as { data: Record<string, number> }).data.adminAlertsSent).toBe(0);
  });

  it("alerts the admins once a pending upload lands, never while it is in flight", async () => {
    await run(`Bearer ${SECRET}`);
    expect(notifyMock).not.toHaveBeenCalledWith({ memoryId: "mem_pending_upload" });
    const pending = memories.find((m) => m.id === "mem_pending_upload")!;
    pending.media[0]!.status = "READY";
    notifyMock.mockClear();
    const res = await run(`Bearer ${SECRET}`);
    expect(notifyMock).toHaveBeenCalledWith({ memoryId: "mem_pending_upload" });
    expect(((await res.json()) as { data: Record<string, number> }).data.adminAlertsSent).toBe(1);
  });

  it("never announces a memory created before the alert feature was activated", async () => {
    await run(`Bearer ${SECRET}`);
    expect(notifyMock).not.toHaveBeenCalledWith({ memoryId: "mem_before_cutoff" });
    expect(memories.find((m) => m.id === "mem_before_cutoff")?.emails).toHaveLength(0);
  });

  it("is a no-op on a second run", async () => {
    await run(`Bearer ${SECRET}`);
    recordMediaMock.mockClear(); checksumMock.mockClear(); confirmMock.mockClear(); notifyMock.mockClear(); delMock.mockClear(); deriveMediaMock.mockClear(); derivedDeletes.length = 0;
    const res = await run(`Bearer ${SECRET}`);
    const body = (await res.json()) as { data: Record<string, number> };
    expect(checksumMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(delMock).not.toHaveBeenCalled();
    expect(deriveMediaMock).not.toHaveBeenCalled();
    expect(body.data.checksumsComputed).toBe(0);
    expect(body.data.confirmationsSent).toBe(0);
    expect(body.data.adminAlertsSent).toBe(0);
  });

  it("gives up on a webhook event after three attempts", async () => {
    events[0]!.attempts = 3;
    await run(`Bearer ${SECRET}`);
    expect(events[0]?.processedAt).toBeNull();
  });
});

describe("purge drains a backlog and never re-selects a tombstone", () => {
  it("51 removed files: 50 on the first run, 1 on the second, 0 on the third", async () => {
    const old = new Date(Date.now() - 2 * HOUR);
    media = Array.from({ length: 51 }, (_, i) => ({ id: `med_t${i}`, memoryId: "mem_t", status: "READY" as const, checksumSha256: null, createdAt: old, storageKey: `dev/originals/mem_t/${i}.jpg`, blobUrl: "u", deletedAt: old, mimeType: "image/jpeg", derivatives: [], memory: { deletedAt: null } }));
    events = []; emails = []; memories = [];
    const runs: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await run(`Bearer ${SECRET}`);
      runs.push(((await res.json()) as { data: { deletedBlobsRemoved: number } }).data.deletedBlobsRemoved);
    }
    expect(runs).toEqual([50, 1, 0]);
    expect(media.every((m) => m.blobUrl === null)).toBe(true);
  });
});

describe("step (g) budget", () => {
  it("hands each candidate only the time left in the step", async () => {
    const old = new Date(Date.now() - 2 * HOUR);
    media = ["a", "b", "c"].map((k) => ({ id: `med_${k}`, memoryId: "mem_1", status: "READY" as const, checksumSha256: "d".repeat(64), createdAt: old, storageKey: `dev/originals/mem_1/${k}.jpg`, blobUrl: "u", deletedAt: null, mimeType: "image/jpeg", derivatives: [], memory: { deletedAt: null } }));
    events = []; emails = []; memories = [];
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      deriveMediaMock.mockImplementation(async ({ mediaId }) => { vi.setSystemTime(Date.now() + 20_000); const m = media.find((x) => x.id === mediaId)!; m.derivatives = [{ kind: "WEB_IMAGE", status: "READY", error: null, attempts: 1, claimedAt: new Date(), storageKey: "k" }, { kind: "THUMBNAIL", status: "READY", error: null, attempts: 1, claimedAt: new Date(), storageKey: "k2" }]; return { WEB_IMAGE: "derived", THUMBNAIL: "derived" }; });
      await run(`Bearer ${SECRET}`);
      const budgets = deriveMediaMock.mock.calls.map((c) => c[0].deadlineMs);
      expect(budgets).toHaveLength(2);
      expect(budgets[0]).toBeLessThanOrEqual(30_000);
      expect(budgets[1]).toBeLessThanOrEqual(10_000);
      expect(budgets[1]).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
