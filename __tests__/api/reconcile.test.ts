import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/server/config/env";

const SECRET = "c".repeat(40);
const HOUR = 60 * 60 * 1000;

interface DerivedRow { kind: string; status: string; error: string | null; attempts: number; claimedAt: Date | null; storageKey: string }
interface MediaRow { id: string; memoryId: string; status: "PENDING" | "READY" | "FAILED"; checksumSha256: string | null; createdAt: Date; storageKey: string; blobUrl: string | null; deletedAt: Date | null; purgedAt?: Date | null; reservedUntil?: Date | null; declaredSha256?: string | null; addedVia?: "ADMIN" | null; mimeType?: string; derivatives?: DerivedRow[]; gpsCheckedAt?: Date | null; gpsAttempts?: number; gpsClaimedAt?: Date | null; latitude?: number | null; longitude?: number | null; memory: { deletedAt: Date | null } }
interface EventRow { id: string; processedAt: Date | null; attempts: number; error: string | null; payload: { tokenPayload: string | null } }
type EmailType = "MEMORY_CONFIRMATION" | "ADMIN_NEW_MEMORY" | "SUBMISSION_CONFIRMATION";
interface EmailRow { errorMessage?: string | null; id: string; memoryId: string; emailType: EmailType; status: "PENDING" | "SENT" | "FAILED" | "SKIPPED"; attempts: number; nextAttemptAt: Date | null; createdAt: Date; memory?: { deletedAt: Date | null; uploadLeaseUntil?: Date | null } }
interface MemoryRow { id: string; type: string; status?: "DRAFT" | "PENDING" | "APPROVED" | "HIDDEN"; source?: "WEB_UPLOAD" | "EMAIL" | "SMS" | "OTHER" | "PHONE_CALL"; deletedAt: Date | null; createdAt: Date; contributorNote?: string | null; contributor: { email: string | null } | null; media: Array<{ status: string; deletedAt: Date | null; createdAt?: Date }>; emails: EmailRow[]; submissionId?: string | null; submissionIndex?: number | null; uploadLeaseUntil?: Date | null }

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
      // SQL: a comparison against NULL is never true; the old `null < Date` was true in JS and would "purge" live memories' media.
      if ((cond.lt !== undefined || cond.lte !== undefined || cond.gt !== undefined || cond.gte !== undefined) && (actual === null || actual === undefined)) { return false; }
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
/** Prisma's `orderBy` for one column (Dates or strings), stable for ties like the database's index order is for these fixtures. */
function ordered<T extends Record<string, unknown>>(rows: T[], orderBy?: Record<string, "asc" | "desc">): T[] {
  const [column, direction] = Object.entries(orderBy ?? {})[0] ?? [];
  if (column === undefined) {
    return rows;
  }
  const key = (row: T) => { const v = row[column]; return v instanceof Date ? v.getTime() : String(v); };
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => (key(a) < key(b) ? -sign : key(a) > key(b) ? sign : 0));
}
function finder<T extends Record<string, unknown>>(rows: () => T[]) {
  return vi.fn(async ({ where, orderBy, take }: { where: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc">; take?: number }) => ordered(rows().filter((r) => matches(r, where)), orderBy).slice(0, take ?? 1000));
}
const derivedDeletes: Array<Record<string, unknown>> = [];
/** Fixture rows are /share memories unless a row says otherwise (the real columns are NOT NULL). */
function shareMemory(row: MemoryRow): MemoryRow {
  return { status: "PENDING", source: "WEB_UPLOAD", ...row };
}
/** Phase 1 of the purge runs inside a transaction; storage calls must never happen there. */
let inTransaction = false;
/** Runs when the purge takes the memory lock (to simulate a Restore that committed just before). */
let onLock: ((memoryId: string) => void) | null = null;
const lockCalls: string[] = [];
const dbStub = {
  // Prisma always returns `derivatives` as an array when it is included, and every scalar; fixtures may omit `derivatives` and `purgedAt`.
  media: { updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<MediaRow> }) => { const rows = media.filter((m) => matches({ purgedAt: null, reservedUntil: null, ...m } as unknown as Record<string, unknown>, where)); for (const r of rows) { Object.assign(r, data); } return { count: rows.length }; }), findMany: vi.fn(async (args: { where: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc">; take?: number }) => (await finder(() => media.map((m) => ({ purgedAt: null, reservedUntil: null, gpsCheckedAt: null, gpsAttempts: 0, gpsClaimedAt: null, ...m })) as unknown as Record<string, unknown>[])(args)).map((r) => ({ derivatives: [], mimeType: "image/jpeg", ...r }))), update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<MediaRow> }) => { Object.assign(media.find((m) => m.id === where.id)!, data); }), findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => { const m = media.find((x) => x.id === where.id); if (!m) { throw new Error("not found"); } return { purgedAt: null, reservedUntil: null, latitude: null, longitude: null, gpsClaimedAt: null, ...m }; }) },
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => { lockCalls.push(String(values[0])); onLock?.(String(values[0])); return [{ id: values[0] }]; }),
  $transaction: vi.fn(async (fn: (t: typeof dbStub) => Promise<unknown>) => { inTransaction = true; try { return await fn(dbStub); } finally { inTransaction = false; } }),
  derivedMedia: { deleteMany: vi.fn(async ({ where }: { where: { mediaId: string; storageKey?: { in: string[] } } }) => { derivedDeletes.push(where); const m = media.find((x) => x.id === where.mediaId); if (m?.derivatives) { m.derivatives = m.derivatives.filter((d) => where.storageKey ? !where.storageKey.in.includes(d.storageKey) : false); } return { count: 1 }; }) },
  webhookEvent: { findMany: finder(() => events as unknown as Record<string, unknown>[]), update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<EventRow> }) => { Object.assign(events.find((e) => e.id === where.id)!, data); }) },
  // Prisma returns every scalar; fixtures may omit the submission columns and the lease (null = legacy row / no open submission)
  // and status/source (a /share memory unless the row says otherwise).
  emailLog: { findMany: vi.fn(async (args: { where: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc">; take?: number }) => finder(() => emails.map((e) => ({ ...e, memory: e.memory ? { uploadLeaseUntil: null, ...e.memory } : e.memory })) as unknown as Record<string, unknown>[])(args)) },
  memory: { findMany: finder(() => memories.map((m) => shareMemory({ submissionId: null, submissionIndex: null, uploadLeaseUntil: null, ...m })) as unknown as Record<string, unknown>[]) },
};
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));
const checkInMock = vi.fn((checkIn: { status: string; checkInId?: string }) => checkIn.checkInId ?? "checkin_1");
const isolationCalls: unknown[] = [];
const captureMessageMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: (...a: unknown[]) => captureMessageMock(...a),
  flush: vi.fn(async () => true),
  captureCheckIn: (...a: unknown[]) => checkInMock(...(a as [{ status: string; checkInId?: string }])),
  withIsolationScope: (cb: (scope: unknown) => unknown) => { const scope = { id: isolationCalls.length }; isolationCalls.push(scope); return cb(scope); },
}));
const reconcileRunMock = vi.fn();
vi.mock("@/lib/sentry/metrics", () => ({ reconcileRun: (...a: unknown[]) => reconcileRunMock(...a) }));

type RecordOutcome = { status: "READY"; mediaId: string; memoryId: string; sizeBytes: number } | { status: "PENDING"; mediaId: string; memoryId: string };
const recordMediaMock = vi.fn(async ({ mediaId }: { mediaId: string; signal?: AbortSignal }): Promise<RecordOutcome> => ({ status: "READY", mediaId, memoryId: "mem_1", sizeBytes: 5 }));
const checksumMock = vi.fn(async ({ mediaId }: { mediaId: string }) => { media.find((m) => m.id === mediaId)!.checksumSha256 = "a".repeat(64); return "a".repeat(64); });
vi.mock("@/features/memories/ingest-upload", () => ({ recordMedia: (a: { mediaId: string; signal?: AbortSignal }) => recordMediaMock(a), computeChecksum: (a: { mediaId: string }) => checksumMock(a) }));
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
/** Like the real `confirmSubmission`: answers `leased` while the anchor's lease is live, otherwise records the receipt. */
const confirmSubmissionMock = vi.fn(async ({ anchorId }: { anchorId: string }) => {
  const anchor = memories.find((m) => m.id === anchorId);
  if (anchor?.uploadLeaseUntil && anchor.uploadLeaseUntil.getTime() > Date.now()) { return { sent: false, skipped: "leased" }; }
  return recordSent(anchorId, "SUBMISSION_CONFIRMATION");
});
vi.mock("@/features/memories/complete-submission", () => ({ confirmSubmission: (a: { anchorId: string }) => confirmSubmissionMock(a) }));
const deriveMediaMock = vi.fn(async ({ mediaId }: { mediaId: string; deadlineMs: number }) => { const m = media.find((x) => x.id === mediaId)!; m.derivatives = [{ kind: "WEB_IMAGE", status: "READY", error: null, attempts: 1, claimedAt: new Date(), storageKey: "dev/derived/x/a.jpg" }, { kind: "THUMBNAIL", status: "READY", error: null, attempts: 1, claimedAt: new Date(), storageKey: "dev/derived/x/b.jpg" }]; return { WEB_IMAGE: "derived", THUMBNAIL: "derived" }; });
vi.mock("@/features/memories/derive-media", async (importOriginal) => { const actual = await importOriginal<Record<string, unknown>>(); return { ...actual, deriveMedia: (a: { mediaId: string; deadlineMs: number }) => deriveMediaMock(a) }; });
type PosterOutcome = "derived" | "failed" | "not_eligible" | "claimed_elsewhere" | "deferred";
/** Inert by default (the poster rows are the (g2) tests' business); `mockReset` restores this. */
const derivePosterMock = vi.fn(async (_a: { mediaId: string; deadlineMs: number }): Promise<PosterOutcome> => "not_eligible");
vi.mock("@/features/memories/derive-poster", () => ({ derivePoster: (a: { mediaId: string; deadlineMs: number }) => derivePosterMock(a) }));
type GpsOutcome = "found" | "absent" | "failed" | "skipped";
/** Like the real step: a decided outcome stamps the row (so the next run leaves it alone); failed/skipped leave it undecided. */
function decideGps(mediaId: string, outcome: GpsOutcome): GpsOutcome {
  if (outcome === "found" || outcome === "absent") { media.find((m) => m.id === mediaId)!.gpsCheckedAt = new Date(); }
  return outcome;
}
const extractGpsMock = vi.fn(async ({ mediaId }: { mediaId: string; deadlineMs?: number }): Promise<GpsOutcome> => decideGps(mediaId, "absent"));
vi.mock("@/features/media/extract-photo-gps", async (importOriginal) => { const actual = await importOriginal<Record<string, unknown>>(); return { ...actual, extractPhotoGps: (a: { mediaId: string; deadlineMs?: number }) => extractGpsMock(a) }; });
// The activation cutoff is a day in the past here so the fixtures (created 2 h ago) fall after it; the real constant is the merge day.
const ADMIN_ALERT_SINCE = vi.hoisted(() => new Date(Date.now() - 24 * 60 * 60 * 1000));
const notifyMock = vi.fn(async ({ memoryId }: { memoryId: string; previewsUntil?: number; previewsReadUntil?: number }) => recordSent(memoryId, "ADMIN_NEW_MEMORY"));
vi.mock("@/features/memories/notify-admins", () => ({ ADMIN_ALERT_SINCE, notifyAdminsOfMemory: (a: { memoryId: string; previewsReadUntil?: number }) => notifyMock(a) }));
const delMock = vi.fn(async (_key: string) => { if (inTransaction) { throw new Error("storage.del inside the purge transaction"); } });
/** The store answers head() for exactly one fixture: a blob that exists although recordMedia could not read its first bytes (#48's prefix check answered null). */
const headMock = vi.fn(async (key: string) => (key === "dev/originals/mem_2/present" ? { size: 5, contentType: "video/mp4", url: "u", uploadedAt: new Date() } : null));
vi.mock("@/services/storage", () => ({ createStorageService: () => ({ del: delMock, head: headMock, get: vi.fn(), put: vi.fn(), presignGet: vi.fn() }) }));

import { GET } from "@/app/api/cron/reconcile-uploads/route";
import { isEligible, MAX_PIXELS } from "@/features/memories/derived-claims";
import { ALLOWED_MIME_TYPES } from "@/lib/media-types";
import { MAX_VIDEO_PIXELS } from "@/lib/video-frames";

function run(auth?: string) {
  return GET(new NextRequest("http://localhost:3000/api/cron/reconcile-uploads", { headers: auth ? { authorization: auth } : {} }));
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  resetEnvCache();
  const old = new Date(Date.now() - 2 * HOUR);
  const ancient = new Date(Date.now() - 30 * HOUR);
  const longGone = new Date(Date.now() - 31 * 24 * HOUR);
  media = [
    { id: "med_stale", memoryId: "mem_1", status: "PENDING", checksumSha256: null, createdAt: old, storageKey: "originals/mem_1/a", blobUrl: "u", deletedAt: null, memory: { deletedAt: null } },
    { id: "med_fresh", memoryId: "mem_1", status: "PENDING", checksumSha256: null, createdAt: new Date(), storageKey: "originals/mem_1/b", blobUrl: "u", deletedAt: null, memory: { deletedAt: null } },
    { id: "med_orphan", memoryId: "mem_2", status: "PENDING", checksumSha256: null, createdAt: ancient, storageKey: "originals/mem_2/c", blobUrl: "u", deletedAt: null, memory: { deletedAt: null } },
    { id: "med_nohash", memoryId: "mem_1", status: "READY", checksumSha256: null, createdAt: old, storageKey: "originals/mem_1/d", blobUrl: "u", deletedAt: null, memory: { deletedAt: null } },
    { id: "med_gone", memoryId: "mem_3", status: "READY", checksumSha256: "b".repeat(64), createdAt: old, storageKey: "dev/originals/mem_3/0f6a1c7e-3f1a-4b5e-9c2d-1234567890ab.jpg", blobUrl: "u", deletedAt: null, mimeType: "image/jpeg", derivatives: [{ kind: "WEB_IMAGE", status: "READY", error: null, attempts: 1, claimedAt: ancient, storageKey: "dev/derived/mem_3/w.jpg" }, { kind: "THUMBNAIL", status: "FAILED", error: "too_large", attempts: 1, claimedAt: ancient, storageKey: "dev/derived/mem_3/t.jpg" }], memory: { deletedAt: longGone } },
    // Already purged last run (no blob, no derivatives): must not be selected again.
    { id: "med_gone_done", memoryId: "mem_3", status: "READY", checksumSha256: "b".repeat(64), createdAt: old, storageKey: "dev/originals/mem_3/done.jpg", blobUrl: null, deletedAt: null, mimeType: "image/jpeg", derivatives: [], memory: { deletedAt: longGone } },
    // Removed file whose copy is being (re)made right now: the fresh claim is left for the worker to finish.
    { id: "med_removed_claimed", memoryId: "mem_1", status: "READY", checksumSha256: null, createdAt: old, storageKey: "dev/originals/mem_1/claimed.jpg", blobUrl: null, deletedAt: old, mimeType: "image/jpeg", derivatives: [{ kind: "WEB_IMAGE", status: "PENDING", error: null, attempts: 1, claimedAt: new Date(), storageKey: "dev/derived/mem_1/fresh.jpg" }], memory: { deletedAt: null } },
    // A row copied from production into this branch: its blob must never be touched from here.
    { id: "med_prod_copy", memoryId: "mem_9", status: "READY", checksumSha256: "c".repeat(64), createdAt: old, storageKey: "originals/mem_9/f", blobUrl: "u", deletedAt: null, memory: { deletedAt: longGone } },
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
    // Its memory was deleted yesterday: the 30-day grace keeps the file until a Restore is no longer expected (C2).
    { id: "med_recent_delete", memoryId: "mem_rd", status: "READY", checksumSha256: "e".repeat(64), createdAt: old, storageKey: "dev/originals/mem_rd/r.jpg", blobUrl: "u", deletedAt: null, purgedAt: null, mimeType: "image/jpeg", derivatives: [], memory: { deletedAt: new Date(Date.now() - 24 * HOUR) } },
    // Cancelled minutes ago: its Blob token is still valid, so the pathname is left alone until the grace period passes.
    { id: "med_cancelled_fresh", memoryId: "mem_1", status: "READY", checksumSha256: null, createdAt: new Date(), storageKey: "dev/originals/mem_1/i", blobUrl: "u", deletedAt: new Date(), memory: { deletedAt: null } },
    // (issue #44) Orphans judged by their upload window, not their age. A day-old reservation of this environment with no
    // window recorded (old code) and no blob: FAILED, pathname deleted first. One re-ticketed recently (window open): left alone.
    // One whose window closed but is re-ticketed while the cron deletes the (empty) pathname: the conditional update must not fail it.
    { id: "med_orphan_env", memoryId: "mem_2", status: "PENDING", checksumSha256: null, createdAt: ancient, storageKey: "dev/originals/mem_2/o", blobUrl: null, deletedAt: null, memory: { deletedAt: null } },
    { id: "med_orphan_open", memoryId: "mem_2", status: "PENDING", checksumSha256: null, createdAt: ancient, storageKey: "dev/originals/mem_2/open", blobUrl: null, deletedAt: null, reservedUntil: new Date(Date.now() + 30 * 60 * 1000), memory: { deletedAt: null } },
    { id: "med_orphan_raced", memoryId: "mem_2", status: "PENDING", checksumSha256: null, createdAt: ancient, storageKey: "dev/originals/mem_2/raced", blobUrl: null, deletedAt: null, reservedUntil: new Date(Date.now() - 1000), memory: { deletedAt: null } },
    // The worst case (TCR #1/#12): the family's upload finishes and finalize flips the row READY right after step (a)'s
    // head() check said "no blob yet". The cron must claim the row (status still PENDING) before it deletes anything.
    { id: "med_orphan_finalized", memoryId: "mem_2", status: "PENDING", checksumSha256: null, createdAt: ancient, storageKey: "dev/originals/mem_2/finalized", blobUrl: null, deletedAt: null, reservedUntil: new Date(Date.now() - 1000), mimeType: "video/mp4", memory: { deletedAt: null } },
    // A blob that EXISTS but whose first bytes could not be read (#48's readPrefix answered null): recordMedia says PENDING, which is
    // the same answer as "no blob". Step (a) must ask the store itself and never claim or delete while the bytes are there.
    { id: "med_orphan_present", memoryId: "mem_2", status: "PENDING", checksumSha256: null, createdAt: ancient, storageKey: "dev/originals/mem_2/present", blobUrl: null, deletedAt: null, reservedUntil: new Date(Date.now() - 1000), mimeType: "video/mp4", memory: { deletedAt: null } },
    // (issue #44) Cancelled reservations are purged when their window has closed, however old the row is: a 2 h old one whose
    // last ticket is recent waits; one created minutes ago whose window already passed goes now.
    { id: "med_cancelled_window_open", memoryId: "mem_1", status: "PENDING", checksumSha256: null, createdAt: old, storageKey: "dev/originals/mem_1/wo", blobUrl: null, deletedAt: old, reservedUntil: new Date(Date.now() + 30 * 60 * 1000), memory: { deletedAt: null } },
    { id: "med_cancelled_window_closed", memoryId: "mem_1", status: "PENDING", checksumSha256: null, createdAt: new Date(), storageKey: "dev/originals/mem_1/wc", blobUrl: null, deletedAt: new Date(), reservedUntil: new Date(Date.now() - 1000), memory: { deletedAt: null } },
    // (f3, TCR #14) Rows retired recently get their pathname deleted again for two hours (a request that began before its token
    // expired may finish after it); one retired three hours ago and a production copy are left alone.
    { id: "med_retired_recent", memoryId: "mem_2", status: "FAILED", checksumSha256: null, createdAt: ancient, storageKey: "dev/originals/mem_2/retired", blobUrl: null, deletedAt: null, purgedAt: new Date(Date.now() - 30 * 60 * 1000), memory: { deletedAt: null } },
    { id: "med_retired_old", memoryId: "mem_2", status: "FAILED", checksumSha256: null, createdAt: ancient, storageKey: "dev/originals/mem_2/retired_old", blobUrl: null, deletedAt: null, purgedAt: new Date(Date.now() - 3 * HOUR), memory: { deletedAt: null } },
    { id: "med_retired_prod", memoryId: "mem_9", status: "FAILED", checksumSha256: null, createdAt: ancient, storageKey: "originals/mem_9/retired", blobUrl: null, deletedAt: null, purgedAt: new Date(Date.now() - 30 * 60 * 1000), memory: { deletedAt: null } },
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
    // (Task 15) An admin row on a send's anchor must not count as the send's receipt (step (e3) filters `none` by type).
    { id: "log_sub_admin", memoryId: "mem_sub0", emailType: "ADMIN_NEW_MEMORY", status: "SENT", attempts: 1, nextAttemptAt: null, createdAt: old, memory: { deletedAt: null } },
    // A failed receipt is retried through the submission path (d); one whose send is still leased waits.
    { id: "log_sub_failed", memoryId: "mem_subfail0", emailType: "SUBMISSION_CONFIRMATION", status: "FAILED", attempts: 1, nextAttemptAt: old, createdAt: old, memory: { deletedAt: null } },
    { id: "log_sub_leased", memoryId: "mem_live0", emailType: "SUBMISSION_CONFIRMATION", status: "FAILED", attempts: 1, nextAttemptAt: old, createdAt: old, memory: { deletedAt: null } },
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
    // (Task 15) A send whose lease has run out: (e) leaves both memories alone, (e3) emails the anchor once, (e2) alerts the sibling (the anchor already has its admin row).
    { id: "mem_sub0", type: "PHOTO", deletedAt: null, createdAt: old, contributor: { email: "s@example.com" }, media: [{ status: "READY", deletedAt: null }], emails: [emails[5]!], submissionId: "sub_1", submissionIndex: 0, uploadLeaseUntil: new Date(Date.now() - 5 * 60 * 1000) },
    { id: "mem_sub1", type: "PHOTO", deletedAt: null, createdAt: old, contributor: { email: "s@example.com" }, media: [{ status: "READY", deletedAt: null }], emails: [], submissionId: "sub_1", submissionIndex: 1, uploadLeaseUntil: null },
    // A send still under its lease: (e3) waits, (e2) waits for both memories, (d) gets `leased` back for its failed receipt.
    { id: "mem_live0", type: "PHOTO", deletedAt: null, createdAt: old, contributor: { email: "l@example.com" }, media: [{ status: "READY", deletedAt: null }], emails: [emails[7]!], submissionId: "sub_live", submissionIndex: 0, uploadLeaseUntil: new Date(Date.now() + 30 * 60 * 1000) },
    { id: "mem_live1", type: "PHOTO", deletedAt: null, createdAt: old, contributor: { email: "l@example.com" }, media: [{ status: "READY", deletedAt: null }], emails: [], submissionId: "sub_live", submissionIndex: 1, uploadLeaseUntil: null },
    // A failed receipt whose send is free again: retried through (d).
    { id: "mem_subfail0", type: "TEXT", deletedAt: null, createdAt: old, contributorNote: "words", contributor: { email: "x@example.com" }, media: [], emails: [emails[6]!], submissionId: "sub_fail", submissionIndex: 0, uploadLeaseUntil: null },
    // Anchors (e3) must leave alone: too young, and without an address.
    { id: "mem_subyoung0", type: "TEXT", deletedAt: null, createdAt: new Date(), contributorNote: "words", contributor: { email: "y@example.com" }, media: [], emails: [], submissionId: "sub_young", submissionIndex: 0, uploadLeaseUntil: null },
    { id: "mem_subnoemail0", type: "TEXT", deletedAt: null, createdAt: old, contributorNote: "words", contributor: { email: null }, media: [], emails: [], submissionId: "sub_noemail", submissionIndex: 0, uploadLeaseUntil: null },
    // Still sending files (lease open): neither (e) nor a retry in (d) may touch it yet.
    { id: "mem_leased", type: "PHOTO", deletedAt: null, createdAt: old, uploadLeaseUntil: new Date(Date.now() + 30 * 60 * 1000), contributor: { email: "g@example.com" }, media: [{ status: "READY", deletedAt: null }], emails: [] },
  ];
  emails.push({ id: "log_leased", memoryId: "mem_leased_retry", emailType: "MEMORY_CONFIRMATION", status: "FAILED", attempts: 1, nextAttemptAt: old, createdAt: old, memory: { deletedAt: null, uploadLeaseUntil: new Date(Date.now() + 30 * 60 * 1000) } });
  inTransaction = false; onLock = null; lockCalls.length = 0; delMock.mockReset(); delMock.mockImplementation(async () => { if (inTransaction) { throw new Error("storage.del inside the purge transaction"); } });
    recordMediaMock.mockClear(); checksumMock.mockClear(); confirmMock.mockClear(); confirmSubmissionMock.mockClear(); notifyMock.mockClear(); delMock.mockClear(); derivedDeletes.length = 0;
  // Reset, not clear: a test that swaps in its own implementation (the step (g) budget test advances the clock) must not leak it into the next test.
  deriveMediaMock.mockReset(); extractGpsMock.mockReset(); derivePosterMock.mockReset();
  recordMediaMock.mockImplementation(async ({ mediaId }) => {
    if (mediaId === "med_orphan_finalized") {
      // head() saw nothing; a finalize from the browser lands the moment after and records the file.
      Object.assign(media.find((m) => m.id === mediaId)!, { status: "READY", blobUrl: "u", sizeBytes: 5 });
      return { status: "PENDING", mediaId, memoryId: "mem_2" };
    }
    if (mediaId === "med_orphan_raced") {
      // A re-ticket commits between the cron's read and its claim: the window moved, so the claim must match nothing.
      media.find((m) => m.id === mediaId)!.reservedUntil = new Date(Date.now() + 60 * 60 * 1000);
      return { status: "PENDING", mediaId, memoryId: "mem_2" };
    }
    return mediaId.startsWith("med_orphan") ? { status: "PENDING", mediaId, memoryId: "mem_2" } : { status: "READY", mediaId, memoryId: "mem_1", sizeBytes: 5 };
  });
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
    expect(new Set(recordMediaMock.mock.calls.map((c) => c[0].mediaId))).toEqual(new Set(["med_orphan", "med_orphan_env", "med_orphan_open", "med_orphan_raced", "med_orphan_finalized", "med_orphan_present", "med_stale"]));
    expect(recordMediaMock).toHaveBeenCalledTimes(8);
    expect(media.find((m) => m.id === "med_orphan")?.status).toBe("FAILED");
    // (issue #44) a production copy's pathname is never touched from here; this environment's orphan is claimed (FAILED + purgedAt,
    // conditional on status and window) BEFORE its pathname is deleted (TCR #1/#12)
    expect(delMock).not.toHaveBeenCalledWith("originals/mem_2/c");
    expect(media.find((m) => m.id === "med_orphan_env")).toMatchObject({ status: "FAILED", purgedAt: expect.any(Date) });
    const claimIndex = (id: string) => dbStub.media.updateMany.mock.invocationCallOrder[dbStub.media.updateMany.mock.calls.findIndex((c) => (c[0] as unknown as { where: { id: string } }).where.id === id)]!;
    const deleteIndex = (key: string) => delMock.mock.invocationCallOrder[delMock.mock.calls.findIndex((c) => c[0] === key)]!;
    expect(claimIndex("med_orphan_env")).toBeLessThan(deleteIndex("dev/originals/mem_2/o"));
    // an orphan whose window is still open (a recent re-ticket) is neither failed nor deleted; a race lost to a re-ticket leaves the row PENDING
    expect(media.find((m) => m.id === "med_orphan_open")?.status).toBe("PENDING");
    expect(delMock).not.toHaveBeenCalledWith("dev/originals/mem_2/open");
    expect(media.find((m) => m.id === "med_orphan_raced")?.status).toBe("PENDING");
    expect(delMock).not.toHaveBeenCalledWith("dev/originals/mem_2/raced");
    // A file that was finalized a moment after the head() check keeps its bytes: the cron claims (status PENDING) before any delete.
    expect(media.find((m) => m.id === "med_orphan_finalized")).toMatchObject({ status: "READY", blobUrl: "u" });
    expect(delMock).not.toHaveBeenCalledWith("dev/originals/mem_2/finalized");
    // A blob the store still has is never claimed or deleted, whatever recordMedia could make of its bytes (#48 interaction).
    expect(headMock).toHaveBeenCalledWith("dev/originals/mem_2/present");
    expect(media.find((m) => m.id === "med_orphan_present")?.status).toBe("PENDING");
    expect(media.find((m) => m.id === "med_orphan_present")?.purgedAt ?? null).toBeNull();
    expect(delMock).not.toHaveBeenCalledWith("dev/originals/mem_2/present");
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
    // (Task 15) plus the sibling of a send whose lease ran out; nothing from the send still under its lease, and no sibling-less text anchors (they have no admin row yet but are alerted: mem_subfail0 and mem_subnoemail0 are ready text memories);
    // plus the two shared admin drafts (one of them younger than 30 minutes: a Share has no request-path alert to wait for)
    expect(notifyMock.mock.calls.map((c) => c[0].memoryId).sort()).toEqual(["mem_4", "mem_5", "mem_draft_shared", "mem_draft_shared_young", "mem_noemail", "mem_skipped", "mem_sub1", "mem_subfail0", "mem_subnoemail0"]);
    // (d) and (e2) load whatever previews exist and never wait for more: no wait deadline, only a read deadline (T14, R19).
    expect(notifyMock.mock.calls.every(([arg]) => Object.keys(arg).sort().join() === "memoryId,previewsReadUntil")).toBe(true);
    // admin-drafted memories: never confirmed by the site (DRAFT or shared), never alerted while DRAFT (see the fixture comments)
    expect(confirmMock.mock.calls.map((c) => c[0].memoryId)).not.toContain("mem_draft");
    expect(confirmMock.mock.calls.map((c) => c[0].memoryId)).not.toContain("mem_draft_shared");
    expect(confirmMock.mock.calls.map((c) => c[0].memoryId)).not.toContain("mem_draft_shared_young");
    expect(notifyMock.mock.calls.map((c) => c[0].memoryId)).not.toContain("mem_draft");
    // (e) never confirms a memory that belongs to a send
    expect(confirmMock.mock.calls.map((c) => c[0].memoryId)).not.toContain("mem_sub0");
    expect(confirmMock.mock.calls.map((c) => c[0].memoryId)).not.toContain("mem_sub1");
    // (d) retries the failed receipts through the submission path (the leased one answers `leased`); (e3) emails the free anchor once
    expect(confirmSubmissionMock.mock.calls.map((c) => c[0].anchorId).sort()).toEqual(["mem_live0", "mem_sub0", "mem_subfail0"]);
    expect(emails.find((e) => e.memoryId === "mem_sub0" && e.emailType === "SUBMISSION_CONFIRMATION")?.status).toBe("SENT");
    expect(emails.find((e) => e.id === "log_sub_failed")?.status).toBe("SENT");
    expect(emails.find((e) => e.id === "log_sub_leased")?.status).toBe("FAILED");
    // a submission still sending files (lease open) gets neither email from the cron yet
    expect(confirmMock.mock.calls.map((c) => c[0].memoryId)).not.toContain("mem_leased");
    expect(confirmMock.mock.calls.map((c) => c[0].memoryId)).not.toContain("mem_leased_retry");
    expect(notifyMock.mock.calls.map((c) => c[0].memoryId)).not.toContain("mem_leased");
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
    // the purge marks its intent (purgedAt, READY → FAILED) under the memory lock before the first delete, and leaves a memory deleted yesterday alone (C1, C2, C4)
    expect(media.find((m) => m.id === "med_gone")).toMatchObject({ purgedAt: expect.any(Date), status: "FAILED", blobUrl: null });
    expect(media.find((m) => m.id === "med_removed")).toMatchObject({ purgedAt: expect.any(Date), status: "FAILED" });
    expect(lockCalls).toEqual(expect.arrayContaining(["mem_3", "mem_1"]));
    expect(delMock).not.toHaveBeenCalledWith("dev/originals/mem_rd/r.jpg");
    expect(media.find((m) => m.id === "med_recent_delete")).toMatchObject({ purgedAt: null, status: "READY", blobUrl: "u" });
    // a cancelled reservation older than the Blob token lifetime: its pathname is deleted (idempotent) and the row leaves PENDING
    expect(delMock).toHaveBeenCalledWith("dev/originals/mem_1/g");
    expect(delMock).not.toHaveBeenCalledWith("dev/originals/mem_1/i");
    expect(media.find((m) => m.id === "med_cancelled")?.status).toBe("FAILED");
    // (issue #44) the window decides, not the age: a cancelled row with a recent ticket waits, one whose window passed goes now
    expect(delMock).not.toHaveBeenCalledWith("dev/originals/mem_1/wo");
    expect(media.find((m) => m.id === "med_cancelled_window_open")?.status).toBe("PENDING");
    expect(delMock).toHaveBeenCalledWith("dev/originals/mem_1/wc");
    expect(media.find((m) => m.id === "med_cancelled_window_closed")).toMatchObject({ status: "FAILED", purgedAt: expect.any(Date) });
    // (f2) also claims before it deletes
    expect(claimIndex("med_cancelled")).toBeLessThan(deleteIndex("dev/originals/mem_1/g"));
    // (f3) rows retired in the last two hours get their pathname deleted again; older ones and production copies do not
    expect(delMock).toHaveBeenCalledWith("dev/originals/mem_2/retired");
    expect(delMock).not.toHaveBeenCalledWith("dev/originals/mem_2/retired_old");
    expect(delMock).not.toHaveBeenCalledWith("originals/mem_9/retired");
    expect(body.data.lateSweeps).toBeGreaterThanOrEqual(1);
    // (g) derived copies: the photo without copies, the one with a stale claim and the one whose claim has no timestamp, this environment only, terminal failures left alone
    expect(deriveMediaMock.mock.calls.map((c) => c[0].mediaId).sort()).toEqual(["med_photo_new", "med_photo_nullclaim", "med_photo_stale"]);
    expect(deriveMediaMock.mock.calls[0]![0].deadlineMs).toBeLessThanOrEqual(30_000);
    expect(deriveMediaMock.mock.calls[0]![0].deadlineMs).toBeGreaterThan(25_000);
    // the staging pathname is only ever deleted for videos
    expect(delMock.mock.calls.map((c) => c[0] as string).filter((k) => k.endsWith(".upload.jpg"))).toEqual([]);
    // (h) GPS: every live READY photo or supported video of this environment whose GPS is undecided, whatever
    // state its copies are in, including the video finalized by (a); not deleted memories, removed files or production copies.
    expect(extractGpsMock.mock.calls.map((c) => c[0].mediaId).sort()).toEqual(["med_orphan_finalized", "med_photo_done", "med_photo_new", "med_photo_nullclaim", "med_photo_stale", "med_photo_terminal"]);
    // checksumsComputed 2: med_nohash, plus the file finalized during (a), which (b) hashes in the same run.
    expect(body.data).toMatchObject({ pendingRechecked: 7, orphansFailed: 2, checksumsComputed: 2, eventsReplayed: 1, emailsRetried: 3, confirmationsSent: 2, adminAlertsSent: 8, submissionReceiptsSent: 1, deletedBlobsRemoved: 4, derived: 3, gpsFound: 0, gpsAbsent: 6, gpsFailed: 0, gpsSkipped: 0, errors: 0 });
  });

  it("(e2) waits for a send's lease before alerting any of its memories, and (e3) emails the anchor once the lease is gone", async () => {
    await run(`Bearer ${SECRET}`);
    expect(notifyMock).not.toHaveBeenCalledWith(expect.objectContaining({ memoryId: "mem_live0" }));
    expect(notifyMock).not.toHaveBeenCalledWith(expect.objectContaining({ memoryId: "mem_live1" }));
    expect(emails.find((e) => e.id === "log_sub_leased")?.status).toBe("FAILED");
    memories.find((m) => m.id === "mem_live0")!.uploadLeaseUntil = new Date(Date.now() - 1_000);
    notifyMock.mockClear(); confirmSubmissionMock.mockClear();
    const res = await run(`Bearer ${SECRET}`);
    expect(notifyMock.mock.calls.map((c) => c[0].memoryId).sort()).toEqual(["mem_live0", "mem_live1"]);
    // The failed receipt row is retried by (d); (e3) does not select the anchor a second time because the row exists.
    expect(confirmSubmissionMock.mock.calls.map((c) => c[0].anchorId)).toEqual(["mem_live0"]);
    expect(emails.find((e) => e.id === "log_sub_leased")?.status).toBe("SENT");
    const body = (await res.json()) as { data: Record<string, number> };
    expect(body.data.emailsRetried).toBe(1);
    expect(body.data.submissionReceiptsSent).toBe(0);
  });

  it("(e3) picks only anchors at least 30 minutes old with an address, no live lease and no receipt row", async () => {
    await run(`Bearer ${SECRET}`);
    const receipts = confirmSubmissionMock.mock.calls.map((c) => c[0].anchorId);
    expect(receipts).toContain("mem_sub0");
    expect(receipts).not.toContain("mem_sub1");
    expect(receipts).not.toContain("mem_subyoung0");
    expect(receipts).not.toContain("mem_subnoemail0");
    expect(receipts).not.toContain("mem_live0_by_e3");
  });

  it("R19: bounds each alert's preview reads by its own 5 s and by the run deadline less the margin, so a storage stall cannot starve later steps", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const restore = notifyMock.getMockImplementation()!;
    try {
      const startedAt = Date.now();
      const calls: Array<{ memoryId: string; at: number; previewsReadUntil?: number; previewsUntil?: number }> = [];
      // Each alert takes 10 s (a stalled read would take its whole budget).
      notifyMock.mockImplementation(async (arg) => {
        calls.push({ ...arg, at: Date.now() });
        vi.setSystemTime(Date.now() + 10_000);
        return recordSent(arg.memoryId, "ADMIN_NEW_MEMORY");
      });
      expect((await run(`Bearer ${SECRET}`)).status).toBe(200);
      expect(calls.length).toBeGreaterThanOrEqual(5);
      for (const call of calls) {
        expect(call.previewsUntil).toBeUndefined();
        expect(call.previewsReadUntil).toBe(Math.min(call.at + 5_000, startedAt + 50_000 - 5_000));
      }
      // Late in the run the run deadline, not the 5 s, is the bound (and once it has passed, the alert reads nothing).
      expect(calls.some((call) => call.at + 5_000 > startedAt + 45_000)).toBe(true);
    } finally {
      notifyMock.mockImplementation(restore);
      vi.useRealTimers();
    }
  });

  it("alerts a failed upload only when words were saved, and never resends", async () => {
    const old = new Date(Date.now() - 2 * HOUR);
    memories.push(
      { id: "mem_failed_words", type: "VIDEO", deletedAt: null, createdAt: old, contributorNote: "the words were saved", contributor: { email: null }, media: [{ status: "FAILED", deletedAt: null, createdAt: old }], emails: [] },
      { id: "mem_failed_nowords", type: "VIDEO", deletedAt: null, createdAt: old, contributorNote: null, contributor: { email: null }, media: [{ status: "FAILED", deletedAt: null, createdAt: old }], emails: [] }
    );
    await run(`Bearer ${SECRET}`);
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ memoryId: "mem_failed_words" }));
    expect(notifyMock).not.toHaveBeenCalledWith(expect.objectContaining({ memoryId: "mem_failed_nowords" }));
    notifyMock.mockClear();
    const res = await run(`Bearer ${SECRET}`);
    expect(notifyMock).not.toHaveBeenCalledWith(expect.objectContaining({ memoryId: "mem_failed_words" }));
    expect(((await res.json()) as { data: Record<string, number> }).data.adminAlertsSent).toBe(0);
  });

  it.each(["PENDING", "APPROVED"] as const)("A3: (d) and (e2) exclude a shared %s memory's terminal admin row after a later sender upload", async (status) => {
    // This suite evaluates the actual Prisma filters, but mocks notification and transport.
    // email.test.ts separately exercises real deliver against the helper-created row.
    media = []; events = []; emails = []; memories = [];
    const old = new Date(Date.now() - 2 * HOUR);
    const terminal: EmailRow = { id: "admin_shared", memoryId: "shared", emailType: "ADMIN_NEW_MEMORY", status: "SKIPPED", errorMessage: "admin_shared", attempts: 0, nextAttemptAt: old, createdAt: old, memory: { deletedAt: null } };
    emails.push(terminal, { ...terminal, id: "retry", memoryId: "retry", status: "FAILED", errorMessage: "temporary failure", attempts: 1 });
    const shared: MemoryRow = { id: "shared", type: "PHOTO", status, source: "EMAIL", deletedAt: null, createdAt: old, contributor: { email: "sender@example.com" }, contributorNote: null, media: [{ status: "READY", deletedAt: null, createdAt: old }], emails: [terminal] };
    memories.push(shared, { ...shared, id: "catchup", emails: [] });
    const before = structuredClone(terminal);
    const response = await run(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(notifyMock.mock.calls.map((call) => call[0].memoryId).sort()).toEqual(["catchup", "retry"]);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(terminal).toEqual(before);
    const retrySelection = await dbStub.emailLog.findMany.mock.results.at(-1)!.value;
    expect(retrySelection.map((row: Record<string, unknown>) => row.memoryId)).toEqual(["retry"]);
    const body = await response.json();
    expect(body.data).toMatchObject({ emailsRetried: 1, adminAlertsSent: 1 });
    notifyMock.mockClear();
    const again = await run(`Bearer ${SECRET}`);
    expect(again.status).toBe(200);
    expect(notifyMock).not.toHaveBeenCalled();
    expect(terminal).toEqual(before);
  });

  it("(a) gives each re-record a bounded deadline signal, so a connector upload's hash cannot outrun the run (plan 2026-11-06-mcp-attach-media §8.3)", async () => {
    await run(`Bearer ${SECRET}`);
    expect(recordMediaMock).toHaveBeenCalled();
    for (const [arg] of recordMediaMock.mock.calls.filter(([a]) => a.mediaId.startsWith("med_orphan") || a.mediaId === "med_stale")) {
      expect(arg.signal).toBeInstanceOf(AbortSignal);
      expect(arg.signal!.aborted).toBe(false);
    }
  });

  it("(b) warns in Sentry, with ids only, when a connector upload's verified checksum differs from its declared hash (A13, > 50 MB)", async () => {
    media = [
      { id: "med_declared_bad", memoryId: "mem_1", status: "READY", checksumSha256: null, declaredSha256: "b".repeat(64), addedVia: "ADMIN", createdAt: new Date(Date.now() - 2 * HOUR), storageKey: "originals/mem_1/big.mov", blobUrl: "u", deletedAt: null, memory: { deletedAt: null } },
      { id: "med_declared_ok", memoryId: "mem_1", status: "READY", checksumSha256: null, declaredSha256: "a".repeat(64), addedVia: "ADMIN", createdAt: new Date(Date.now() - 2 * HOUR), storageKey: "originals/mem_1/ok.mov", blobUrl: "u", deletedAt: null, memory: { deletedAt: null } },
      { id: "med_site", memoryId: "mem_1", status: "READY", checksumSha256: null, createdAt: new Date(Date.now() - 2 * HOUR), storageKey: "originals/mem_1/site.mov", blobUrl: "u", deletedAt: null, memory: { deletedAt: null } },
    ];
    events = []; emails = []; memories = [];
    captureMessageMock.mockClear();
    await run(`Bearer ${SECRET}`);
    expect(checksumMock.mock.calls.map(([a]) => a.mediaId).sort()).toEqual(["med_declared_bad", "med_declared_ok", "med_site"]);
    expect(captureMessageMock).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("declared"), { level: "warning", tags: { media_id: "med_declared_bad", memory_id: "mem_1" } });
    expect(JSON.stringify(captureMessageMock.mock.calls)).not.toContain("b".repeat(64));
  });

  it("alerts the admins once a pending upload lands, never while it is in flight", async () => {
    await run(`Bearer ${SECRET}`);
    expect(notifyMock).not.toHaveBeenCalledWith(expect.objectContaining({ memoryId: "mem_pending_upload" }));
    const pending = memories.find((m) => m.id === "mem_pending_upload")!;
    pending.media[0]!.status = "READY";
    notifyMock.mockClear();
    const res = await run(`Bearer ${SECRET}`);
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({ memoryId: "mem_pending_upload" }));
    expect(((await res.json()) as { data: Record<string, number> }).data.adminAlertsSent).toBe(1);
  });

  it("never announces a memory created before the alert feature was activated", async () => {
    await run(`Bearer ${SECRET}`);
    expect(notifyMock).not.toHaveBeenCalledWith(expect.objectContaining({ memoryId: "mem_before_cutoff" }));
    expect(memories.find((m) => m.id === "mem_before_cutoff")?.emails).toHaveLength(0);
  });

  it("is a no-op on a second run", async () => {
    await run(`Bearer ${SECRET}`);
  inTransaction = false; onLock = null; lockCalls.length = 0; delMock.mockReset(); delMock.mockImplementation(async () => { if (inTransaction) { throw new Error("storage.del inside the purge transaction"); } });
    recordMediaMock.mockClear(); checksumMock.mockClear(); confirmMock.mockClear(); confirmSubmissionMock.mockClear(); notifyMock.mockClear(); delMock.mockClear(); deriveMediaMock.mockClear(); derivedDeletes.length = 0; extractGpsMock.mockClear();
    const res = await run(`Bearer ${SECRET}`);
    const body = (await res.json()) as { data: Record<string, number> };
    expect(checksumMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    // Nothing is retired or purged again; the only deletes are step (f3)'s repeat deletes for rows retired within the last two hours.
    expect(body.data.orphansFailed).toBe(0);
    expect(body.data.deletedBlobsRemoved).toBe(0);
    for (const [key] of delMock.mock.calls) {
      expect(media.find((m) => m.storageKey === key)).toMatchObject({ status: "FAILED", purgedAt: expect.any(Date) });
    }
    expect(deriveMediaMock).not.toHaveBeenCalled();
    expect(extractGpsMock).not.toHaveBeenCalled();
    // Only the still-leased receipt row is retried again (and answers `leased` again).
    expect(confirmSubmissionMock.mock.calls.map((c) => c[0].anchorId)).toEqual(["mem_live0"]);
    expect(body.data.checksumsComputed).toBe(0);
    expect(body.data.confirmationsSent).toBe(0);
    expect(body.data.adminAlertsSent).toBe(0);
    expect(body.data.submissionReceiptsSent).toBe(0);
  });

  it("gives up on a webhook event after three attempts", async () => {
    events[0]!.attempts = 3;
    await run(`Bearer ${SECRET}`);
    expect(events[0]?.processedAt).toBeNull();
  });
});

describe("steps (a) and (c) record budget", () => {
  // The 50 s run budget reserves 5 s for cleanup: 44 s elapsed leaves exactly
  // the 1 s minimum for recording; even one millisecond more must defer work.
  const cases = [
    { elapsedMs: 44_000, starts: true },
    { elapsedMs: 44_001, starts: false },
    { elapsedMs: 45_000, starts: false },
    { elapsedMs: 49_999, starts: false },
  ];

  it.each(cases)("(a) starts stale PENDING records only with enough budget ($elapsedMs ms elapsed)", async ({ elapsedMs, starts }) => {
    media = media.filter((row) => row.id === "med_stale");
    events = []; emails = []; memories = [];
    const findMedia = dbStub.media.findMany.getMockImplementation()!;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const startedAt = Date.now();
      dbStub.media.findMany.mockImplementation(async (args) => {
        const rows = await findMedia(args);
        if (args.where.status === "PENDING") {
          vi.setSystemTime(startedAt + elapsedMs);
        }
        return rows;
      });
      const res = await run(`Bearer ${SECRET}`);
      expect(res.status).toBe(200);
      expect((await res.json()).data).toMatchObject({ pendingRechecked: starts ? 1 : 0, errors: 0 });
      expect(recordMediaMock.mock.calls.map(([arg]) => arg.mediaId)).toEqual(starts ? ["med_stale"] : []);
    } finally {
      dbStub.media.findMany.mockImplementation(findMedia);
      vi.useRealTimers();
    }
  });

  it.each(cases)("(c) preserves every event's retries unless there is enough budget ($elapsedMs ms elapsed)", async ({ elapsedMs, starts }) => {
    media = []; emails = []; memories = [];
    events = [1, 2].map((attempts) => ({ id: `evt_${attempts}`, attempts, processedAt: null, error: "previous failure", payload: { tokenPayload: JSON.stringify({ mediaId: `med_${attempts}` }) } }));
    const before = structuredClone(events);
    const findEvents = dbStub.webhookEvent.findMany.getMockImplementation()!;
    dbStub.webhookEvent.update.mockClear();
    recordMediaMock.mockImplementation(async ({ mediaId }) => ({ status: "PENDING", mediaId, memoryId: "mem_1" }));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const startedAt = Date.now();
      dbStub.webhookEvent.findMany.mockImplementation(async (args) => {
        const rows = await findEvents(args);
        vi.setSystemTime(startedAt + elapsedMs);
        return rows;
      });
      const res = await run(`Bearer ${SECRET}`);
      expect(res.status).toBe(200);
      expect((await res.json()).data).toMatchObject({ eventsReplayed: starts ? 2 : 0, errors: 0 });
      expect(recordMediaMock.mock.calls.map(([arg]) => arg.mediaId)).toEqual(starts ? ["med_1", "med_2"] : []);
      expect(dbStub.webhookEvent.update).toHaveBeenCalledTimes(starts ? 2 : 0);
      expect(events).toEqual(starts ? before.map((event) => ({ ...event, attempts: event.attempts + 1, error: "blob not visible yet" })) : before);
    } finally {
      dbStub.webhookEvent.findMany.mockImplementation(findEvents);
      vi.useRealTimers();
    }
  });

  it.each(["a", "c"] as const)("(%s) checks the budget again before starting the next item", async (step) => {
    const stale = media.find((row) => row.id === "med_stale")!;
    media = step === "a" ? [stale, { ...stale, id: "med_next" }] : [];
    events = step === "c" ? ["med_stale", "med_next"].map((mediaId) => ({ id: `evt_${mediaId}`, attempts: 2, processedAt: null, error: "previous failure", payload: { tokenPayload: JSON.stringify({ mediaId }) } })) : [];
    emails = []; memories = [];
    const nextEvent = structuredClone(events[1]);
    dbStub.webhookEvent.update.mockClear();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      recordMediaMock.mockImplementation(async ({ mediaId }) => {
        vi.setSystemTime(Date.now() + 44_001);
        return { status: "READY", mediaId, memoryId: "mem_1", sizeBytes: 5 };
      });
      const res = await run(`Bearer ${SECRET}`);
      expect(res.status).toBe(200);
      expect(recordMediaMock.mock.calls.map(([arg]) => arg.mediaId)).toEqual(["med_stale"]);
      expect((await res.json()).data).toMatchObject({ pendingRechecked: step === "a" ? 1 : 0, eventsReplayed: step === "c" ? 1 : 0, errors: 0 });
      if (step === "c") {
        expect(events[0]).toMatchObject({ processedAt: expect.any(Date), attempts: 3, error: null });
        expect(events[1]).toEqual(nextEvent);
        expect(dbStub.webhookEvent.update).toHaveBeenCalledTimes(1);
      }
    } finally {
      vi.useRealTimers();
    }
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

describe("step (h): photo GPS (B3)", () => {
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
  const copies = (): DerivedRow[] => [
    { kind: "WEB_IMAGE", status: "READY", error: null, attempts: 1, claimedAt: minutesAgo(120), storageKey: "dev/derived/mem_1/w.jpg" },
    { kind: "THUMBNAIL", status: "READY", error: null, attempts: 1, claimedAt: minutesAgo(120), storageKey: "dev/derived/mem_1/t.jpg" },
  ];
  /** A live READY photo of this environment with its copies made, GPS undecided: (g) has nothing to do for it, (h) does. */
  function photo(id: string, createdAt: Date, over: Partial<MediaRow> = {}): MediaRow {
    return { id, memoryId: "mem_1", status: "READY", checksumSha256: "d".repeat(64), createdAt, storageKey: `dev/originals/mem_1/${id}.jpg`, blobUrl: "u", deletedAt: null, mimeType: "image/jpeg", derivatives: copies(), gpsCheckedAt: null, gpsAttempts: 0, memory: { deletedAt: null }, ...over };
  }
  beforeEach(() => {
    events = []; emails = []; memories = [];
    // Twelve eligible photos, oldest first (one a HEIC, one at two attempts), and every kind of row step (h) must leave alone.
    media = [
      ...Array.from({ length: 12 }, (_, i) => photo(`med_gps_${String(i).padStart(2, "0")}`, minutesAgo(200 - i), i === 3 ? { mimeType: "image/heic", storageKey: "dev/originals/mem_1/h.heic" } : i === 5 ? { gpsAttempts: 2 } : {})),
      photo("med_decided", minutesAgo(500), { gpsCheckedAt: minutesAgo(400) }),
      photo("med_capped", minutesAgo(500), { gpsAttempts: 3 }),
      photo("med_video", minutesAgo(500), { mimeType: "video/webm", storageKey: "dev/originals/mem_1/v.webm" }),
      photo("med_pending", minutesAgo(500), { status: "PENDING", derivatives: [] }),
      photo("med_removed_gps", minutesAgo(500), { deletedAt: minutesAgo(30), reservedUntil: new Date(Date.now() + HOUR) }),
      photo("med_memory_deleted", minutesAgo(500), { memory: { deletedAt: minutesAgo(30) } }),
      photo("med_prod_gps", minutesAgo(500), { storageKey: "originals/mem_9/p.jpg" }),
      // GPS decided, copies missing: step (g)'s work only. The two steps never look at each other's state.
      photo("med_copies_only", minutesAgo(500), { gpsCheckedAt: minutesAgo(400), derivatives: [] }),
    ];
  });

  it("backfills READY MOV/MP4 videos ten per run in (h), while (g) remains image-only", async () => {
    media = [
      ...Array.from({ length: 12 }, (_, i) => photo(`med_video_${i}`, minutesAgo(200 - i), {
        mimeType: i % 2 === 0 ? "video/quicktime" : "video/mp4",
        storageKey: `dev/originals/mem_1/${i}.mov`, derivatives: [],
      })),
      photo("med_image", minutesAgo(100), { derivatives: [], gpsCheckedAt: minutesAgo(50) }),
      photo("med_webm", minutesAgo(500), { mimeType: "video/webm", derivatives: [] }),
      // A browser recording has no location reader; M4A (an MP4 container) does and is covered with the extractor's tests.
      photo("med_audio", minutesAgo(500), { mimeType: "audio/webm", derivatives: [] }),
      photo("med_decided_video", minutesAgo(500), { mimeType: "video/mp4", gpsCheckedAt: minutesAgo(400) }),
      photo("med_capped_video", minutesAgo(500), { mimeType: "video/quicktime", gpsAttempts: 3 }),
      photo("med_pending_video", minutesAgo(500), { mimeType: "video/quicktime", status: "PENDING", reservedUntil: new Date(Date.now() + HOUR) }),
    ];
    await run(`Bearer ${SECRET}`);
    expect(extractGpsMock.mock.calls.map(([arg]) => arg.mediaId)).toEqual(Array.from({ length: 10 }, (_, i) => `med_video_${i}`));
    expect(deriveMediaMock.mock.calls.map(([arg]) => arg.mediaId)).toEqual(["med_image"]);
    const queries = dbStub.media.findMany.mock.calls.map(([args]) => args);
    expect(queries.find(({ where }) => "gpsCheckedAt" in where)).toMatchObject({ where: { status: "READY" }, take: 10 });
    expect(queries.find(({ where }) => Array.isArray(where.OR) && JSON.stringify(where.OR).includes("derivatives"))).toMatchObject({ where: { mimeType: { startsWith: "image/" } } });
    extractGpsMock.mockClear();
    await run(`Bearer ${SECRET}`);
    expect(extractGpsMock.mock.calls.map(([arg]) => arg.mediaId)).toEqual(["med_video_10", "med_video_11"]);
  });

  it("takes at most 10 eligible photos per run, oldest first, counts each outcome, and the next run takes the rest", async () => {
    const outcomes: Record<string, GpsOutcome> = { med_gps_00: "found", med_gps_01: "failed", med_gps_02: "skipped" };
    extractGpsMock.mockImplementation(async ({ mediaId }) => decideGps(mediaId, outcomes[mediaId] ?? "absent"));
    const first = (await (await run(`Bearer ${SECRET}`)).json()) as { data: Record<string, number> };
    expect(extractGpsMock.mock.calls.map((c) => c[0].mediaId)).toEqual(Array.from({ length: 10 }, (_, i) => `med_gps_${String(i).padStart(2, "0")}`));
    expect(first.data).toMatchObject({ gpsFound: 1, gpsAbsent: 7, gpsFailed: 1, gpsSkipped: 1, errors: 0 });
    // (g) is unchanged by GPS state: it makes the copies of the photo that lacks them, and only that one.
    expect(deriveMediaMock.mock.calls.map((c) => c[0].mediaId)).toEqual(["med_copies_only"]);

    extractGpsMock.mockClear();
    const second = (await (await run(`Bearer ${SECRET}`)).json()) as { data: Record<string, number> };
    // The failed and skipped photos are still undecided (their attempts are the feature's business), then the two left over.
    expect(extractGpsMock.mock.calls.map((c) => c[0].mediaId)).toEqual(["med_gps_01", "med_gps_02", "med_gps_10", "med_gps_11"]);
    expect(second.data).toMatchObject({ gpsAbsent: 2, gpsFailed: 1, gpsSkipped: 1 });
  });

  // B3 fix round 1: a photo starts only with the full read deadline (15 s) left, so a run running out of time never
  // costs a photo one of its three attempts. Team Code Review #7: plus a 5 s margin for the row read, the claim and the
  // decision write around the read, which the read's own deadline does not cover. The two steps put the second start
  // exactly on the 20 s floor and just under it.
  it("the floor is the 15 s read deadline plus the 5 s database margin", async () => {
    const { GPS_DB_MARGIN_MS, GPS_READ_DEADLINE_MS } = await import("@/features/media/extract-photo-gps");
    expect({ GPS_READ_DEADLINE_MS, GPS_DB_MARGIN_MS }).toEqual({ GPS_READ_DEADLINE_MS: 15_000, GPS_DB_MARGIN_MS: 5_000 });
  });

  it.each([
    { stepMs: 30_000, starts: 2, why: "the second start has exactly 20 s left: it runs" },
    { stepMs: 30_001, starts: 1, why: "the second start would have 19.999 s left: it waits for the next run" },
  ])("starts a photo only with the full 15 s read deadline and the 5 s database margin left ($why)", async ({ stepMs, starts }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      extractGpsMock.mockImplementation(async ({ mediaId }) => { vi.setSystemTime(Date.now() + stepMs); return decideGps(mediaId, "absent"); });
      const res = (await (await run(`Bearer ${SECRET}`)).json()) as { data: Record<string, number> };
      expect(extractGpsMock).toHaveBeenCalledTimes(starts);
      // Every photo that starts gets the whole read deadline, never a remainder.
      expect(extractGpsMock.mock.calls.map((c) => c[0].deadlineMs)).toEqual(Array.from({ length: starts }, () => 15_000));
      expect(res.data).toMatchObject({ gpsAbsent: starts, errors: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes the oldest first: it asks for createdAt ascending, and the store's order decides, whatever order the rows were written in", async () => {
    const shuffled = [photo("med_mid", minutesAgo(100)), photo("med_newest", minutesAgo(10)), photo("med_oldest", minutesAgo(1_000)), photo("med_old", minutesAgo(500))];
    media = shuffled;
    await run(`Bearer ${SECRET}`);
    expect(extractGpsMock.mock.calls.map((c) => c[0].mediaId)).toEqual(["med_oldest", "med_old", "med_mid", "med_newest"]);
    const gpsQuery = dbStub.media.findMany.mock.calls.map((c) => c[0] as { where: Record<string, unknown>; orderBy?: unknown; take?: number }).find((args) => "gpsCheckedAt" in args.where);
    expect(gpsQuery).toMatchObject({ orderBy: { createdAt: "asc" }, take: 10 });
  });

  it("leaves a photo under a live GPS claim alone and takes one whose claim is stale (final review, item 2)", async () => {
    media = [
      photo("med_claim_live", minutesAgo(300), { gpsAttempts: 1, gpsClaimedAt: new Date(Date.now() - 5_000) }),
      photo("med_claim_stale", minutesAgo(200), { gpsAttempts: 1, gpsClaimedAt: minutesAgo(30) }),
      photo("med_unclaimed", minutesAgo(100)),
    ];
    await run(`Bearer ${SECRET}`);
    expect(extractGpsMock.mock.calls.map((c) => c[0].mediaId)).toEqual(["med_claim_stale", "med_unclaimed"]);
  });

  it("counts a throw (which the step should never do) as a run error and moves on to the next photo", async () => {
    extractGpsMock.mockImplementationOnce(async () => { throw new Error("unexpected"); });
    const res = (await (await run(`Bearer ${SECRET}`)).json()) as { data: Record<string, number> };
    expect(extractGpsMock).toHaveBeenCalledTimes(10);
    expect(res.data).toMatchObject({ errors: 1, gpsAbsent: 9 });
  });
});

describe("step (g2): video posters (video-posters plan T7, ruling R11)", () => {
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
  /** A live READY video of this environment with its GPS decided, so step (h) leaves it alone. */
  function video(id: string, createdAt: Date, over: Partial<MediaRow> = {}): MediaRow {
    return { id, memoryId: "mem_1", status: "READY", checksumSha256: "d".repeat(64), createdAt, storageKey: `dev/originals/mem_1/${id}.mov`, blobUrl: "u", deletedAt: null, mimeType: "video/quicktime", derivatives: [], gpsCheckedAt: minutesAgo(400), gpsAttempts: 1, memory: { deletedAt: null }, ...over };
  }
  function poster(over: Partial<DerivedRow> = {}): DerivedRow {
    return { kind: "POSTER", status: "PENDING", error: null, attempts: 1, claimedAt: minutesAgo(1), storageKey: "dev/derived/mem_1/p.jpg", ...over };
  }
  /** Like the real derivePoster on an eligible row: its POSTER row ends READY. */
  function makePoster(mediaId: string): PosterOutcome {
    const row = media.find((m) => m.id === mediaId)!;
    row.derivatives = [...(row.derivatives ?? []).filter((d) => d.kind !== "POSTER"), poster({ status: "READY", claimedAt: new Date() })];
    return "derived";
  }
  /** (g2)'s read: the only media query whose OR names the POSTER kind ((g)'s names the photo copies). */
  const isPosterQuery = (where: Record<string, unknown>) => JSON.stringify(where.OR ?? []).includes("POSTER");
  const posterQuery = () => dbStub.media.findMany.mock.calls.map(([args]) => args).filter(({ where }) => isPosterQuery(where)).at(-1);
  beforeEach(() => {
    events = []; emails = []; memories = []; media = [];
    isolationCalls.length = 0;
    dbStub.media.findMany.mockClear();
  });

  it("selects exactly the rows derivePoster's isEligible would take (or retire), judged against the video pixel ceiling", async () => {
    const thumb: DerivedRow = { kind: "THUMBNAIL", status: "READY", error: null, attempts: 1, claimedAt: minutesAgo(100), storageKey: "dev/derived/mem_1/t.jpg" };
    const variants: Array<{ name: string; row: DerivedRow | null; others?: DerivedRow[] }> = [
      { name: "no poster row", row: null },
      { name: "no poster row, other kinds READY", row: null, others: [thumb] },
      { name: "a live claim", row: poster({ claimedAt: minutesAgo(1) }) },
      { name: "a live claim at its last attempt", row: poster({ claimedAt: minutesAgo(1), attempts: 3 }) },
      { name: "a stale claim", row: poster({ claimedAt: minutesAgo(11) }) },
      { name: "a claim with no timestamp", row: poster({ claimedAt: null }) },
      { name: "a stale claim that used its attempts (retired by derivePoster)", row: poster({ claimedAt: minutesAgo(11), attempts: 3 }) },
      { name: "READY", row: poster({ status: "READY" }), others: [thumb] },
      ...(["decode_failed", "timeout"] as const).flatMap((error) => [1, 2, 3].map((attempts) => ({ name: `FAILED ${error} after ${attempts}`, row: poster({ status: "FAILED", error, attempts }) }))),
      ...["no_video_stream", "no_frame", "source_limit", "unsupported_type", "too_large", "abandoned"].map((error) => ({ name: `FAILED ${error}`, row: poster({ status: "FAILED", error }) })),
      { name: "refused under today's video ceiling", row: poster({ status: "FAILED", error: `too_many_pixels:${MAX_VIDEO_PIXELS}` }) },
      { name: "refused under the photo ceiling", row: poster({ status: "FAILED", error: `too_many_pixels:${MAX_PIXELS}` }) },
      { name: "refused under another ceiling, attempts spent", row: poster({ status: "FAILED", error: "too_many_pixels:1000", attempts: 3 }) },
    ];
    media = variants.map(({ row, others }, i) => video(`med_v${i}`, minutesAgo(500 - i), { derivatives: [...(others ?? []), ...(row ? [row] : [])] }));
    await run(`Bearer ${SECRET}`);
    const where = posterQuery()!.where;
    const judged = variants.map(({ name, row }, i) => {
      const verdict = row === null ? "eligible" : isEligible({ id: `d${i}`, ...row, status: row.status as "PENDING" | "READY" | "FAILED" }, new Date(), MAX_VIDEO_PIXELS);
      return { name, selected: matches(media[i] as unknown as Record<string, unknown>, where), expected: verdict === "eligible" || verdict === "exhausted" };
    });
    expect(judged.filter((j) => j.selected !== j.expected)).toEqual([]);
    // The matrix covers both sides of every branch.
    expect(judged.filter((j) => j.selected).length).toBeGreaterThanOrEqual(8);
    expect(judged.filter((j) => !j.selected).length).toBeGreaterThanOrEqual(10);
  });

  it("takes only READY, live, video/* originals of this environment whose memory is live", async () => {
    media = [
      video("med_ok", minutesAgo(100)),
      video("med_mp4", minutesAgo(99), { mimeType: "video/mp4" }),
      video("med_webm", minutesAgo(98), { mimeType: "video/webm", storageKey: "dev/originals/mem_1/w.webm" }),
      video("med_photo", minutesAgo(500), { mimeType: "image/jpeg", storageKey: "dev/originals/mem_1/p.jpg" }),
      video("med_audio", minutesAgo(500), { mimeType: "audio/mp4", storageKey: "dev/originals/mem_1/a.m4a" }),
      video("med_prod", minutesAgo(500), { storageKey: "originals/mem_9/v.mov" }),
      video("med_preview", minutesAgo(500), { storageKey: "preview/originals/mem_1/v.mov" }),
      video("med_removed", minutesAgo(500), { deletedAt: minutesAgo(30), reservedUntil: new Date(Date.now() + HOUR) }),
      video("med_memory_deleted", minutesAgo(500), { memory: { deletedAt: minutesAgo(30) } }),
      video("med_pending", minutesAgo(500), { status: "PENDING", reservedUntil: new Date(Date.now() + HOUR) }),
      video("med_failed", minutesAgo(500), { status: "FAILED" }),
    ];
    await run(`Bearer ${SECRET}`);
    const where = posterQuery()!.where;
    expect(media.filter((m) => matches(m as unknown as Record<string, unknown>, where)).map((m) => m.id)).toEqual(["med_ok", "med_mp4", "med_webm"]);
  });

  it("selects only the video types the site accepts, taken from lib/media-types (ruling R13)", async () => {
    media = [
      video("med_mov", minutesAgo(100)),
      video("med_avi", minutesAgo(500), { mimeType: "video/x-msvideo", storageKey: "dev/originals/mem_1/v.avi" }),
      video("med_mkv", minutesAgo(500), { mimeType: "video/x-matroska", storageKey: "dev/originals/mem_1/v.mkv" }),
      video("med_param", minutesAgo(500), { mimeType: "video/mp4;codecs=avc1" }),
    ];
    await run(`Bearer ${SECRET}`);
    const where = posterQuery()!.where;
    expect(where.mimeType).toEqual({ in: ALLOWED_MIME_TYPES.filter((mime) => mime.startsWith("video/")) });
    expect(where.mimeType).toEqual({ in: ["video/mp4", "video/quicktime", "video/webm"] });
    expect(media.filter((m) => matches(m as unknown as Record<string, unknown>, where)).map((m) => m.id)).toEqual(["med_mov"]);
  });

  it("a disallowed video type, never eligible for derivePoster, cannot hold the batch and starve newer videos (R13)", async () => {
    derivePosterMock.mockImplementation(async ({ mediaId }) => makePoster(mediaId));
    media = [
      video("med_avi_1", minutesAgo(900), { mimeType: "video/x-msvideo" }),
      video("med_avi_2", minutesAgo(800), { mimeType: "video/x-msvideo" }),
      video("med_new", minutesAgo(10), { mimeType: "video/mp4" }),
    ];
    await run(`Bearer ${SECRET}`);
    expect(derivePosterMock.mock.calls.map(([a]) => a.mediaId)).toEqual(["med_new"]);
  });

  it("works through a backlog two per run, oldest first, and a run after the last poster is a no-op", async () => {
    derivePosterMock.mockImplementation(async ({ mediaId }) => makePoster(mediaId));
    media = [
      video("med_c", minutesAgo(300)),
      video("med_a", minutesAgo(500), { derivatives: [poster({ claimedAt: minutesAgo(11) })] }),
      video("med_done", minutesAgo(600), { derivatives: [poster({ status: "READY" })] }),
      video("med_e", minutesAgo(100), { derivatives: [poster({ status: "FAILED", error: `too_many_pixels:${MAX_PIXELS}` })] }),
      video("med_b", minutesAgo(400), { derivatives: [poster({ status: "FAILED", error: "timeout", attempts: 2 })] }),
      video("med_d", minutesAgo(200), { mimeType: "video/mp4" }),
    ];
    const perRun: string[][] = [];
    const posters: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      derivePosterMock.mockClear();
      const body = (await (await run(`Bearer ${SECRET}`)).json()) as { data: Record<string, number> };
      perRun.push(derivePosterMock.mock.calls.map(([a]) => a.mediaId));
      posters.push(body.data.posters!);
    }
    expect(perRun).toEqual([["med_a", "med_b"], ["med_c", "med_d"], ["med_e"], []]);
    expect(posters).toEqual([2, 2, 1, 0]);
    expect(posterQuery()).toMatchObject({ orderBy: { createdAt: "asc" }, take: 2 });
  });

  it("is the last step: it starts after step (h) has finished", async () => {
    derivePosterMock.mockImplementation(async ({ mediaId }) => makePoster(mediaId));
    extractGpsMock.mockImplementation(async ({ mediaId }) => decideGps(mediaId, "absent"));
    media = [video("med_both", minutesAgo(100), { gpsCheckedAt: null, gpsAttempts: 0 }), video("med_gps_only", minutesAgo(90), { gpsCheckedAt: null, gpsAttempts: 0, derivatives: [poster({ status: "READY" })] })];
    await run(`Bearer ${SECRET}`);
    expect(extractGpsMock).toHaveBeenCalledTimes(2);
    expect(derivePosterMock).toHaveBeenCalledTimes(1);
    expect(Math.max(...extractGpsMock.mock.invocationCallOrder)).toBeLessThan(derivePosterMock.mock.invocationCallOrder[0]!);
    // Its query is the run's last read of the media table.
    expect(dbStub.media.findMany.mock.calls.at(-1)![0]).toBe(posterQuery());
  });

  describe("budget: what is left of the run, capped at 20 s, and each item only what is left of both", () => {
    it.each([
      { why: "a fresh run: the step's 20 s cap, then its remainder", elapsedMs: 0, firstTakesMs: 15_000, budgets: [20_000, 5_000] },
      { why: "the step's cap is spent by the first item: the second waits", elapsedMs: 0, firstTakesMs: 20_000, budgets: [20_000] },
      { why: "(g) and (h) left 12 s of the run: the leftover, then its remainder", elapsedMs: 38_000, firstTakesMs: 5_000, budgets: [12_000, 7_000] },
      { why: "the first item spends the run's leftover: the second waits", elapsedMs: 38_000, firstTakesMs: 12_000, budgets: [12_000] },
      { why: "the run is already spent: nothing starts", elapsedMs: 50_000, firstTakesMs: 0, budgets: [] },
    ])("$why", async ({ elapsedMs, firstTakesMs, budgets }) => {
      media = [video("med_1st", minutesAgo(200)), video("med_2nd", minutesAgo(100))];
      const findMedia = dbStub.media.findMany.getMockImplementation()!;
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const startedAt = Date.now();
        dbStub.media.findMany.mockImplementation(async (args) => {
          const rows = await findMedia(args);
          if (isPosterQuery(args.where)) {
            vi.setSystemTime(startedAt + elapsedMs);
          }
          return rows;
        });
        derivePosterMock.mockImplementation(async ({ mediaId }) => { vi.setSystemTime(Date.now() + firstTakesMs); return makePoster(mediaId); });
        const body = (await (await run(`Bearer ${SECRET}`)).json()) as { data: Record<string, number> };
        expect(derivePosterMock.mock.calls.map(([a]) => a.deadlineMs)).toEqual(budgets);
        expect(derivePosterMock.mock.calls.map(([a]) => a.mediaId)).toEqual(["med_1st", "med_2nd"].slice(0, budgets.length));
        expect(body.data).toMatchObject({ posters: budgets.length, errors: 0 });
      } finally {
        dbStub.media.findMany.mockImplementation(findMedia);
        vi.useRealTimers();
      }
    });
  });

  it("runs each video in its own isolation scope", async () => {
    const scopes: unknown[] = [];
    derivePosterMock.mockImplementation(async ({ mediaId }) => { scopes.push(isolationCalls.at(-1)); return makePoster(mediaId); });
    media = [video("med_1st", minutesAgo(200)), video("med_2nd", minutesAgo(100))];
    await run(`Bearer ${SECRET}`);
    expect(scopes).toHaveLength(2);
    expect(scopes[0]).toBeDefined();
    expect(scopes[0]).not.toBe(scopes[1]);
    expect(isolationCalls.slice(-2)).toEqual(scopes);
  });

  it.each([
    { outcomes: ["derived", "failed"], posters: 1 },
    { outcomes: ["deferred", "claimed_elsewhere"], posters: 0 },
    { outcomes: ["not_eligible", "derived"], posters: 1 },
  ] as Array<{ outcomes: PosterOutcome[]; posters: number }>)("counts only a poster made, and none of $outcomes as a run error", async ({ outcomes, posters }) => {
    for (const outcome of outcomes) { derivePosterMock.mockImplementationOnce(async () => outcome); }
    media = [video("med_1st", minutesAgo(200)), video("med_2nd", minutesAgo(100))];
    const body = (await (await run(`Bearer ${SECRET}`)).json()) as { data: Record<string, number> };
    expect(derivePosterMock).toHaveBeenCalledTimes(2);
    expect(body.data).toMatchObject({ posters, errors: 0 });
  });

  it("an item that throws (derivePoster never should) is a run error, and the next item still runs", async () => {
    derivePosterMock.mockImplementationOnce(async () => { throw new Error("unexpected"); }).mockImplementationOnce(async ({ mediaId }) => makePoster(mediaId));
    media = [video("med_1st", minutesAgo(200)), video("med_2nd", minutesAgo(100))];
    const body = (await (await run(`Bearer ${SECRET}`)).json()) as { data: Record<string, number> };
    expect(derivePosterMock.mock.calls.map(([a]) => a.mediaId)).toEqual(["med_1st", "med_2nd"]);
    expect(body.data).toMatchObject({ posters: 1, errors: 1 });
  });
});

describe("Sentry cron monitor (plan §8.8)", () => {
  beforeEach(() => { checkInMock.mockClear(); isolationCalls.length = 0; reconcileRunMock.mockClear(); delete process.env.VERCEL_ENV; });

  it("the schedule constant is the one vercel.json runs", async () => {
    const { RECONCILE_SCHEDULE } = await import("@/app/api/cron/reconcile-uploads/route");
    const { readFileSync } = await import("node:fs");
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };
    expect(vercel.crons[0]).toEqual({ path: "/api/cron/reconcile-uploads", schedule: RECONCILE_SCHEDULE });
  });

  it("in production a healthy run checks in in_progress then ok with the monitor config, and records the run metric", async () => {
    process.env.VERCEL_ENV = "production";
    const res = await run(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(checkInMock.mock.calls).toHaveLength(2);
    expect(checkInMock.mock.calls[0]).toEqual([
      { monitorSlug: "reconcile-uploads", status: "in_progress" },
      { schedule: { type: "crontab", value: "*/10 * * * *" }, checkinMargin: 5, maxRuntime: 2, timezone: "UTC", failureIssueThreshold: 2, recoveryThreshold: 1 },
    ]);
    expect(checkInMock.mock.calls[1]).toEqual([{ checkInId: "checkin_1", monitorSlug: "reconcile-uploads", status: "ok" }]);
    expect(reconcileRunMock).toHaveBeenCalledWith(expect.any(Number), 0);
  });

  it("reports error when any item failed, even though the run itself answers 200", async () => {
    process.env.VERCEL_ENV = "production";
    checksumMock.mockRejectedValueOnce(new Error("hash failed"));
    const res = await run(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { errors: number } }).data.errors).toBe(1);
    expect(checkInMock.mock.calls[1]).toEqual([{ checkInId: "checkin_1", monitorSlug: "reconcile-uploads", status: "error" }]);
    expect(reconcileRunMock).toHaveBeenCalledWith(expect.any(Number), 1);
  });

  it("reports error and rethrows when the run itself throws", async () => {
    process.env.VERCEL_ENV = "production";
    dbStub.media.findMany.mockRejectedValueOnce(new Error("database down"));
    await expect(run(`Bearer ${SECRET}`)).rejects.toThrow("database down");
    expect(checkInMock.mock.calls[1]).toEqual([{ checkInId: "checkin_1", monitorSlug: "reconcile-uploads", status: "error" }]);
  });

  it("never checks in outside production (previews and manual runs create no monitor)", async () => {
    process.env.VERCEL_ENV = "preview";
    await run(`Bearer ${SECRET}`);
    delete process.env.VERCEL_ENV;
    await run(`Bearer ${SECRET}`);
    expect(checkInMock).not.toHaveBeenCalled();
    expect(reconcileRunMock).toHaveBeenCalledTimes(2);
  });

  it("runs every item in its own isolation scope so one contributor's identity never leaks into the next item", async () => {
    const old = new Date(Date.now() - 2 * HOUR);
    media = []; events = [];
    emails = [
      { id: "log_a", memoryId: "mem_a", emailType: "MEMORY_CONFIRMATION", status: "FAILED", attempts: 1, nextAttemptAt: old, createdAt: old, memory: { deletedAt: null } },
      { id: "log_b", memoryId: "mem_b", emailType: "MEMORY_CONFIRMATION", status: "FAILED", attempts: 1, nextAttemptAt: old, createdAt: old, memory: { deletedAt: null } },
    ];
    memories = [];
    const seen: unknown[] = [];
    confirmMock.mockImplementation(async ({ memoryId }) => { seen.push(isolationCalls.at(-1)); return recordSent(memoryId, "MEMORY_CONFIRMATION"); });
    await run(`Bearer ${SECRET}`);
    expect(confirmMock).toHaveBeenCalledTimes(2);
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(isolationCalls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("purge (f): durable intent under the memory lock (C1, C3, C5, C5b, C5c)", () => {
  const old = new Date(Date.now() - 2 * HOUR);
  const longGone = new Date(Date.now() - 31 * 24 * HOUR);
  function goneRow(): MediaRow {
    return { id: "med_x", memoryId: "mem_x", status: "READY", checksumSha256: "a".repeat(64), createdAt: old, storageKey: "dev/originals/mem_x/o.jpg", blobUrl: "u", deletedAt: null, purgedAt: null, mimeType: "video/mp4", derivatives: [{ kind: "WEB_IMAGE", status: "READY", error: null, attempts: 1, claimedAt: old, storageKey: "dev/derived/mem_x/w.jpg" }], memory: { deletedAt: longGone } };
  }
  beforeEach(() => { media = [goneRow()]; events = []; emails = []; memories = []; });

  it("C1: claims under lockMemory (purgedAt set, READY → FAILED, no storage call inside the transaction), then deletes the original, the copies and the poster key, drops the derived rows and nulls blobUrl", async () => {
    const res = await run(`Bearer ${SECRET}`);
    expect(lockCalls).toEqual(["mem_x"]);
    expect(dbStub.media.update.mock.calls[0]![0]).toEqual({ where: { id: "med_x" }, data: { purgedAt: expect.any(Date), status: "FAILED", latitude: null, longitude: null, gpsClaimedAt: null } });
    expect(delMock.mock.calls.map((c) => c[0])).toEqual(["dev/originals/mem_x/o.jpg", "dev/derived/mem_x/w.jpg", "dev/derived/mem_x/o.upload.jpg"]);
    expect(derivedDeletes).toEqual([{ mediaId: "med_x", storageKey: { in: ["dev/derived/mem_x/w.jpg"] } }]);
    expect(media[0]).toMatchObject({ status: "FAILED", purgedAt: expect.any(Date), blobUrl: null, derivatives: [] });
    expect(((await res.json()) as { data: Record<string, number> }).data).toMatchObject({ deletedBlobsRemoved: 1, errors: 0 });
  });

  it("C3: a Restore that commits before the claim makes the row ineligible: skipped, nothing touched", async () => {
    onLock = (memoryId) => { if (memoryId === "mem_x") { media[0]!.memory.deletedAt = null; } };
    const res = await run(`Bearer ${SECRET}`);
    expect(lockCalls).toEqual(["mem_x"]);
    expect(delMock).not.toHaveBeenCalled();
    expect(media[0]).toMatchObject({ status: "READY", purgedAt: null, blobUrl: "u" });
    expect(media[0]!.derivatives).toHaveLength(1);
    expect(((await res.json()) as { data: Record<string, number> }).data).toMatchObject({ deletedBlobsRemoved: 0, errors: 0 });
  });

  it("C5: a delete that fails after the original is gone leaves the committed mark; the next run re-selects by purgedAt and finishes idempotently", async () => {
    delMock.mockImplementation(async (key: string) => { if (key.endsWith("/w.jpg")) { throw new Error("blob host down"); } });
    const first = await run(`Bearer ${SECRET}`);
    expect(((await first.json()) as { data: Record<string, number> }).data).toMatchObject({ deletedBlobsRemoved: 0, errors: 1 });
    expect(media[0]).toMatchObject({ status: "FAILED", purgedAt: expect.any(Date), blobUrl: "u" });
    expect(derivedDeletes).toEqual([]);
    // Meanwhile the memory is restored: the intent is durable, so the row is still selected and completed (C5c).
    media[0]!.memory.deletedAt = null;
    delMock.mockClear();
    delMock.mockImplementation(async () => undefined);
    dbStub.media.update.mockClear();
    const second = await run(`Bearer ${SECRET}`);
    expect(((await second.json()) as { data: Record<string, number> }).data).toMatchObject({ deletedBlobsRemoved: 1, errors: 0 });
    // phase 1 is a no-op once purgedAt is set: no second mark, and the delete of the original is simply repeated (idempotent)
    expect(dbStub.media.update.mock.calls.map((c) => c[0].data)).toEqual([{ blobUrl: null }]);
    expect(delMock.mock.calls.map((c) => c[0])).toEqual(["dev/originals/mem_x/o.jpg", "dev/derived/mem_x/w.jpg", "dev/derived/mem_x/o.upload.jpg"]);
    expect(media[0]).toMatchObject({ blobUrl: null, derivatives: [] });
    const third = await run(`Bearer ${SECRET}`);
    expect(((await third.json()) as { data: Record<string, number> }).data).toMatchObject({ deletedBlobsRemoved: 0 });
  });

  it("a purged photo keeps no point: the claim phase clears latitude, longitude and the GPS claim with the mark (final review, item 5)", async () => {
    Object.assign(media[0]!, { mimeType: "image/jpeg", latitude: 40.689247, longitude: -74.044502, gpsCheckedAt: old, gpsClaimedAt: null });
    await run(`Bearer ${SECRET}`);
    expect(media[0]).toMatchObject({ status: "FAILED", purgedAt: expect.any(Date), latitude: null, longitude: null, gpsClaimedAt: null });
  });

  it("a row marked purged earlier that still holds a point (or a GPS claim) loses it on the next pass, with no other change (final review, item 5)", async () => {
    Object.assign(media[0]!, { status: "FAILED", purgedAt: new Date(Date.now() - HOUR), mimeType: "image/jpeg", latitude: 40.689247, longitude: -74.044502, gpsCheckedAt: old, gpsClaimedAt: old });
    await run(`Bearer ${SECRET}`);
    expect(dbStub.media.update.mock.calls[0]![0]).toEqual({ where: { id: "med_x" }, data: { latitude: null, longitude: null, gpsClaimedAt: null } });
    expect(media[0]).toMatchObject({ status: "FAILED", latitude: null, longitude: null, gpsClaimedAt: null });
  });

  it("C7: a row already marked purgedAt but still READY is flipped to FAILED by the claim phase, whoever left it that way", async () => {
    media[0]!.purgedAt = new Date(Date.now() - HOUR);
    await run(`Bearer ${SECRET}`);
    expect(dbStub.media.update.mock.calls[0]![0]).toEqual({ where: { id: "med_x" }, data: { status: "FAILED" } });
    expect(media[0]).toMatchObject({ status: "FAILED", blobUrl: null, derivatives: [] });
  });

  it("C5b: a failure in the pointer phase (deleteMany) after every delete recovers the same way on the next run", async () => {
    dbStub.derivedMedia.deleteMany.mockImplementationOnce(async () => { throw new Error("db hiccup"); });
    const first = await run(`Bearer ${SECRET}`);
    expect(((await first.json()) as { data: Record<string, number> }).data).toMatchObject({ deletedBlobsRemoved: 0, errors: 1 });
    expect(media[0]).toMatchObject({ status: "FAILED", purgedAt: expect.any(Date), blobUrl: "u" });
    const second = await run(`Bearer ${SECRET}`);
    expect(((await second.json()) as { data: Record<string, number> }).data).toMatchObject({ deletedBlobsRemoved: 1, errors: 0 });
    expect(media[0]).toMatchObject({ blobUrl: null, derivatives: [] });
  });
});

describe("(e3) and deleted anchors (C6)", () => {
  it("still sends the receipt when the anchor is soft-deleted and a sibling is live: confirmSubmission drops deleted memories itself", async () => {
    const old = new Date(Date.now() - 2 * HOUR);
    memories.push(
      { id: "mem_delanchor0", type: "TEXT", deletedAt: new Date(), createdAt: old, contributorNote: "words", contributor: { email: "z@example.com" }, media: [], emails: [], submissionId: "sub_del", submissionIndex: 0, uploadLeaseUntil: null },
      { id: "mem_delanchor1", type: "TEXT", deletedAt: null, createdAt: old, contributorNote: "words", contributor: { email: "z@example.com" }, media: [], emails: [], submissionId: "sub_del", submissionIndex: 1, uploadLeaseUntil: null }
    );
    await run(`Bearer ${SECRET}`);
    expect(confirmSubmissionMock).toHaveBeenCalledWith({ anchorId: "mem_delanchor0" });
  });
});
