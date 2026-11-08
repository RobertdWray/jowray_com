/**
 * A1/A3: real Postgres proves the consent CHECK, the suppression row's unique
 * key, the claim filter's NULL semantics and suppression after a sender adds media.
 * The lifecycle uses the real share, notify and email service. Every write rolls back. TEST_DATABASE_URL is
 * CI's migrated database; the app's DATABASE_URL is never read by this suite.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMemoryForAdmin } from "@/features/admin/get-memory";
import { shareDraftAsAdmin } from "@/features/admin/share-draft";
import { lockMemory } from "@/features/memories/lock";
import { notifyAdminsOfMemory } from "@/features/memories/notify-admins";
import { PrismaClient } from "@/generated/prisma/client";
import { resetEnvCache } from "@/server/config/env";
import { claimableWhere, suppressAdminAlertForDraftShare } from "@/services/email";

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("@sendgrid/mail", () => ({
  default: { setApiKey: vi.fn(), setTimeout: vi.fn(), send: sendMock },
}));

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) {
  throw new Error("TEST_DATABASE_URL is not set in CI; the share-draft suite must run there");
}
const client = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) : null;
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
/** Features use the enclosing rollback transaction; Prisma 7.10 nests their transactions as savepoints. */
let current: Tx | null = null;
vi.mock("@/server/db/client", () => ({ getDb: () => current }));
class RolledBack extends Error {}

async function attempt(write: (tx: Tx, memorialId: string) => Promise<unknown>): Promise<unknown> {
  try {
    await client!.$transaction(async (tx) => {
      current = tx;
      try {
        const memorial = await tx.memorial.create({ data: { name: "Share draft test", slug: `share-draft-${crypto.randomUUID()}` } });
        await write(tx, memorial.id);
      } finally {
        current = null;
      }
      throw new RolledBack();
    });
  } catch (error) {
    return error instanceof RolledBack ? null : error;
  }
  throw new Error("unreachable: the transaction always throws");
}

function draft(memorialId: string) {
  return { memorialId, type: "TEXT", source: "OTHER", status: "DRAFT", consentVersion: "draft-test", consentedAt: null, claimTokenHash: crypto.randomUUID().replaceAll("-", "").padEnd(64, "0") } as const;
}

function postgresCause(error: unknown): { code?: unknown; message?: unknown } {
  return (error as { meta?: { driverAdapterError?: { cause?: { code?: unknown; message?: unknown } } } }).meta?.driverAdapterError?.cause ?? {};
}

describe.skipIf(!client)("share draft invariants (real Postgres, A1/A3)", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue([{ statusCode: 202, headers: { "x-message-id": "share-draft-test" } }, {}]);
    vi.stubEnv("MEMORIAL_SLUG", "share-draft-test");
    vi.stubEnv("CONSENT_VERSION", "share-test");
    vi.stubEnv("OUTBOUND_ENABLED", "true");
    vi.stubEnv("ADMIN_ALERT_EMAILS", "alerts@example.invalid");
    vi.stubEnv("SENDGRID_API_KEY", "SG.test");
    vi.stubEnv("SENDGRID_FROM_EMAIL", "memories@example.invalid");
    resetEnvCache();
  });
  afterEach(() => { vi.unstubAllEnvs(); resetEnvCache(); });
  afterAll(async () => { await client!.$disconnect(); });

  it.each(["PENDING", "APPROVED"] as const)("accepts DRAFT to %s with the consent stamp", async (status) => {
    const consentedAt = new Date("2026-11-07T03:00:00.000Z");
    const stored: unknown[] = [];
    const error = await attempt(async (tx, memorialId) => {
      const memory = await tx.memory.create({ data: draft(memorialId) });
      await tx.memory.update({ where: { id: memory.id }, data: { status, consentedAt, consentVersion: "share-test" } });
      stored.push(await tx.memory.findUniqueOrThrow({ where: { id: memory.id }, select: { status: true, consentedAt: true, consentVersion: true } }));
    });
    expect(error).toBeNull();
    expect(stored).toEqual([{ status, consentedAt, consentVersion: "share-test" }]);
  });

  it.each(["PENDING", "APPROVED"] as const)("rejects DRAFT to %s without consent (Memory_consent_when_not_draft, SQLSTATE 23514)", async (status) => {
    const error = await attempt(async (tx, memorialId) => {
      const memory = await tx.memory.create({ data: draft(memorialId) });
      await tx.memory.update({ where: { id: memory.id }, data: { status, consentedAt: null, consentVersion: "share-test" } });
    });
    expect(error).not.toBeNull();
    const cause = postgresCause(error);
    expect(cause.code).toBe("23514");
    expect(String(cause.message)).toContain('"Memory_consent_when_not_draft"');
  });

  it.each(["PENDING", "APPROVED"] as const)("A3: sharing to %s keeps the real notifier suppressed after the sender adds READY media", async (status) => {
    const error = await attempt(async (tx, memorialId) => {
      const contributor = await tx.contributor.create({ data: { memorialId, name: "Test sender", email: "sender@example.invalid" } });
      const memory = await tx.memory.create({ data: { ...draft(memorialId), contributorId: contributor.id, contributorNote: "A memory shared with the family." } });
      // get_memory's two versions, as the skill reads them; APPROVED also needs reviewVersion (TCR round 1, B1-3).
      const { memoryVersion, reviewVersion } = (await getMemoryForAdmin(memory.id))!;
      expect(await shareDraftAsAdmin({ memoryId: memory.id, memoryVersion, status, ...(status === "APPROVED" && { reviewVersion }) })).toEqual({ ok: true, status, memoryVersion: expect.any(String) });
      const where = { memoryId: memory.id, emailType: "ADMIN_NEW_MEMORY" } as const;
      const before = await tx.emailLog.findMany({ where });
      expect(before).toEqual([expect.objectContaining({ emailType: "ADMIN_NEW_MEMORY", status: "SKIPPED", errorMessage: "admin_shared" })]);

      const storageKey = `dev/originals/${memory.id}/${crypto.randomUUID()}.jpg`;
      await tx.media.create({ data: { memoryId: memory.id, status: "READY", storageKey, mimeType: "image/jpeg", maxBytes: 1024, sizeBytes: 1024, blobUrl: `https://files.example.invalid/${storageKey}` } });
      // This is the same notifier used by finalizeUpload's notifyAdminsQuietly and cron steps (d)/(e2).
      expect(await notifyAdminsOfMemory({ memoryId: memory.id })).toEqual({ sent: false, skipped: "admin_shared" });
      expect(await tx.emailLog.findMany({ where })).toEqual(before);
    });
    expect(error).toBeNull();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("A3: the real claim filter includes NULL and ordinary skips, FAILED and stale SENDING but excludes terminal skips, SENT and fresh SENDING rows", async () => {
    const expected: string[] = [];
    const selected: string[] = [];
    const error = await attempt(async (tx, memorialId) => {
      const ids: string[] = [];
      const candidates = [
        { status: "SKIPPED", errorMessage: null, claimable: true },
        { status: "SKIPPED", errorMessage: "outbound_disabled", claimable: true },
        { status: "SKIPPED", errorMessage: "admin_shared", claimable: false },
        { status: "PENDING", errorMessage: null, claimable: true },
        { status: "FAILED", errorMessage: null, claimable: true },
        { status: "SENT", errorMessage: null, claimable: false },
        { status: "SENDING", errorMessage: null, claimable: false },
        { status: "SENDING", errorMessage: null, claimable: true, stale: true },
      ] as const;
      // One Memory INSERT for every candidate (integration files now run one at a time; vitest.config.ts).
      const memories = await tx.memory.createManyAndReturn({ data: candidates.map(() => draft(memorialId)), select: { id: true } });
      for (const [index, candidate] of candidates.entries()) {
        // Separate memories preserve the (memoryId, emailType) unique key;
        // every candidate otherwise has the same type and recipient fields.
        const memory = memories[index]!;
        const row = await tx.emailLog.create({ data: { memoryId: memory.id, emailType: "ADMIN_NEW_MEMORY", recipientEmail: "", recipientKey: "", status: candidate.status, errorMessage: candidate.errorMessage } });
        if ("stale" in candidate) {
          await tx.emailLog.update({ where: { id: row.id }, data: { updatedAt: new Date(Date.now() - 16 * 60_000) } });
        }
        ids.push(row.id);
        if (candidate.claimable) { expected.push(row.id); }
      }
      const rows = await tx.emailLog.findMany({ where: { id: { in: ids }, ...claimableWhere(Date.now()) }, select: { id: true } });
      selected.push(...rows.map((row) => row.id));
    });
    expect(error).toBeNull();
    expect(expected).toHaveLength(5);
    expect(selected.sort()).toEqual(expected.sort());
  });

  it("creates exactly one terminal ADMIN_NEW_MEMORY row when suppression is repeated in the same transaction", async () => {
    const stored: unknown[] = [];
    const error = await attempt(async (tx, memorialId) => {
      const memory = await tx.memory.create({ data: draft(memorialId) });
      await lockMemory(tx, memory.id);
      await suppressAdminAlertForDraftShare(tx, memory.id);
      await suppressAdminAlertForDraftShare(tx, memory.id);
      stored.push(...await tx.emailLog.findMany({ where: { memoryId: memory.id }, select: { emailType: true, status: true, errorMessage: true, recipientEmail: true, recipientKey: true } }));
    });
    expect(error).toBeNull();
    expect(stored).toEqual([{ emailType: "ADMIN_NEW_MEMORY", status: "SKIPPED", errorMessage: "admin_shared", recipientEmail: "", recipientKey: "" }]);
  });
});
