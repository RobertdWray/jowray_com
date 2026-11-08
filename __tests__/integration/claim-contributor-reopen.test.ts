/**
 * D17 for the shared Contributor row on real Postgres (TCR round 1, B1-2): a name change through one claim link sends
 * every other APPROVED memory of that send back to PENDING, under `lockContributorMemories`'s single id-ordered
 * `FOR UPDATE`. The feature tests mock the database; only Postgres shows the lock statement is valid SQL and that the
 * writes and revisions land together.
 *
 * Runs only when TEST_DATABASE_URL names a database at the repo's latest migration (CI provides one); never reads the
 * app's DATABASE_URL. Every write runs inside a transaction that is always rolled back; the feature's own transaction
 * nests as a savepoint (Prisma 7.10).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it, vi } from "vitest";

import { updateMemoryFromClaim } from "@/features/memories/claim";
import { PrismaClient } from "@/generated/prisma/client";
import { hashClaimToken } from "@/lib/claim-token";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) {
  throw new Error("TEST_DATABASE_URL is not set in CI; the claim-contributor-reopen suite must run there");
}
const client = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) : null;
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
let current: Tx | null = null;
vi.mock("@/server/db/client", () => ({ getDb: () => current }));

afterAll(async () => {
  await client?.$disconnect();
});

class RolledBack extends Error {}

async function inRolledBackTx<T>(body: (tx: Tx, memorialId: string) => Promise<T>): Promise<T> {
  let result: T | undefined;
  try {
    await client!.$transaction(async (tx) => {
      current = tx;
      try {
        const memorial = await tx.memorial.create({ data: { name: "Claim reopen test", slug: `claim-reopen-${crypto.randomUUID()}` } });
        result = await body(tx, memorial.id);
      } finally {
        current = null;
      }
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) {
      throw error;
    }
  }
  return result as T;
}

const TOKEN = "c".repeat(43);

describe.skipIf(!client)("a claim-link name change reopens the send's other APPROVED memories (real Postgres, B1-2)", () => {
  it("locks, reopens and records a revision for each sibling in one transaction", async () => {
    const outcome = await inRolledBackTx(async (tx, memorialId) => {
      const contributor = await tx.contributor.create({ data: { memorialId, name: "Jo", relationship: "friend" } });
      const memory = (status: "PENDING" | "APPROVED", claimTokenHash: string, deletedAt: Date | null = null) =>
        tx.memory.create({
          data: { memorialId, contributorId: contributor.id, type: "TEXT", source: "WEB_UPLOAD", status, consentVersion: "reopen-test", consentedAt: new Date("2026-11-07T12:00:00Z"), contributorNote: "words", claimTokenHash, deletedAt },
          select: { id: true },
        });
      const edited = await memory("PENDING", hashClaimToken(TOKEN));
      const approved = await memory("APPROVED", crypto.randomUUID().replaceAll("-", "").padEnd(64, "0"));
      const deleted = await memory("APPROVED", crypto.randomUUID().replaceAll("-", "").padEnd(64, "0"), new Date("2026-11-07T13:00:00Z"));

      const result = await updateMemoryFromClaim({ claimToken: TOKEN, changes: { name: "Jo Friend" } });
      const rows = await tx.memory.findMany({ where: { id: { in: [edited.id, approved.id, deleted.id] } }, select: { id: true, status: true } });
      const revisions = await tx.memoryRevision.findMany({ where: { memoryId: approved.id }, select: { changedVia: true, before: true, after: true } });
      const name = (await tx.contributor.findUniqueOrThrow({ where: { id: contributor.id }, select: { name: true } })).name;
      return { result, status: Object.fromEntries(rows.map((row) => [row.id, row.status])), revisions, name, ids: { edited: edited.id, approved: approved.id, deleted: deleted.id } };
    });
    expect(outcome.result).toEqual({ ok: true, shared: false, reopened: false, reopenedOthers: 1 });
    expect(outcome.name).toBe("Jo Friend");
    expect(outcome.status).toEqual({ [outcome.ids.edited]: "PENDING", [outcome.ids.approved]: "PENDING", [outcome.ids.deleted]: "APPROVED" });
    // The sibling's first revision also records the consent version in force (appendRevision).
    expect(outcome.revisions).toEqual([{ changedVia: "CLAIM_LINK", before: { status: "APPROVED", name: "Jo" }, after: { status: "PENDING", name: "Jo Friend", consentVersion: "reopen-test" } }]);
  });
});
