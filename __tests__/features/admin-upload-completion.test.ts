/**
 * The admin completion path inside `recordMedia` (plan
 * docs/plans/2026-11-06-mcp-attach-media.md §8.3, D3, D10; acceptance A11-A16
 * at the unit level; the real-Postgres race is P2-A5's integration suite).
 *
 * A row with `addedVia = ADMIN` (a file attached through the MCP connector)
 * must arrive at exactly its declared size, is hashed before READY when it is
 * at most INLINE_HASH_MAX_BYTES, and its READY transition writes one ADMIN
 * revision in the same locked transaction, whoever completes it (finalize or
 * cron step (a)). Site uploads (addedVia null) keep today's behaviour.
 */
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SIGNATURE_SAMPLES } from "../fixtures/signatures";

type Status = "PENDING" | "READY" | "FAILED";
interface MediaRow {
  id: string;
  memoryId: string;
  storageKey: string;
  mimeType: string;
  maxBytes: number;
  status: Status;
  sizeBytes: number | null;
  blobUrl: string | null;
  checksumSha256: string | null;
  declaredSha256: string | null;
  addedVia: "ADMIN" | null;
  deletedAt: Date | null;
  replacesMediaId: string | null;
  sortOrder: number;
  createdAt: Date;
}
interface Revision { memoryId: string; changedVia: string; before: Record<string, unknown>; after: Record<string, unknown> }

const MB = 1024 * 1024;
const BYTES = new Uint8Array([...SIGNATURE_SAMPLES["image/jpeg"]!, ...new Array<number>(2048).fill(7)]);
const DIGEST = createHash("sha256").update(BYTES).digest("hex");

let media: MediaRow[];
let revisions: Revision[];
let memoryType: string | null;
let failNextReadyUpdate: (() => void) | null;
const lockCalls: string[] = [];

function matches(row: MediaRow, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === "NOT") {
      const not = value as { id?: string };
      if (not.id !== undefined && row.id === not.id) { return false; }
      continue;
    }
    if ((row as unknown as Record<string, unknown>)[key] !== value) { return false; }
  }
  return true;
}

const db = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    lockCalls.push(`${strings.join("?")}|${String(values[0])}`);
    return [{ id: values[0] }];
  }),
  /** Snapshot and restore on a throw, like a rolled-back transaction. */
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const before = structuredClone({ media, revisions, memoryType });
    try {
      return await fn(db);
    } catch (error) {
      ({ media, revisions, memoryType } = before);
      throw error;
    }
  }),
  memory: {
    findUniqueOrThrow: vi.fn(async () => ({ contributorNote: null, consentVersion: "2026-11-v2" })),
    update: vi.fn(async ({ data }: { data: { type: string } }) => { memoryType = data.type; return data; }),
  },
  memoryRevision: {
    count: vi.fn(async () => revisions.length),
    create: vi.fn(async ({ data }: { data: Revision }) => { revisions.push(data); return data; }),
  },
  media: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const found = media.find((m) => m.id === where.id);
      return found ? { ...structuredClone(found), memory: { deletedAt: null } } : null;
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      media.filter((m) => matches(m, where)).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime()).map((m) => ({ id: m.id, mimeType: m.mimeType }))
    ),
    update: vi.fn(async ({ where, data }: { where: { id: string; status?: Status }; data: Partial<MediaRow> }) => {
      const found = media.find((m) => m.id === where.id);
      if (!found || (where.status && found.status !== where.status)) {
        throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
      }
      if (data.status === "READY" && failNextReadyUpdate) {
        const hook = failNextReadyUpdate;
        failNextReadyUpdate = null;
        hook();
        throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
      }
      Object.assign(found, data);
      return found;
    }),
  },
};
vi.mock("@/server/db/client", () => ({ getDb: () => db }));

const headMock = vi.fn();
const delMock = vi.fn();
const readPrefixMock = vi.fn(async () => BYTES.subarray(0, 64));
const getMock = vi.fn();
vi.mock("@/services/storage", () => ({
  createStorageService: () => ({ head: headMock, del: delMock, readPrefix: readPrefixMock, get: getMock }),
}));

import { computeChecksum, INLINE_HASH_MAX_BYTES, recordMedia } from "@/features/memories/ingest-upload";

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new Blob([new Uint8Array(bytes)]).stream();
}

/** A body that never ends: one chunk, then silence (a stalled transfer). */
function stalledStream(): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(BYTES.subarray(0, 16));
      }
      return new Promise<void>(() => {});
    },
  });
}

function adminRow(over: Partial<MediaRow> = {}): MediaRow {
  return {
    id: "med_admin",
    memoryId: "mem_1",
    storageKey: "dev/originals/mem_1/admin.jpg",
    mimeType: "image/jpeg",
    maxBytes: BYTES.byteLength,
    status: "PENDING",
    sizeBytes: null,
    blobUrl: null,
    checksumSha256: null,
    declaredSha256: DIGEST,
    addedVia: "ADMIN",
    deletedAt: null,
    replacesMediaId: null,
    sortOrder: 1,
    createdAt: new Date("2026-11-07T01:00:00Z"),
    ...over,
  };
}

const existingReady: MediaRow = {
  ...adminRow(),
  id: "med_old",
  storageKey: "dev/originals/mem_1/old.jpg",
  status: "READY",
  sizeBytes: 10,
  blobUrl: "https://blob.test/old.jpg",
  declaredSha256: null,
  addedVia: null,
  sortOrder: 0,
  createdAt: new Date("2026-11-06T01:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  media = [structuredClone(existingReady), adminRow()];
  revisions = [];
  memoryType = null;
  failNextReadyUpdate = null;
  lockCalls.length = 0;
  headMock.mockImplementation(async (pathname: string) => {
    const found = media.find((m) => m.storageKey === pathname);
    return found ? { pathname, url: `https://blob.test/${pathname}`, size: BYTES.byteLength, contentType: found.mimeType, uploadedAt: new Date() } : null;
  });
  getMock.mockImplementation(async () => ({ stream: streamOf(BYTES), contentType: "image/jpeg", contentLength: BYTES.byteLength }));
});

describe("recordMedia: admin completion path (D10)", () => {
  it("A12: exact size and matching hash → READY with the verified checksum and one ADMIN revision of the READY files", async () => {
    const result = await recordMedia({ mediaId: "med_admin" });
    expect(result).toEqual({ status: "READY", mediaId: "med_admin", memoryId: "mem_1", sizeBytes: BYTES.byteLength });
    const row = media.find((m) => m.id === "med_admin")!;
    expect(row).toMatchObject({ status: "READY", checksumSha256: DIGEST, sizeBytes: BYTES.byteLength });
    expect(revisions).toEqual([
      { memoryId: "mem_1", changedVia: "ADMIN", before: { readyMediaIds: ["med_old"] }, after: { readyMediaIds: ["med_old", "med_admin"], addedMediaId: "med_admin", consentVersion: "2026-11-v2" } },
    ]);
    expect(lockCalls.every((call) => call.endsWith("|mem_1"))).toBe(true);
    expect(delMock).not.toHaveBeenCalled();
  });

  it("A12: a repeat after READY answers READY without hashing again or writing a second revision", async () => {
    await recordMedia({ mediaId: "med_admin" });
    getMock.mockClear();
    expect((await recordMedia({ mediaId: "med_admin" })).status).toBe("READY");
    expect(getMock).not.toHaveBeenCalled();
    expect(revisions).toHaveLength(1);
  });

  it("A12: the stored verified checksum is what computeChecksum later answers, without re-reading the blob", async () => {
    await recordMedia({ mediaId: "med_admin" });
    getMock.mockClear();
    expect(await computeChecksum({ mediaId: "med_admin" })).toBe(DIGEST);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("A14: a size that differs from the declared size fails as size_mismatch, deletes the blob and never hashes", async () => {
    media = [structuredClone(existingReady), adminRow({ maxBytes: BYTES.byteLength + 1 })];
    expect(await recordMedia({ mediaId: "med_admin" })).toEqual({ status: "FAILED", mediaId: "med_admin", memoryId: "mem_1", reason: "size_mismatch" });
    expect(media.find((m) => m.id === "med_admin")!.status).toBe("FAILED");
    expect(delMock).toHaveBeenCalledExactlyOnceWith("dev/originals/mem_1/admin.jpg");
    expect(getMock).not.toHaveBeenCalled();
    expect(revisions).toEqual([]);
  });

  it("A13: a hash that differs from the declared one (≤ 50 MB) fails as checksum_mismatch and deletes the blob", async () => {
    media = [structuredClone(existingReady), adminRow({ declaredSha256: "f".repeat(64) })];
    expect(await recordMedia({ mediaId: "med_admin" })).toEqual({ status: "FAILED", mediaId: "med_admin", memoryId: "mem_1", reason: "checksum_mismatch" });
    expect(media.find((m) => m.id === "med_admin")).toMatchObject({ status: "FAILED", checksumSha256: null });
    expect(delMock).toHaveBeenCalledExactlyOnceWith("dev/originals/mem_1/admin.jpg");
    expect(revisions).toEqual([]);
  });

  it("A13: above INLINE_HASH_MAX_BYTES the file becomes READY unhashed (cron step (b) hashes it later), with its revision", async () => {
    const size = INLINE_HASH_MAX_BYTES + MB;
    media = [structuredClone(existingReady), adminRow({ maxBytes: size, mimeType: "video/quicktime", storageKey: "dev/originals/mem_1/admin.mov" })];
    headMock.mockImplementation(async (pathname: string) => ({ pathname, url: `https://blob.test/${pathname}`, size, contentType: "video/quicktime", uploadedAt: new Date() }));
    readPrefixMock.mockResolvedValueOnce(SIGNATURE_SAMPLES["video/quicktime"]!);
    expect(await recordMedia({ mediaId: "med_admin" })).toMatchObject({ status: "READY", sizeBytes: size });
    expect(getMock).not.toHaveBeenCalled();
    expect(media.find((m) => m.id === "med_admin")!.checksumSha256).toBeNull();
    expect(revisions).toHaveLength(1);
  });

  it("A15: a stalled stream is abandoned at the caller's deadline: PENDING (verifying), nothing written, nothing deleted", async () => {
    getMock.mockImplementation(async () => ({ stream: stalledStream(), contentType: "image/jpeg", contentLength: BYTES.byteLength }));
    const result = await recordMedia({ mediaId: "med_admin", signal: AbortSignal.timeout(30) });
    expect(result).toEqual({ status: "PENDING", mediaId: "med_admin", memoryId: "mem_1", verifying: true });
    expect(media.find((m) => m.id === "med_admin")).toMatchObject({ status: "PENDING", checksumSha256: null, sizeBytes: null });
    expect(revisions).toEqual([]);
    expect(delMock).not.toHaveBeenCalled();
  });

  it("A15: an already-aborted signal answers PENDING (verifying) before any write", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await recordMedia({ mediaId: "med_admin", signal: controller.signal })).toMatchObject({ status: "PENDING", verifying: true });
    expect(media.find((m) => m.id === "med_admin")!.status).toBe("PENDING");
  });

  it("a stream failure that is not the caller's deadline is thrown, never hidden, and writes nothing", async () => {
    getMock.mockImplementation(async () => ({
      stream: new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error("socket hang up")); } }),
      contentType: "image/jpeg",
      contentLength: BYTES.byteLength,
    }));
    await expect(recordMedia({ mediaId: "med_admin", signal: AbortSignal.timeout(5_000) })).rejects.toThrow("socket hang up");
    expect(media.find((m) => m.id === "med_admin")!.status).toBe("PENDING");
    expect(revisions).toEqual([]);
  });

  it("a blob that vanished before the hash leaves the row PENDING (not verifying), deleting nothing", async () => {
    getMock.mockResolvedValue(null);
    expect(await recordMedia({ mediaId: "med_admin" })).toEqual({ status: "PENDING", mediaId: "med_admin", memoryId: "mem_1" });
    expect(delMock).not.toHaveBeenCalled();
  });

  it("A11 (unit): a lost race rolls back this attempt (no revision of its own); the winner's READY is reported", async () => {
    // The conditional update matches nothing (P2025): another completion, finalize or cron step (a), committed first.
    failNextReadyUpdate = () => {};
    const winnersRevision: Revision = { memoryId: "mem_1", changedVia: "ADMIN", before: { readyMediaIds: ["med_old"] }, after: { readyMediaIds: ["med_old", "med_admin"], addedMediaId: "med_admin" } };
    db.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
      const before = structuredClone({ media, revisions });
      try {
        return await fn(db);
      } catch (error) {
        // Roll this attempt back, then show the state the winner committed.
        ({ media, revisions } = before);
        Object.assign(media.find((m) => m.id === "med_admin")!, { status: "READY", sizeBytes: BYTES.byteLength, checksumSha256: DIGEST });
        revisions.push(winnersRevision);
        throw error;
      }
    });
    expect(await recordMedia({ mediaId: "med_admin" })).toEqual({ status: "READY", mediaId: "med_admin", memoryId: "mem_1", sizeBytes: BYTES.byteLength });
    expect(revisions).toEqual([winnersRevision]);
  });
});

describe("recordMedia: site uploads are unchanged", () => {
  it("a row without addedVia is never hashed before READY and writes no ADMIN revision, even with a signal", async () => {
    media = [structuredClone(existingReady), adminRow({ addedVia: null, declaredSha256: null, maxBytes: 25 * MB })];
    expect((await recordMedia({ mediaId: "med_admin", signal: AbortSignal.timeout(5_000) })).status).toBe("READY");
    expect(getMock).not.toHaveBeenCalled();
    expect(revisions).toEqual([]);
    expect(media.find((m) => m.id === "med_admin")!.checksumSha256).toBeNull();
  });
});

describe("computeChecksum({ signal })", () => {
  beforeEach(() => {
    media = [{ ...adminRow({ addedVia: null, declaredSha256: null }), status: "READY", sizeBytes: BYTES.byteLength }];
  });

  it("passes the caller's signal to the store and stores the digest", async () => {
    const signal = AbortSignal.timeout(5_000);
    expect(await computeChecksum({ mediaId: "med_admin", signal })).toBe(DIGEST);
    expect(getMock).toHaveBeenCalledWith("dev/originals/mem_1/admin.jpg", { signal });
    expect(media[0]!.checksumSha256).toBe(DIGEST);
  });

  it("rejects when the signal fires on a stalled stream and stores nothing", async () => {
    getMock.mockImplementation(async () => ({ stream: stalledStream(), contentType: "image/jpeg", contentLength: BYTES.byteLength }));
    await expect(computeChecksum({ mediaId: "med_admin", signal: AbortSignal.timeout(30) })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(media[0]!.checksumSha256).toBeNull();
  });
});
