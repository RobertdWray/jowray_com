/**
 * A1/A3: real Postgres proves the consent CHECK, the suppression row's unique
 * key and the claim filter's NULL semantics. Every write rolls back. TEST_DATABASE_URL is
 * CI's migrated database; the app's DATABASE_URL is never read by this suite.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";

import { lockMemory } from "@/features/memories/lock";
import { PrismaClient } from "@/generated/prisma/client";
import { claimableWhere, suppressAdminAlertForDraftShare } from "@/services/email";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) {
  throw new Error("TEST_DATABASE_URL is not set in CI; the share-draft suite must run there");
}
const client = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) : null;
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
class RolledBack extends Error {}

async function attempt(write: (tx: Tx, memorialId: string) => Promise<unknown>): Promise<unknown> {
  try {
    await client!.$transaction(async (tx) => {
      const memorial = await tx.memorial.create({ data: { name: "Share draft test", slug: `share-draft-${crypto.randomUUID()}` } });
      await write(tx, memorial.id);
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

  it("A3: the real claim filter includes NULL and ordinary skips but excludes terminal skips, SENT and fresh SENDING rows", async () => {
    const expected: string[] = [];
    const selected: string[] = [];
    const error = await attempt(async (tx, memorialId) => {
      const ids: string[] = [];
      for (const candidate of [
        { status: "SKIPPED", errorMessage: null, claimable: true },
        { status: "SKIPPED", errorMessage: "outbound_disabled", claimable: true },
        { status: "SKIPPED", errorMessage: "admin_shared", claimable: false },
        { status: "PENDING", errorMessage: null, claimable: true },
        { status: "SENT", errorMessage: null, claimable: false },
        { status: "SENDING", errorMessage: null, claimable: false },
      ] as const) {
        // Separate memories preserve the (memoryId, emailType) unique key;
        // every candidate otherwise has the same type and recipient fields.
        const memory = await tx.memory.create({ data: draft(memorialId) });
        const row = await tx.emailLog.create({ data: { memoryId: memory.id, emailType: "ADMIN_NEW_MEMORY", recipientEmail: "", recipientKey: "", status: candidate.status, errorMessage: candidate.errorMessage } });
        ids.push(row.id);
        if (candidate.claimable) { expected.push(row.id); }
      }
      const rows = await tx.emailLog.findMany({ where: { id: { in: ids }, ...claimableWhere(Date.now()) }, select: { id: true } });
      selected.push(...rows.map((row) => row.id));
    });
    expect(error).toBeNull();
    expect(expected).toHaveLength(3);
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
