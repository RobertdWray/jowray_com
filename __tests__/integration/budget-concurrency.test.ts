/**
 * Budget allocation under real concurrency (issue #44, Oscar #13; decision D7).
 *
 * The race this guards against is a Postgres isolation property, so the
 * in-memory mocks cannot show it. This file runs only when TEST_DATABASE_URL
 * names a Postgres database whose schema is at the repo's latest migration
 * (`prisma migrate deploy`), which CI provides as a service container; locally
 * it is skipped unless you point it at a throwaway database. It never reads
 * the app's own DATABASE_URL.
 *
 * Every case leaves exactly one unit of capacity and fires many writers at
 * once: exactly one may win, and the table must end at the budget, never past
 * it. Remove `lockBudget` from `withinBudget` and these cases fail.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { TX_OPTIONS } from "@/features/memories/create-memory";
import { resetEnvCache } from "@/server/config/env";

const url = process.env.TEST_DATABASE_URL;
const client = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 40 }) }) : null;
vi.mock("@/server/db/client", () => ({ getDb: () => client }));
// Everything after the transaction is somebody else's: the receipt (sibling issue A) and telemetry.
vi.mock("@/features/memories/complete-submission", () => ({ completeSubmission: async () => ({ ok: true, emailed: false }) }));
vi.mock("@/lib/sentry/user", () => ({ identifyContributor: () => undefined, tagIds: () => undefined }));
vi.mock("@/lib/sentry/metrics", () => ({ memoryCreated: () => undefined, uploadFinalized: () => undefined, confirmationSent: () => undefined, reconcileRun: () => undefined }));

import { createReplacementTicket, createUploadTicket } from "@/features/memories/create-memory";
import { createSubmission } from "@/features/memories/create-submission";

const MB = 1024 * 1024;
const WRITERS = 20;
const SLUG = "budget-concurrency-test";
const contributor = { name: "Kay", email: "kay@example.com", visibility: "FAMILY" as const, notifyWhenPosted: false, contactOptIn: false, mailingListOptIn: false };
const textOnly = { ...contributor, memories: [{ note: "one memory", files: [] }] };
const oneVideo = { ...contributor, memories: [{ note: null, files: [{ name: "v.mp4", type: "video/mp4", size: 500 * MB }] }] };
const onePhoto = { ...contributor, memories: [{ note: null, files: [{ name: "p.jpg", type: "image/jpeg", size: 25 * MB }] }] };

function setBudgets(env: { memories?: number; bytes?: number }): void {
  process.env.DAILY_MEMORY_BUDGET = String(env.memories ?? 1_000);
  process.env.DAILY_BYTE_BUDGET = String(env.bytes ?? 100 * 1024 ** 3);
  resetEnvCache();
}

/** Runs `n` writers at once and returns their results with the slowest wall time. */
async function race<T>(n: number, writer: (i: number) => Promise<T>): Promise<{ results: T[]; slowestMs: number }> {
  const started = Date.now();
  const timed = await Promise.all(Array.from({ length: n }, async (_, i) => { const t = Date.now(); const result = await writer(i); return { result, ms: Date.now() - t }; }));
  return { results: timed.map((t) => t.result), slowestMs: Math.max(...timed.map((t) => t.ms), Date.now() - started) };
}

describe.skipIf(!client)("budget allocation under concurrency (real Postgres)", () => {
  const db = client!;

  beforeAll(async () => {
    process.env.UPLOAD_TICKET_SECRET = "s".repeat(32);
    process.env.MEMORIAL_SLUG = SLUG;
    process.env.CONSENT_VERSION = "2026-11-v2";
    delete process.env.TOTAL_BYTE_CEILING;
    delete process.env.MAX_DECLARED_BYTES_PER_SUBMISSION;
    await db.memorial.upsert({ where: { slug: SLUG }, create: { name: "Budget test", slug: SLUG }, update: {} });
  });

  beforeEach(async () => {
    // Contributor → Memory → Media / DerivedMedia / MemoryRevision / EmailLog all cascade from here; the memorial stays.
    await db.$executeRawUnsafe('TRUNCATE "Contributor", "Memory" CASCADE');
    setBudgets({});
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("exactly one of many concurrent sends wins the last memory of the day", async () => {
    setBudgets({ memories: 1 });
    const { results, slowestMs } = await race(WRITERS, () => createSubmission(textOnly));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.code === "budget_exceeded")).toBe(true);
    expect(await db.memory.count()).toBe(1);
    expect(slowestMs).toBeLessThan(TX_OPTIONS.timeout);
  });

  it("exactly one of many concurrent sends wins the last 500 MB of the day", async () => {
    setBudgets({ bytes: 500 * MB });
    const { results } = await race(WRITERS, () => createSubmission(oneVideo));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const reserved = await db.media.aggregate({ _sum: { maxBytes: true } });
    expect(reserved._sum.maxBytes).toBe(500 * MB);
  });

  it("sends, claim-page adds and replacements racing for the last 25 MB: one winner across all three writers", async () => {
    // One photo already stored today (1 MB declared, READY) leaves exactly one photo ceiling of budget.
    const seeded = await createSubmission({ ...contributor, memories: [{ note: null, files: [{ name: "a.jpg", type: "image/jpeg", size: 1 * MB }] }] });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) { return; }
    const claimToken = seeded.memories[0]!.claimToken;
    const targetId = seeded.memories[0]!.files[0]!.mediaId;
    await db.media.update({ where: { id: targetId }, data: { status: "READY", sizeBytes: 1 * MB, blobUrl: "https://blob.invalid/a.jpg" } });
    setBudgets({ bytes: 1 * MB + 25 * MB });

    const { results, slowestMs } = await race(WRITERS + 1, (i): Promise<{ ok: boolean }> => {
      if (i % 3 === 0) { return createSubmission(onePhoto); }
      if (i % 3 === 1) { return createUploadTicket({ claimToken, file: { name: `add${i}.jpg`, type: "image/jpeg", size: 1 } }); }
      return createReplacementTicket({ claimToken, mediaId: targetId, file: { name: `rep${i}.jpg`, type: "image/jpeg", size: 1 } });
    });
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const reserved = await db.media.aggregate({ _sum: { maxBytes: true } });
    expect(reserved._sum.maxBytes).toBe(1 * MB + 25 * MB);
    expect(slowestMs).toBeLessThan(TX_OPTIONS.timeout);
  });

  it("capacity that is really there is handed out in full: N units, N winners", async () => {
    setBudgets({ memories: 7 });
    const { results } = await race(WRITERS, () => createSubmission(textOnly));
    expect(results.filter((r) => r.ok)).toHaveLength(7);
    expect(await db.memory.count()).toBe(7);
  });
});
