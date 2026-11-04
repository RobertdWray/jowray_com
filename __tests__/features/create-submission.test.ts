import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { UPLOAD_LEASE_MS } from "@/lib/upload-ticket";
import { resetEnvCache } from "@/server/config/env";

interface MemoryRow {
  id: string; memorialId: string; contributorId: string; type: string; source: string; status: string; claimTokenHash: string; consentVersion: string; consentedAt: Date; createdAt: Date; deletedAt: Date | null;
  approxDateText: string | null; place: string | null; contributorNote: string | null; visibility: string; notifyWhenPosted: boolean;
  submissionId: string | null; submissionIndex: number | null; uploadLeaseUntil: Date | null;
}
interface MediaRow { id: string; memoryId: string; storageKey: string; mimeType: string; maxBytes: number; status: string; createdAt: Date; originalFilename: string | null; durationSeconds?: number | null; deletedAt: Date | null; sortOrder: number; replacesMediaId: string | null }
const memories: MemoryRow[] = [];
const medias: MediaRow[] = [];
const contributors: Record<string, unknown>[] = [];
let memorial: { id: string; slug: string } | null = { id: "memorial_1", slug: "jo" };
const tx = {
  memorial: { findUnique: vi.fn(async () => memorial) },
  memory: {
    count: vi.fn(async ({ where }: { where?: { createdAt?: { gt: Date } } } = {}) => memories.filter((m) => !where?.createdAt || m.createdAt > where.createdAt.gt).length),
    create: vi.fn(async ({ data }: { data: Omit<MemoryRow, "id" | "createdAt" | "deletedAt"> }) => { const row: MemoryRow = { id: `mem_${memories.length + 1}`, createdAt: new Date(), deletedAt: null, submissionId: null, submissionIndex: null, uploadLeaseUntil: null, ...data }; memories.push(row); return row; }),
  },
  media: {
    aggregate: vi.fn(async ({ where }: { where?: { createdAt?: { gt: Date } } } = {}) => ({ _sum: { maxBytes: medias.filter((m) => !where?.createdAt || m.createdAt > where.createdAt.gt).reduce((s, m) => s + m.maxBytes, 0) || null } })),
    create: vi.fn(async ({ data }: { data: Omit<MediaRow, "id" | "createdAt" | "deletedAt"> }) => { const row: MediaRow = { deletedAt: null, ...data, id: `med_${medias.length + 1}`, createdAt: new Date() }; medias.push(row); return row; }),
  },
  contributor: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `con_${contributors.length + 1}`, ...data }; contributors.push(row); return row; }) },
};
const dbStub = { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));

const afterCalls: Array<() => Promise<void>> = [];
vi.mock("@/lib/sentry/after-flush", () => ({ afterWithFlush: (cb: () => Promise<void>) => { afterCalls.push(cb); } }));

import { createSubmission } from "@/features/memories/create-submission";

const MB = 1024 * 1024;
const photo = { name: "IMG_1.jpg", type: "image/jpeg", size: 2 * MB };
const voice = { name: "clip.webm", type: "audio/webm;codecs=opus", size: 3 * MB, durationSeconds: 24 };
const contributor = { name: "Kay", relationship: "former student", email: "kay@example.com", visibility: "FAMILY" as const, notifyWhenPosted: false, contactOptIn: true, mailingListOptIn: false };
const twoMemories = {
  ...contributor,
  memories: [
    { approxDateText: "Summer 1985", place: "her classroom", note: "She taught me to quilt.", files: [photo, voice] },
    { note: "Second one.", files: [] },
  ],
};

beforeEach(() => {
  afterCalls.length = 0;
  memories.length = 0; medias.length = 0; contributors.length = 0; memorial = { id: "memorial_1", slug: "jo" };
  process.env.UPLOAD_TICKET_SECRET = "s".repeat(32);
  process.env.DAILY_MEMORY_BUDGET = "5";
  process.env.DAILY_BYTE_BUDGET = String(600 * MB);
  process.env.MEMORIAL_SLUG = "jo";
  process.env.CONSENT_VERSION = "2026-11-v2";
  resetEnvCache();
});

describe("createSubmission", () => {
  it("creates one Contributor and N memories with distinct tokens, index 0..N-1, and the shared visibility and notify flag", async () => {
    const result = await createSubmission(twoMemories);
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(contributors).toHaveLength(1);
    expect(contributors[0]).toMatchObject({ name: "Kay", email: "kay@example.com", relationship: "former student", contactOptIn: true, mailingListOptIn: false, memorialId: "memorial_1" });
    expect(result.memories).toHaveLength(2);
    expect(result.memories.map((m) => m.index)).toEqual([0, 1]);
    expect(new Set(result.memories.map((m) => m.claimToken)).size).toBe(2);
    for (const m of result.memories) {
      expect(m.claimToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(memories.find((row) => row.id === m.memoryId)?.claimTokenHash).toBe(hashClaimToken(m.claimToken));
    }
    expect(memories.map((m) => m.submissionIndex)).toEqual([0, 1]);
    expect(memories.every((m) => m.submissionId === result.submissionId && m.contributorId === "con_1")).toBe(true);
    expect(result.submissionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(memories[0]).toMatchObject({ type: "VOICE", source: "WEB_UPLOAD", status: "PENDING", visibility: "FAMILY", notifyWhenPosted: false, consentVersion: "2026-11-v2", approxDateText: "Summer 1985", place: "her classroom", contributorNote: "She taught me to quilt." });
    expect(memories[1]).toMatchObject({ type: "TEXT", visibility: "FAMILY", notifyWhenPosted: false, contributorNote: "Second one.", approxDateText: null, place: null });
  });

  it("creates PENDING media in sortOrder with no tickets, reserving the declared bytes", async () => {
    const result = await createSubmission(twoMemories);
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(medias).toHaveLength(2);
    expect(medias.map((m) => [m.memoryId, m.sortOrder, m.status, m.mimeType, m.maxBytes, m.replacesMediaId])).toEqual([
      ["mem_1", 0, "PENDING", "image/jpeg", 2 * MB, null],
      ["mem_1", 1, "PENDING", "audio/webm", 3 * MB, null],
    ]);
    expect(medias[1]?.durationSeconds).toBe(24);
    expect(medias[0]?.durationSeconds).toBeNull();
    expect(medias[0]?.storageKey).toMatch(/^dev\/originals\/mem_1\/[0-9a-f-]{36}\.jpg$/);
    expect(result.memories[0]?.files).toEqual([{ fileIndex: 0, mediaId: "med_1" }, { fileIndex: 1, mediaId: "med_2" }]);
    expect(result.memories[1]?.files).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("ticket");
  });

  it("refuses the whole send and creates nothing when the memory count or the declared bytes pass the budget", async () => {
    process.env.DAILY_MEMORY_BUDGET = "2"; resetEnvCache();
    memories.push({ id: "old", memorialId: "memorial_1", contributorId: "c", type: "TEXT", source: "WEB_UPLOAD", status: "PENDING", claimTokenHash: "h", consentVersion: "v", consentedAt: new Date(), createdAt: new Date(), deletedAt: null, approxDateText: null, place: null, contributorNote: "x", visibility: "PUBLIC", notifyWhenPosted: true, submissionId: null, submissionIndex: null, uploadLeaseUntil: null });
    expect(await createSubmission(twoMemories)).toMatchObject({ ok: false, code: "budget_exceeded" });
    expect(memories).toHaveLength(1);
    expect(contributors).toHaveLength(0);
    expect(medias).toHaveLength(0);

    process.env.DAILY_MEMORY_BUDGET = "50"; process.env.DAILY_BYTE_BUDGET = String(4 * MB); resetEnvCache();
    expect(await createSubmission(twoMemories)).toMatchObject({ ok: false, code: "budget_exceeded" });
    expect(medias).toHaveLength(0);
    // Declared bytes, not the kind's ceiling: 5 MB of files fit a 6 MB budget although the ceilings sum to 125 MB.
    process.env.DAILY_BYTE_BUDGET = String(6 * MB); resetEnvCache();
    expect((await createSubmission(twoMemories)).ok).toBe(true);
  });

  it("puts the lease on the anchor only, and only when the send has files", async () => {
    const before = Date.now();
    await createSubmission(twoMemories);
    expect(memories[0]?.uploadLeaseUntil?.getTime()).toBeGreaterThanOrEqual(before + UPLOAD_LEASE_MS - 50);
    expect(memories[0]?.uploadLeaseUntil?.getTime()).toBeLessThanOrEqual(Date.now() + UPLOAD_LEASE_MS + 50);
    expect(memories[1]?.uploadLeaseUntil).toBeNull();
    memories.length = 0;
    await createSubmission({ ...contributor, memories: [{ note: "a", files: [] }, { note: "b", files: [] }] });
    expect(memories.map((m) => m.uploadLeaseUntil)).toEqual([null, null]);
  });

  it("assigns indexes 0..N-1 exactly once each (uniqueness by construction)", async () => {
    process.env.DAILY_MEMORY_BUDGET = "50"; resetEnvCache();
    const ten = { ...contributor, memories: Array.from({ length: 10 }, (_, i) => ({ note: `memory ${i}`, files: [] })) };
    const result = await createSubmission(ten);
    expect(result.ok).toBe(true);
    const indexes = memories.map((m) => m.submissionIndex).sort((a, b) => a! - b!);
    expect(indexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(memories.map((m) => m.submissionId)).size).toBe(1);
  });

  it("normalizes recorder MIME types, keeps durations for recordings only, and maps an untyped iPhone photo", async () => {
    const result = await createSubmission({ ...contributor, memories: [{ note: null, files: [{ name: "IMG_1.HEIC", type: "", size: 10 }, { ...photo, durationSeconds: 9 }, voice] }] });
    expect(result.ok).toBe(true);
    expect(medias.map((m) => [m.mimeType, m.durationSeconds ?? null])).toEqual([["image/heic", null], ["image/jpeg", null], ["audio/webm", 24]]);
    expect(memories[0]?.type).toBe("VOICE");
  });

  it("names the card and the file when the input is invalid or a file is refused", async () => {
    expect(await createSubmission({ ...contributor, memories: [{ note: "ok", files: [] }, { note: "  ", files: [] }] })).toMatchObject({ ok: false, code: "invalid", memoryIndex: 1, fileIndex: null });
    expect(await createSubmission({ ...contributor, memories: [{ note: "ok", files: [] }, { note: null, files: [photo, { name: "x.exe", type: "application/x-msdownload", size: 1 }] }] })).toMatchObject({ ok: false, code: "unsupported_type", memoryIndex: 1, fileIndex: 1 });
    expect(await createSubmission({ ...contributor, memories: [{ note: null, files: [{ ...photo, size: 30 * MB }] }] })).toMatchObject({ ok: false, code: "too_large", memoryIndex: 0, fileIndex: 0 });
    expect(await createSubmission({ ...contributor, email: "nope", memories: [{ note: "ok", files: [] }] })).toMatchObject({ ok: false, code: "invalid", memoryIndex: null, fileIndex: null });
    expect(memories).toHaveLength(0);
    expect(contributors).toHaveLength(0);
  });

  it("does not send any email or alert itself in this step (completion owns the receipt once the files land)", async () => {
    await createSubmission(twoMemories);
    expect(afterCalls).toHaveLength(0);
  });
});
