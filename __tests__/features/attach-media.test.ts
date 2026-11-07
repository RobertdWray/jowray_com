/** A4-A18: real reservation, completion and GPS code over a faithful, transactional DB double. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Media, Memory } from "@/generated/prisma/client";
import { RangeNotHonouredError } from "@/lib/storage-errors";
import { resetEnvCache } from "@/server/config/env";

import { SIGNATURE_SAMPLES } from "../fixtures/signatures";

const ID = "00000000-0000-4000-8000-000000000001";
const MID = "00000000-0000-4000-8000-000000000002";
const NOW = Date.parse("2026-11-07T08:00:00Z");
const BYTES = new Uint8Array([...SIGNATURE_SAMPLES["image/jpeg"]!, ...new Array<number>(2048).fill(7)]);
const HASH = createHash("sha256").update(BYTES).digest("hex");
const FILE = { name: "photo.jpg", type: "image/jpeg", size: BYTES.length, sha256: HASH };
const INPUT = { memoryId: ID, file: FILE };
const PUT_URL = "https://upload.example.invalid/synthetic-put";
type Revision = { memoryId: string; changedVia: string; before: Record<string, unknown>; after: Record<string, unknown> };
let memory: Memory | null;
let media: Media[];
let revisions: Revision[];
let inTransaction = false;
let failAfterCommit = false;
let failSchedule = false;
let onLock: (() => void) | undefined;
let budgetBytes = 0;
const locks: string[] = [];
const tasks: Array<() => Promise<unknown>> = [];

/** Interpret every predicate used by the real features; unexpected operators fail loudly. */
function matches(row: object, where: Record<string, unknown>): boolean {
  const record = row as Record<string, unknown>;
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") { return (value as Record<string, unknown>[]).some((v) => matches(row, v)); }
    if (key === "AND") { return (value as Record<string, unknown>[]).every((v) => matches(row, v)); }
    if (key === "NOT") { return !matches(row, value as Record<string, unknown>); }
    if (key === "memory") { return memory !== null && matches(memory, value as Record<string, unknown>); }
    const actual = record[key];
    if (value instanceof Date) { return actual instanceof Date && actual.getTime() === value.getTime(); }
    if (value !== null && typeof value === "object") {
      return Object.entries(value).every(([operator, expected]) => {
        if (operator === "in") { return (expected as unknown[]).includes(actual); }
        if (operator === "not") { return actual !== expected; }
        const a = actual instanceof Date ? actual.getTime() : Number(actual);
        const b = expected instanceof Date ? expected.getTime() : Number(expected);
        if (operator === "gt") { return a > b; }
        if (operator === "gte") { return a >= b; }
        if (operator === "lt") { return a < b; }
        if (operator === "lte") { return a <= b; }
        throw new Error(`Unsupported test predicate ${operator}`);
      });
    }
    return actual === value;
  });
}
function apply(row: object, data: Record<string, unknown>): void {
  const record = row as Record<string, unknown>;
  for (const [key, value] of Object.entries(data)) {
    record[key] = value && typeof value === "object" && "increment" in value ? Number(record[key]) + Number(value.increment) : value;
  }
}
function mediaRow(over: Partial<Media> = {}): Media {
  return {
    id: MID, memoryId: ID, storageKey: `dev/originals/${ID}/photo.jpg`, mimeType: "image/jpeg",
    status: "PENDING", maxBytes: BYTES.length, sizeBytes: null, blobUrl: null,
    addedVia: "ADMIN", declaredSha256: HASH, checksumSha256: null, originalFilename: "photo.jpg",
    durationSeconds: null, width: null, height: null, capturedAt: null, exif: null, caption: null, approxDateText: null, place: null,
    deletedAt: null, replacesMediaId: null, purgedAt: null, sortOrder: 0,
    createdAt: new Date(NOW), updatedAt: new Date(NOW), reservedUntil: new Date(NOW + 4_500_000),
    gpsCheckedAt: null, gpsAttempts: 0, gpsClaimedAt: null, latitude: null, longitude: null,
    ...over,
  };
}
const db = {
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    expect(inTransaction).toBe(false);
    const before = structuredClone({ memory, media, revisions });
    inTransaction = true;
    let result: unknown;
    try { result = await fn(db); }
    catch (error) { ({ memory, media, revisions } = before); throw error; }
    finally { inTransaction = false; }
    if (failAfterCommit) { failAfterCommit = false; throw new Error("response lost after commit"); }
    return result;
  }),
  $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
    if (strings.join("").includes("FOR UPDATE")) { locks.push("memory"); onLock?.(); return [{ id: ID }]; }
    return [{ memoriesToday: 1, bytesToday: budgetBytes, storedBytes: 0, derivedBytes: 0, openBytes: budgetBytes }];
  }),
  $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
    if (strings.join("").includes("pg_advisory")) { locks.push("budget"); }
    return 1;
  }),
  memory: {
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => memory && matches(memory, where) ? structuredClone(memory) : null),
    findUniqueOrThrow: vi.fn(async () => { if (!memory) { throw new Error("missing memory"); } return structuredClone(memory); }),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { if (!memory) { throw new Error("missing memory"); } apply(memory, data); return structuredClone(memory); }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      locks.push("lease");
      if (!memory || !matches(memory, where)) { return { count: 0 }; }
      apply(memory, data); return { count: 1 };
    }),
  },
  media: {
    findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = media.find((r) => matches(r, where));
      return row ? { ...structuredClone(row), memory: structuredClone(memory) } : null;
    }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => structuredClone(media.find((r) => matches(r, where)) ?? null)),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => structuredClone(media.filter((r) => matches(r, where)))),
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => media.filter((r) => matches(r, where)).length),
    create: vi.fn(async ({ data }: { data: Partial<Media> }) => { const row = mediaRow({ id: randomUUID(), ...data }); media.push(row); return structuredClone(row); }),
    update: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = media.find((r) => matches(r, where));
      if (!row) { throw Object.assign(new Error("not found"), { code: "P2025" }); }
      apply(row, data); return structuredClone(row);
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const rows = media.filter((r) => matches(r, where)); rows.forEach((r) => apply(r, data)); return { count: rows.length };
    }),
  },
  memoryRevision: {
    count: vi.fn(async () => revisions.length),
    create: vi.fn(async ({ data }: { data: Revision }) => { revisions.push(data); return data; }),
  },
};
vi.mock("@/server/db/client", () => ({ getDb: () => db }));
const storage = { head: vi.fn(), readPrefix: vi.fn(), readRange: vi.fn(), get: vi.fn(), del: vi.fn(), presignPut: vi.fn() };
vi.mock("@/services/storage", () => ({ createStorageService: () => storage }));
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("@/lib/logger", () => ({ createLogger: () => log, logError: vi.fn(), logErrorAndFlush: vi.fn() }));
const confirm = vi.fn();
const notify = vi.fn();
const derive = vi.fn();
vi.mock("@/features/memories/confirm", () => ({ confirmMemory: (...args: unknown[]) => confirm(...args) }));
vi.mock("@/features/memories/notify-admins", () => ({ notifyAdminsOfMemory: (...args: unknown[]) => notify(...args) }));
vi.mock("@/features/memories/derive-media", () => ({ deriveMedia: (...args: unknown[]) => derive(...args) }));
vi.mock("@/lib/sentry/after-flush", () => ({ afterWithFlush: (_name: string, task: () => Promise<unknown>) => {
  if (failSchedule) { failSchedule = false; throw new Error("response lost after GPS stamp"); }
  tasks.push(task);
} }));

import { finalizeUploadAsAdmin, requestUploadAsAdmin } from "@/features/admin/attach-media";
import { INLINE_HASH_MAX_BYTES, recordMedia } from "@/features/memories/ingest-upload";
import { BudgetBusyError } from "@/features/memories/lock";
import * as adminSchemas from "@/lib/validations/admin";
import * as mcpSchemas from "@/lib/validations/mcp";

function land(row = media[0]!, bytes = BYTES): void {
  storage.head.mockImplementation(async (pathname: string) => {
    expect(inTransaction).toBe(false);
    return { pathname, url: "https://blob.example.invalid/photo", size: bytes.length, contentType: row.mimeType, uploadedAt: new Date(NOW) };
  });
  storage.readPrefix.mockResolvedValue(bytes);
  storage.readRange.mockImplementation(async (_pathname: string, offset: number, length: number) => bytes.subarray(offset, offset + length));
  storage.get.mockImplementation(async () => ({ stream: new Blob([new Uint8Array(bytes)]).stream(), contentLength: bytes.length, contentType: row.mimeType }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.stubEnv("UPLOAD_TICKET_SECRET", "s".repeat(32));
  vi.stubEnv("DAILY_BYTE_BUDGET", "1000000000");
  vi.stubEnv("VERCEL_ENV", "development");
  resetEnvCache();
  memory = {
    id: ID, memorialId: "memorial", contributorId: null, deletedAt: null, status: "DRAFT", type: "TEXT", source: "OTHER", sourceRef: null,
    approxDateText: null, approxYear: null, approxMonth: null, place: null, latitude: null, longitude: null,
    contributorNote: "Words", language: "en", visibility: "FAMILY", notifyWhenPosted: true,
    consentVersion: "v1", consentedAt: null, analysisStatus: "NOT_STARTED", claimTokenHash: "0".repeat(64),
    submissionId: null, submissionIndex: null, uploadLeaseUntil: null, createdAt: new Date(NOW), updatedAt: new Date(NOW),
  };
  media = []; revisions = []; tasks.length = 0; locks.length = 0;
  inTransaction = false; failAfterCommit = false; failSchedule = false; onLock = undefined; budgetBytes = 0;
  storage.head.mockImplementation(async () => { expect(inTransaction).toBe(false); return null; });
  storage.presignPut.mockImplementation(async ({ validUntil, contentType }: { validUntil: number; contentType: string }) => {
    expect(inTransaction).toBe(false);
    return { url: PUT_URL, expiresAt: new Date(validUntil), headers: { "content-type": contentType, "x-content-type": contentType } };
  });
});
afterEach(() => {
  expect(confirm).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled();
  for (const fn of Object.values(log)) { expect(JSON.stringify(fn.mock.calls)).not.toContain(PUT_URL); }
  vi.restoreAllMocks(); vi.unstubAllEnvs(); resetEnvCache();
});

describe("upload schemas", () => {
  it("shares text limits and accepts a positive size, lowercase SHA-256 and nonnegative integer duration", () => {
    expect(adminSchemas.adminRequestUploadSchema.safeParse({ ...INPUT, caption: "c".repeat(2000), approxDateText: "a".repeat(120), place: "p".repeat(200), durationSeconds: 0 }).success).toBe(true);
    expect(adminSchemas.adminFinalizeUploadSchema.safeParse({ memoryId: ID, mediaId: MID }).success).toBe(true);
  });
  it.each([
    { file: { ...FILE, size: 0 } }, { file: { ...FILE, size: 0.5 } }, { file: { ...FILE, sha256: HASH.toUpperCase() } },
    { file: { ...FILE, name: "" } }, { file: { ...FILE, name: "a".repeat(256) } }, { file: { ...FILE, type: 12 } },
    { durationSeconds: -1 }, { durationSeconds: 0.5 }, { durationSeconds: 86_401 }, { durationSeconds: 2 ** 31 }, { caption: "c".repeat(2001) }, { approxDateText: "a".repeat(121) }, { place: "p".repeat(201) },
  ])("refuses invalid declaration %j", async (over) => {
    expect(await requestUploadAsAdmin({ ...INPUT, ...over })).toEqual({ ok: false, code: "invalid" });
    expect(media).toEqual([]);
  });
  it("accepts the site's duration limit and rejects longer durations in both admin and strict MCP schemas", () => {
    for (const schema of [adminSchemas.adminRequestUploadSchema, mcpSchemas.mcpRequestUploadSchema]) {
      expect(schema.safeParse({ ...INPUT, durationSeconds: 86_400 }).success).toBe(true);
      expect(schema.safeParse({ ...INPUT, durationSeconds: 86_401 }).success).toBe(false);
      expect(schema.safeParse({ ...INPUT, durationSeconds: 2 ** 31 }).success).toBe(false);
    }
  });
  it("MCP refuses misplaced or unknown keys at both levels", () => {
    expect(mcpSchemas.mcpRequestUploadSchema.safeParse({ ...INPUT, typo: true }).success).toBe(false);
    expect(mcpSchemas.mcpRequestUploadSchema.safeParse({ ...INPUT, file: { ...FILE, caption: "misplaced" } }).success).toBe(false);
    expect(mcpSchemas.mcpFinalizeUploadSchema.safeParse({ memoryId: ID, mediaId: MID, ticket: "no" }).success).toBe(false);
  });
});

describe("requestUploadAsAdmin", () => {
  it("A4: reserves exact bytes with ADMIN provenance and words; presigns only after commit with both headers", async () => {
    memory!.submissionId = "send"; memory!.submissionIndex = 0;
    const result = await requestUploadAsAdmin({ ...INPUT, caption: "caption", approxDateText: "1970", place: "Park" });
    expect(result).toEqual({ ok: true, status: "PENDING", mediaId: media[0]!.id, upload: { method: "PUT", presignedUrl: PUT_URL, headers: { "content-type": "image/jpeg", "x-content-type": "image/jpeg" }, expiresAt: new Date(NOW + 3_600_000) } });
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ addedVia: "ADMIN", declaredSha256: HASH, maxBytes: BYTES.length, caption: "caption", approxDateText: "1970", place: "Park" });
    expect(storage.presignPut).toHaveBeenCalledExactlyOnceWith({ pathname: expect.stringMatching(new RegExp(`^dev/originals/${ID}/[0-9a-f-]+\\.jpg$`)), contentType: "image/jpeg", maxBytes: BYTES.length, validUntil: NOW + 3_600_000, signal: expect.any(AbortSignal) });
    expect(locks).toEqual(["lease", "memory", "budget"]);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(revisions).toEqual([]);
  });
  it.each(["preview", "production"])("A4: uses the %s storage prefix and normalizes an untyped HEIC", async (env) => {
    vi.stubEnv("VERCEL_ENV", env); resetEnvCache();
    await requestUploadAsAdmin({ ...INPUT, file: { ...FILE, name: "original.HEIC", type: "" } });
    expect(storage.presignPut).toHaveBeenCalledWith({ pathname: expect.stringMatching(env === "preview" ? /^preview\/originals\// : /^originals\//), contentType: "image/heic", maxBytes: BYTES.length, validUntil: NOW + 3_600_000, signal: expect.any(AbortSignal) });
  });
  it.each([false, true])("A5: READY match uses %s verified checksum, actual size, ignores metadata and writes nothing", async (verified) => {
    media = [mediaRow({ status: "READY", sizeBytes: BYTES.length, maxBytes: 25 * 1024 ** 2, checksumSha256: verified ? HASH : null, addedVia: verified ? null : "ADMIN", declaredSha256: verified ? null : HASH, caption: "old" })];
    expect(await requestUploadAsAdmin({ ...INPUT, caption: "new" })).toEqual({ ok: true, status: "READY", mediaId: MID, alreadyAttached: true, metadataIgnored: true });
    expect(media[0]!.caption).toBe("old"); expect(db.media.update).not.toHaveBeenCalled(); expect(db.media.create).not.toHaveBeenCalled(); expect(storage.presignPut).not.toHaveBeenCalled();
  });
  it("A5: READY without submitted metadata omits metadataIgnored", async () => {
    media = [mediaRow({ status: "READY", sizeBytes: BYTES.length })];
    expect(await requestUploadAsAdmin(INPUT)).toEqual({ ok: true, status: "READY", mediaId: MID, alreadyAttached: true });
  });
  it.each([
    { status: "READY", sizeBytes: BYTES.length, checksumSha256: "f".repeat(64) },
    { status: "FAILED" }, { deletedAt: new Date(NOW) }, { memoryId: "other" }, { createdAt: new Date(NOW - 86_400_001) },
  ] as Partial<Media>[])("A6: contradicted, failed, deleted, foreign or old identity does not match %j", async (over) => {
    media = [mediaRow(over)];
    expect(await requestUploadAsAdmin(INPUT)).toMatchObject({ ok: true, status: "PENDING" });
    expect(media).toHaveLength(2);
  });
  it.each([false, true])("A7: PENDING reuse overwrites words and renews reservation; blob present=%s", async (present) => {
    media = [mediaRow({ caption: "old", place: "old", approxDateText: "old" })];
    if (present) { land(); }
    const result = await requestUploadAsAdmin({ ...INPUT, caption: "new" });
    expect(result).toMatchObject(present ? { ok: true, mediaId: MID, status: "PENDING", uploaded: true } : { ok: true, mediaId: MID, status: "PENDING", upload: { presignedUrl: PUT_URL } });
    expect(media).toHaveLength(1); expect(media[0]).toMatchObject({ caption: "new", place: null, approxDateText: null, reservedUntil: new Date(NOW + 4_500_000) });
    expect(storage.presignPut).toHaveBeenCalledTimes(present ? 0 : 1);
  });
  it.each(["PENDING", "READY"] as const)("A8: %s same hash with different size or kind conflicts", async (status) => {
    for (const over of [{ maxBytes: BYTES.length + 1, sizeBytes: BYTES.length + 1 }, { mimeType: "video/mp4", sizeBytes: BYTES.length }]) {
      media = [mediaRow({ status, ...over })];
      expect(await requestUploadAsAdmin(INPUT)).toEqual({ ok: false, code: "conflict", mediaId: MID });
    }
    expect(db.media.create).not.toHaveBeenCalled(); expect(storage.presignPut).not.toHaveBeenCalled();
  });
  it.each([
    { durationSeconds: 42, expected: 42 },
    { durationSeconds: 0, expected: null },
    { durationSeconds: undefined, expected: null },
  ])("replaces a reused PENDING video's stale duration with $expected", async ({ durationSeconds, expected }) => {
    media = [mediaRow({ mimeType: "video/mp4", durationSeconds: 7 })];
    await requestUploadAsAdmin({ ...INPUT, file: { ...FILE, name: "clip.mp4", type: "video/mp4" }, durationSeconds });
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ id: MID, durationSeconds: expected });
  });
  it("bounds a stalled presign after commit; retry reuses the durable reservation", async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(20));
    storage.presignPut.mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
      expect(inTransaction).toBe(false);
      expect(media).toHaveLength(1);
      if (!signal) { throw new Error("presign missing deadline"); }
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    await expect(requestUploadAsAdmin(INPUT)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(spy).toHaveBeenCalledExactlyOnceWith(15_000);
    const id = media[0]!.id;
    expect(await requestUploadAsAdmin(INPUT)).toMatchObject({ ok: true, mediaId: id, upload: { presignedUrl: PUT_URL } });
    expect(media).toHaveLength(1);
    expect(db.media.create).toHaveBeenCalledOnce();
    expect(revisions).toEqual([]);
  });
  it("A16: a lost reservation response and a presign failure retry the same durable row", async () => {
    failAfterCommit = true;
    await expect(requestUploadAsAdmin(INPUT)).rejects.toThrow("response lost after commit");
    const id = media[0]!.id;
    storage.presignPut.mockRejectedValueOnce(new Error("presign unavailable"));
    await expect(requestUploadAsAdmin(INPUT)).rejects.toThrow("presign unavailable");
    expect(await requestUploadAsAdmin(INPUT)).toMatchObject({ ok: true, mediaId: id });
    expect(media).toHaveLength(1); expect(revisions).toHaveLength(0);
  });
  it("A17: expired URL renews the same row with a fresh one-hour URL within 24 hours", async () => {
    await requestUploadAsAdmin(INPUT); const id = media[0]!.id;
    vi.mocked(Date.now).mockReturnValue(NOW + 5_000_000);
    expect(await requestUploadAsAdmin(INPUT)).toMatchObject({ ok: true, mediaId: id, upload: { expiresAt: new Date(NOW + 8_600_000) } });
    expect(media).toHaveLength(1);
  });
  it.each(["PENDING", "APPROVED", "HIDDEN"] as const)("A18: refuses a nonready %s without writing", async (status) => {
    Object.assign(memory!, { status, type: "PHOTO", contributorNote: "  " });
    expect(await requestUploadAsAdmin(INPUT)).toEqual({ ok: false, code: "not_ready" });
    expect(locks).toEqual([]); expect(db.media.create).not.toHaveBeenCalled();
  });
  it.each(["text", "words", "ready file"])("accepts a non-DRAFT ready memory with %s", async (reason) => {
    Object.assign(memory!, { status: "APPROVED", type: reason === "text" ? "TEXT" : "PHOTO", contributorNote: reason === "words" ? "Words" : null });
    if (reason === "ready file") { media = [mediaRow({ status: "READY", declaredSha256: "f".repeat(64), sizeBytes: 2 })]; }
    expect(await requestUploadAsAdmin(INPUT)).toMatchObject({ ok: true });
  });
  it("A18: removed and PENDING files do not make a memory ready", async () => {
    Object.assign(memory!, { status: "PENDING", type: "PHOTO", contributorNote: null });
    media = [mediaRow(), mediaRow({ id: randomUUID(), status: "READY", deletedAt: new Date(NOW) })];
    expect(await requestUploadAsAdmin(INPUT)).toEqual({ ok: false, code: "not_ready" });
  });
  it.each(["deleted", "missing", "deleted while locking", "became nonready while locking"])("refuses %s, including a fresh read under the memory lock", async (scenario) => {
    if (scenario === "missing") { memory = null; }
    else if (scenario === "deleted") { memory!.deletedAt = new Date(NOW); }
    else { onLock = () => Object.assign(memory!, scenario === "deleted while locking" ? { deletedAt: new Date(NOW) } : { status: "APPROVED", type: "PHOTO", contributorNote: null }); }
    expect(await requestUploadAsAdmin(INPUT)).toEqual({ ok: false, code: scenario.startsWith("became") ? "not_ready" : "not_found" });
    expect(media).toEqual([]); expect(storage.presignPut).not.toHaveBeenCalled();
  });
  it("refuses unsupported type and each kind's size ceiling", async () => {
    expect(await requestUploadAsAdmin({ ...INPUT, file: { ...FILE, type: "text/html" } })).toEqual({ ok: false, code: "unsupported_type" });
    for (const [type, limit] of [["image/jpeg", 25], ["audio/wav", 100], ["video/mp4", 500]] as const) {
      expect(await requestUploadAsAdmin({ ...INPUT, file: { ...FILE, type, size: limit * 1024 ** 2 + 1 } })).toEqual({ ok: false, code: "too_large" });
    }
  });
  it("refuses the eleventh live file, but permits reuse at the cap", async () => {
    media = Array.from({ length: 10 }, (_, i) => mediaRow({ id: randomUUID(), declaredSha256: i === 0 ? HASH : "f".repeat(64) }));
    expect(await requestUploadAsAdmin({ ...INPUT, file: { ...FILE, sha256: "a".repeat(64) } })).toEqual({ ok: false, code: "too_many_files" });
    expect(await requestUploadAsAdmin(INPUT)).toMatchObject({ ok: true, mediaId: media[0]!.id }); expect(media).toHaveLength(10);
  });
  it("refuses exhausted budgets on new and expired reservations without changing metadata", async () => {
    budgetBytes = 1_000_000_000;
    expect(await requestUploadAsAdmin(INPUT)).toEqual({ ok: false, code: "budget_exceeded" });
    media = [mediaRow({ reservedUntil: new Date(NOW - 1), caption: "old" })];
    expect(await requestUploadAsAdmin({ ...INPUT, caption: "new" })).toEqual({ ok: false, code: "budget_exceeded" });
    expect(media[0]!.caption).toBe("old");
  });
  it("maps a BudgetBusyError to budget_exceeded and propagates other failures", async () => {
    db.$executeRaw.mockRejectedValueOnce(new BudgetBusyError());
    expect(await requestUploadAsAdmin(INPUT)).toEqual({ ok: false, code: "budget_exceeded" });
    db.$executeRaw.mockRejectedValueOnce(new Error("database down"));
    await expect(requestUploadAsAdmin(INPUT)).rejects.toThrow("database down");
  });
});

describe("finalizeUploadAsAdmin", () => {
  beforeEach(() => { media = [mediaRow()]; });
  const args = { memoryId: ID, mediaId: MID };
  it("refuses invalid ids and missing, foreign or deleted resources", async () => {
    expect(await finalizeUploadAsAdmin({ ...args, mediaId: "bad" })).toEqual({ ok: false, code: "invalid" });
    expect(await finalizeUploadAsAdmin({ ...args, memoryId: randomUUID() })).toEqual({ ok: false, code: "not_found" });
    media[0]!.deletedAt = new Date(NOW);
    expect(await finalizeUploadAsAdmin(args)).toEqual({ ok: false, code: "not_found" });
    media[0]!.deletedAt = null; memory!.deletedAt = new Date(NOW);
    expect(await finalizeUploadAsAdmin(args)).toEqual({ ok: false, code: "not_found" });
    media = [];
    expect(await finalizeUploadAsAdmin(args)).toEqual({ ok: false, code: "not_found" });
    expect(storage.head).not.toHaveBeenCalled();
  });
  it.each(["PENDING", "READY", "FAILED"] as const)("refuses a site-reserved %s row before recordMedia or storage access", async (status) => {
    Object.assign(media[0]!, { addedVia: null, declaredSha256: null, status });
    land();
    const before = structuredClone({ media, memory });
    expect(await finalizeUploadAsAdmin(args)).toEqual({ ok: false, code: "not_found" });
    expect(db.media.findUnique).toHaveBeenCalledExactlyOnceWith({ where: { id: MID }, include: { memory: true } });
    for (const call of Object.values(storage)) { expect(call).not.toHaveBeenCalled(); }
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.media.update).not.toHaveBeenCalled();
    expect({ media, memory }).toEqual(before);
    expect(revisions).toEqual([]);
    expect(tasks).toEqual([]);
  });
  it("reports PENDING uploaded false when the blob is absent, true when present but prefix is unavailable", async () => {
    expect(await finalizeUploadAsAdmin(args)).toEqual({ ok: true, status: "PENDING", uploaded: false });
    land(); storage.readPrefix.mockResolvedValue(null);
    expect(await finalizeUploadAsAdmin(args)).toEqual({ ok: true, status: "PENDING", uploaded: true });
    expect(tasks).toHaveLength(0);
  });
  it("maps recordMedia NOT_FOUND if deletion happens after the initial read", async () => {
    db.media.findUnique.mockImplementationOnce(async () => {
      const row = { ...structuredClone(media[0]!), memory: structuredClone(memory) };
      memory!.deletedAt = new Date(NOW); return row;
    });
    expect(await finalizeUploadAsAdmin(args)).toEqual({ ok: false, code: "not_found" });
  });
  it("A12: finalize after cron completion returns READY, decided GPS and the recomputed type with one revision", async () => {
    land();
    await recordMedia({ mediaId: MID });
    Object.assign(media[0]!, { gpsCheckedAt: new Date(NOW), latitude: 40.6892, longitude: -74.0445 });
    expect(await finalizeUploadAsAdmin(args)).toEqual({ ok: true, status: "READY", mediaId: MID, memoryType: "PHOTO", gps: "found" });
    await finalizeUploadAsAdmin(args);
    expect(revisions).toHaveLength(1); expect(memory).toMatchObject({ status: "DRAFT", consentedAt: null });
    expect(tasks).toHaveLength(0);
    expect(derive).not.toHaveBeenCalled();
  });
  it("schedules follow-ups on first completion but queues none when finalize starts READY", async () => {
    land();
    expect(await finalizeUploadAsAdmin(args)).toMatchObject({ ok: true, status: "READY", mediaId: MID });
    expect(tasks).toHaveLength(2);
    for (const task of tasks.splice(0)) { await task(); }
    expect(derive).toHaveBeenCalledExactlyOnceWith({ mediaId: MID, deadlineMs: 20_000 });
    expect(await finalizeUploadAsAdmin(args)).toMatchObject({ ok: true, status: "READY", mediaId: MID });
    expect(tasks).toHaveLength(0);
    expect(revisions).toHaveLength(1);
  });
  it("A13: a small wrong hash fails and deletes the bytes; repeated FAILED has no invented reason", async () => {
    land(); media[0]!.declaredSha256 = "f".repeat(64);
    expect(await finalizeUploadAsAdmin(args)).toEqual({ ok: true, status: "FAILED", reason: "checksum_mismatch" });
    expect(storage.del).toHaveBeenCalledWith(media[0]!.storageKey); expect(revisions).toHaveLength(0);
    expect(await finalizeUploadAsAdmin(args)).toEqual({ ok: true, status: "FAILED" });
  });
  it("A13: a large video becomes READY unhashed for the cron, with GPS pending after a range failure", async () => {
    media[0]!.mimeType = "video/quicktime"; media[0]!.maxBytes = INLINE_HASH_MAX_BYTES + 1;
    land(); storage.head.mockResolvedValue({ size: INLINE_HASH_MAX_BYTES + 1, contentType: "video/quicktime", url: "https://blob.example.invalid/movie" });
    storage.readPrefix.mockResolvedValue(SIGNATURE_SAMPLES["video/quicktime"]!);
    storage.readRange.mockRejectedValue(new RangeNotHonouredError());
    expect(await finalizeUploadAsAdmin(args)).toEqual({ ok: true, status: "READY", mediaId: MID, memoryType: "VIDEO", gps: "pending" });
    expect(media[0]).toMatchObject({ gpsCheckedAt: null, gpsAttempts: 1 });
    expect(media[0]!.checksumSha256).toBeNull(); expect(storage.get).not.toHaveBeenCalled(); expect(revisions).toHaveLength(1);
  });

  it.each([
    { fixture: "location-mdta.mov", gps: "found" },
    { fixture: "no-location.mov", gps: "none" },
  ])("finalizes a MOV with inline GPS $gps from $fixture and reuses its durable result", async ({ fixture, gps }) => {
    const bytes = new Uint8Array(readFileSync(new URL(`../fixtures/${fixture}`, import.meta.url)));
    Object.assign(media[0]!, {
      mimeType: "video/quicktime", storageKey: `dev/originals/${ID}/clip.mov`, originalFilename: "clip.mov",
      maxBytes: bytes.length, declaredSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    land(media[0], bytes);
    const spy = vi.spyOn(AbortSignal, "timeout");
    expect(await finalizeUploadAsAdmin(args)).toEqual({ ok: true, status: "READY", mediaId: MID, memoryType: "VIDEO", gps });
    expect(media[0]).toMatchObject({ gpsCheckedAt: expect.any(Date), gpsAttempts: 1, gpsClaimedAt: null });
    expect(storage.readRange).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(5_000);
    expect(tasks).toHaveLength(2);
    storage.readRange.mockClear(); storage.head.mockClear();
    expect(await finalizeUploadAsAdmin(args)).toMatchObject({ status: "READY", gps });
    expect(storage.readRange).not.toHaveBeenCalled(); expect(storage.head).not.toHaveBeenCalled();
    expect(revisions).toHaveLength(1);
  });

  it.each(["audio/mp4", "video/webm"])("keeps GPS not_applicable for %s", async (mimeType) => {
    media[0] = mediaRow({ status: "READY", mimeType, sizeBytes: BYTES.length });
    expect(await finalizeUploadAsAdmin(args)).toMatchObject({ status: "READY", gps: "not_applicable" });
    expect(media[0]!.gpsAttempts).toBe(0);
    expect(storage.head).not.toHaveBeenCalled(); expect(storage.readRange).not.toHaveBeenCalled();
  });

  it("leaves a MOV location pending without spending an attempt when finalize's budget is exhausted", async () => {
    const bytes = new Uint8Array(readFileSync(new URL("../fixtures/location-mdta.mov", import.meta.url)));
    Object.assign(media[0]!, { mimeType: "video/quicktime", maxBytes: bytes.length, declaredSha256: createHash("sha256").update(bytes).digest("hex") });
    land(media[0], bytes);
    storage.get.mockImplementationOnce(async () => {
      vi.mocked(Date.now).mockReturnValue(NOW + 23_000);
      return { stream: new Blob([bytes]).stream(), contentLength: bytes.length, contentType: "video/quicktime" };
    });
    expect(await finalizeUploadAsAdmin(args)).toMatchObject({ status: "READY", gps: "pending" });
    expect(media[0]!.gpsAttempts).toBe(0);
    expect(storage.readRange).not.toHaveBeenCalled();
  });
  it("A14: wrong size fails before hashing with size_mismatch", async () => {
    land(); media[0]!.maxBytes += 1;
    expect(await finalizeUploadAsAdmin(args)).toEqual({ ok: true, status: "FAILED", reason: "size_mismatch" });
    expect(storage.get).not.toHaveBeenCalled(); expect(revisions).toHaveLength(0);
  });
  it("A15: a never-ending stream aborts at the finalize hash budget and leaves PENDING verifying", async () => {
    land();
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(20));
    storage.get.mockResolvedValue({ stream: new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) }) });
    expect(await finalizeUploadAsAdmin(args)).toEqual({ ok: true, status: "PENDING", uploaded: true, verifying: true });
    expect(spy).toHaveBeenCalledExactlyOnceWith(15_000);
    expect(media[0]!.status).toBe("PENDING"); expect(revisions).toHaveLength(0); expect(storage.del).not.toHaveBeenCalled();
  });
  it("starts no blob download when the initial row read exhausts the hash budget", async () => {
    land();
    db.media.findUnique.mockImplementationOnce(async () => {
      vi.mocked(Date.now).mockReturnValue(NOW + 20_000);
      return { ...structuredClone(media[0]!), memory: structuredClone(memory) };
    });
    expect(await finalizeUploadAsAdmin(args)).toEqual({ ok: true, status: "PENDING", uploaded: true, verifying: true });
    expect(storage.get).not.toHaveBeenCalled();
    expect(media[0]!.status).toBe("PENDING");
    expect(revisions).toEqual([]);
  });
  it.each(["head", "readPrefix"] as const)("bounds a stalled %s through finalize without writing", async (method) => {
    land();
    const before = structuredClone(media);
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(20));
    storage[method].mockImplementation((...args: unknown[]) => {
      const options = args.at(-1) as { signal?: AbortSignal } | undefined;
      const signal = options?.signal;
      if (!signal) { throw new Error(`${method} missing deadline`); }
      return new Promise((_, reject) => signal.addEventListener("abort", () => {
        vi.mocked(Date.now).mockReturnValue(NOW + 25_000);
        reject(signal.reason);
      }, { once: true }));
    });
    expect(await finalizeUploadAsAdmin(args)).toEqual(method === "head"
      ? { ok: true, status: "PENDING", uploaded: false }
      : { ok: true, status: "PENDING", uploaded: true, verifying: true });
    expect(spy).toHaveBeenCalledExactlyOnceWith(15_000);
    expect(storage.head).toHaveBeenCalledOnce();
    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.del).not.toHaveBeenCalled();
    expect(media).toEqual(before);
    expect(revisions).toEqual([]);
  });
  it("skips the extra uploaded probe when the deadline has passed", async () => {
    storage.head.mockImplementationOnce(async () => {
      vi.mocked(Date.now).mockReturnValue(NOW + 25_000);
      return null;
    });
    expect(await finalizeUploadAsAdmin(args)).toEqual({ ok: true, status: "PENDING", uploaded: false });
    expect(storage.head).toHaveBeenCalledOnce();
    expect(db.media.update).not.toHaveBeenCalled();
  });
  it("bounds the extra uploaded probe by the remaining deadline and lets an unknown upload retry", async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(20));
    storage.head.mockImplementationOnce(async () => {
      vi.mocked(Date.now).mockReturnValue(NOW + 24_000);
      return null;
    }).mockImplementationOnce((_pathname: string, options?: { signal?: AbortSignal }) => {
      const signal = options?.signal;
      if (!signal) { throw new Error("uploaded probe missing deadline"); }
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    expect(await finalizeUploadAsAdmin(args)).toEqual({ ok: true, status: "PENDING", uploaded: false });
    expect(spy.mock.calls).toEqual([[15_000], [1_000]]);
    expect(storage.head).toHaveBeenCalledTimes(2);
    expect(db.media.update).not.toHaveBeenCalled();
  });
  it("propagates storage errors from the extra uploaded probe", async () => {
    storage.head.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("head unavailable"));
    await expect(finalizeUploadAsAdmin(args)).rejects.toThrow("head unavailable");
    expect(db.media.update).not.toHaveBeenCalled();
  });
  it("A16: a lost READY commit response retries without a second revision", async () => {
    land(); failAfterCommit = true;
    await expect(finalizeUploadAsAdmin(args)).rejects.toThrow("response lost after commit");
    expect(media[0]!.status).toBe("READY");
    expect(await finalizeUploadAsAdmin(args)).toMatchObject({ ok: true, status: "READY", mediaId: MID });
    expect(revisions).toHaveLength(1);
  });
  it("A16: inline GPS is durable after a lost reply; retry reports the stamp without reading the original again", async () => {
    const bytes = new Uint8Array(readFileSync(new URL("../fixtures/gps.heic", import.meta.url)));
    Object.assign(media[0]!, { mimeType: "image/heic", maxBytes: bytes.length, declaredSha256: createHash("sha256").update(bytes).digest("hex") });
    land(media[0], bytes); failSchedule = true;
    const spy = vi.spyOn(AbortSignal, "timeout");
    await expect(finalizeUploadAsAdmin(args)).rejects.toThrow("response lost after GPS stamp");
    expect(media[0]!.gpsCheckedAt).not.toBeNull();
    expect(spy).toHaveBeenCalledWith(5_000);
    storage.get.mockClear();
    expect(await finalizeUploadAsAdmin(args)).toMatchObject({ status: "READY", gps: "found" });
    expect(storage.get).not.toHaveBeenCalled(); expect(revisions).toHaveLength(1);
  });
  it.each(["none", "pending"])("maps a photo's durable GPS state to %s", async (gps) => {
    media[0] = mediaRow({ status: "READY", sizeBytes: BYTES.length, gpsCheckedAt: gps === "none" ? new Date(NOW) : null, gpsAttempts: 3 });
    expect(await finalizeUploadAsAdmin(args)).toMatchObject({ status: "READY", gps });
  });
  it("skips inline GPS and derive when the call has exhausted their budgets", async () => {
    land();
    storage.get.mockImplementationOnce(async () => {
      // First completion spends its budget hashing, before GPS or deferred derive can start.
      vi.mocked(Date.now).mockReturnValue(NOW + 23_000);
      return { stream: new Blob([BYTES]).stream(), contentLength: BYTES.length, contentType: "image/jpeg" };
    });
    expect(await finalizeUploadAsAdmin(args)).toMatchObject({ status: "READY", gps: "pending" });
    expect(media[0]!.gpsAttempts).toBe(0);
    // Only run the checksum/derive callback: GPS has its separate cron-backed callback.
    await tasks[0]!(); expect(derive).not.toHaveBeenCalled();
  });
});
