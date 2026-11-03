import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { verifyUploadTicket } from "@/lib/upload-ticket";
import { resetEnvCache } from "@/server/config/env";

interface MemoryRow { id: string; memorialId: string; contributorId: string; type: string; source: string; status: string; claimTokenHash: string; consentVersion: string; consentedAt: Date; createdAt: Date; deletedAt: Date | null; approxDateText: string | null; contributorNote: string | null; visibility: string }
interface MediaRow { id: string; memoryId: string; storageKey: string; mimeType: string; maxBytes: number; status: string; createdAt: Date; originalFilename: string | null }
const memories: MemoryRow[] = [];
const medias: MediaRow[] = [];
const contributors: Record<string, unknown>[] = [];
let memorial: { id: string; slug: string } | null = { id: "memorial_1", slug: "jo" };
const tx = {
  memorial: { findUnique: vi.fn(async () => memorial) },
  memory: {
    count: vi.fn(async ({ where }: { where?: { createdAt?: { gt: Date } } } = {}) => memories.filter((m) => !where?.createdAt || m.createdAt > where.createdAt.gt).length),
    create: vi.fn(async ({ data }: { data: Omit<MemoryRow, "id" | "createdAt" | "deletedAt"> }) => { const row: MemoryRow = { id: `mem_${memories.length + 1}`, createdAt: new Date(), deletedAt: null, ...data }; memories.push(row); return row; }),
    findUnique: vi.fn(async ({ where }: { where: { claimTokenHash: string } }) => memories.find((m) => m.claimTokenHash === where.claimTokenHash) ?? null),
  },
  media: {
    aggregate: vi.fn(async ({ where }: { where?: { createdAt?: { gt: Date } } } = {}) => ({ _sum: { maxBytes: medias.filter((m) => !where?.createdAt || m.createdAt > where.createdAt.gt).reduce((s, m) => s + m.maxBytes, 0) || null } })),
    count: vi.fn(async ({ where }: { where: { memoryId: string } }) => medias.filter((m) => m.memoryId === where.memoryId).length),
    create: vi.fn(async ({ data }: { data: Omit<MediaRow, "id" | "createdAt"> }) => { const row: MediaRow = { id: `med_${medias.length + 1}`, createdAt: new Date(), ...data }; medias.push(row); return row; }),
  },
  contributor: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `con_${contributors.length + 1}`, ...data }; contributors.push(row); return row; }) },
};
const dbStub = { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));

const confirmMock = vi.fn(async (_arg: unknown) => ({ sent: true, messageId: "m1" }));
vi.mock("@/features/memories/confirm", () => ({ confirmMemory: (arg: unknown) => confirmMock(arg) }));

import { createMemory, createUploadTicket } from "@/features/memories/create-memory";

const valid = {
  name: "Jo Friend",
  relationship: "neighbour",
  email: "jo@example.com",
  approxDateText: "Summer 1998",
  note: "We laughed a lot.",
  visibility: "FAMILY" as const,
  storageConsent: true,
  contactOptIn: false,
  file: { name: "voice.m4a", type: "audio/mp4", size: 1024 * 1024 },
};

beforeEach(() => {
  memories.length = 0; medias.length = 0; contributors.length = 0; memorial = { id: "memorial_1", slug: "jo" };
  process.env.UPLOAD_TICKET_SECRET = "s".repeat(32);
  process.env.DAILY_MEMORY_BUDGET = "3";
  process.env.DAILY_BYTE_BUDGET = String(600 * 1024 * 1024);
  process.env.MEMORIAL_SLUG = "jo";
  process.env.CONSENT_VERSION = "2026-11-v1";
  resetEnvCache();
});

describe("createMemory", () => {
  it("creates contributor, PENDING memory and PENDING media, returns a verifiable ticket", async () => {
    const result = await createMemory(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(result.memoryId).toBe("mem_1");
    expect(result.claimToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(memories[0]?.claimTokenHash).toBe(hashClaimToken(result.claimToken));
    expect(memories[0]).toMatchObject({ type: "VOICE", source: "WEB_UPLOAD", status: "PENDING", consentVersion: "2026-11-v1", contributorNote: "We laughed a lot." });
    expect(contributors[0]).toMatchObject({ name: "Jo Friend", email: "jo@example.com", contactOptIn: false, memorialId: "memorial_1" });
    expect(result.upload?.pathname).toMatch(/^originals\/mem_1\/[0-9a-f-]{36}\.m4a$/);
    expect(medias[0]).toMatchObject({ status: "PENDING", mimeType: "audio/mp4", maxBytes: 100 * 1024 * 1024, storageKey: result.upload?.pathname });
    const verified = verifyUploadTicket(result.upload!.ticket);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.claims).toMatchObject({ mediaId: "med_1", memoryId: "mem_1", pathname: result.upload?.pathname, mimeType: "audio/mp4", maxBytes: 100 * 1024 * 1024 });
    }
  });

  it("normalizes a recorder MIME type with parameters before ticketing", async () => {
    const result = await createMemory({ ...valid, file: { name: "clip.webm", type: "audio/webm;codecs=opus", size: 10 } });
    expect(result.ok && result.upload?.ticket.mimeType).toBe("audio/webm");
    expect(result.ok && result.upload?.pathname).toMatch(/\.webm$/);
  });

  it("maps an untyped iPhone photo from its extension", async () => {
    const result = await createMemory({ ...valid, file: { name: "IMG_1.HEIC", type: "", size: 10 } });
    expect(result.ok && result.upload?.ticket.mimeType).toBe("image/heic");
    expect(memories[0]?.type).toBe("PHOTO");
  });

  it("creates a TEXT memory with no media when there is no file", async () => {
    const result = await createMemory({ ...valid, file: null });
    expect(result.ok).toBe(true);
    expect(result.ok && result.upload).toBeNull();
    expect(result.ok && result.emailed).toBe(true);
    expect(confirmMock).toHaveBeenCalledWith({ memoryId: "mem_1", claimToken: result.ok ? result.claimToken : "" });
    expect(memories[0]?.type).toBe("TEXT");
    expect(medias).toHaveLength(0);
  });

  it("rejects without storage consent, without note and file, or with a disallowed type", async () => {
    expect(await createMemory({ ...valid, storageConsent: false })).toMatchObject({ ok: false, code: "invalid" });
    expect(await createMemory({ ...valid, note: "", file: null })).toMatchObject({ ok: false, code: "invalid" });
    expect(await createMemory({ ...valid, file: { name: "x.svg", type: "image/svg+xml", size: 10 } })).toMatchObject({ ok: false, code: "unsupported_type" });
    expect(await createMemory({ ...valid, file: { name: "big.mov", type: "video/quicktime", size: 501 * 1024 * 1024 } })).toMatchObject({ ok: false, code: "too_large" });
    expect(memories).toHaveLength(0);
  });

  it("refuses when the daily memory budget is reached", async () => {
    for (let i = 0; i < 3; i += 1) { expect((await createMemory({ ...valid, file: null })).ok).toBe(true); }
    expect(await createMemory({ ...valid, file: null })).toMatchObject({ ok: false, code: "budget_exceeded" });
  });

  it("refuses when the daily byte budget would be exceeded", async () => {
    const video = { name: "a.mp4", type: "video/mp4", size: 1 };
    expect((await createMemory({ ...valid, file: video })).ok).toBe(true); // 500 MB ticketed
    expect(await createMemory({ ...valid, file: video })).toMatchObject({ ok: false, code: "budget_exceeded" });
  });
});

describe("createUploadTicket", () => {
  it("mints a ticket for an existing memory and caps at 10 media rows", async () => {
    const created = await createMemory({ ...valid, file: null });
    if (!created.ok) { throw new Error("setup"); }
    process.env.DAILY_BYTE_BUDGET = String(100 * 1024 ** 3); resetEnvCache();
    for (let i = 0; i < 10; i += 1) {
      const t = await createUploadTicket({ claimToken: created.claimToken, file: { name: `p${i}.jpg`, type: "image/jpeg", size: 1 } });
      expect(t.ok).toBe(true);
    }
    expect(await createUploadTicket({ claimToken: created.claimToken, file: { name: "p.jpg", type: "image/jpeg", size: 1 } })).toEqual({ ok: false, code: "too_many_files" });
    expect(await createUploadTicket({ claimToken: "w".repeat(43), file: { name: "p.jpg", type: "image/jpeg", size: 1 } })).toEqual({ ok: false, code: "not_found" });
  });
});
