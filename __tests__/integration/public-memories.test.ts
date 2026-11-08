/**
 * See memories on a real Postgres (plan docs/plans/2026-11-08-see-memories.md, L4 and L8).
 *
 * The `tags` column (prisma/migrations/20261108005301_memory_tags) is a
 * PostgreSQL text array that is NOT NULL with an empty-array default; the
 * feature tests mock `getDb()`, so only a real database shows the column's
 * exact shape and that a list round-trips in order.
 *
 * Runs only when TEST_DATABASE_URL names a database at the repo's latest
 * migration (CI provides one); never reads the app's DATABASE_URL. Every write
 * runs inside a transaction that is always rolled back, so the budget suite
 * (which counts today's memories and truncates the table) can share the
 * database while vitest runs the files at once.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) {
  throw new Error("TEST_DATABASE_URL is not set in CI; the public-memories suite must run there");
}
const client = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) : null;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Thrown to end a transaction that succeeded, so its writes are never committed. */
class RolledBack extends Error {}

/** Runs `body` against a fresh memorial in a transaction that never commits, and returns what `body` returned. */
async function inRolledBackTx<T>(body: (tx: Tx, memorialId: string) => Promise<T>): Promise<T> {
  let result: T | undefined;
  try {
    await client!.$transaction(async (tx) => {
      const memorial = await tx.memorial.create({ data: { name: "Public memories test", slug: `public-memories-${crypto.randomUUID()}` } });
      result = await body(tx, memorial.id);
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) {
      throw error;
    }
  }
  return result as T;
}

/** A DRAFT with no consent stamp satisfies Memory_consent_when_not_draft. */
function draft(memorialId: string, extra: Record<string, unknown> = {}) {
  return { memorialId, type: "TEXT", source: "OTHER", status: "DRAFT", consentVersion: "test", consentedAt: null, claimTokenHash: crypto.randomUUID().replaceAll("-", "").padEnd(64, "0"), ...extra } as const;
}

describe.skipIf(!client)("Memory.tags column (real Postgres)", () => {
  afterAll(async () => {
    await client!.$disconnect();
  });

  it("is a NOT NULL text array defaulting to an empty array", async () => {
    const rows = await client!.$queryRaw<Array<{ data_type: string; udt_name: string; is_nullable: string; column_default: string | null }>>`
      SELECT data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'Memory' AND column_name = 'tags'`;
    expect(rows).toEqual([{ data_type: "ARRAY", udt_name: "_text", is_nullable: "NO", column_default: "ARRAY[]::text[]" }]);
  });

  it("gives a new memory an empty list and round-trips a list in order, accents and all", async () => {
    const [fresh, written] = await inRolledBackTx(async (tx, memorialId) => {
      const created = await tx.memory.create({ data: draft(memorialId) });
      await tx.memory.update({ where: { id: created.id }, data: { tags: ["quilting", "Café", "St. Mary's"] } });
      return [created, await tx.memory.findUniqueOrThrow({ where: { id: created.id }, select: { tags: true } })] as const;
    });
    expect(fresh.tags).toEqual([]);
    expect(written.tags).toEqual(["quilting", "Café", "St. Mary's"]);
  });

  it("refuses a null list at the database", async () => {
    const error = await inRolledBackTx(async (tx, memorialId) => {
      const created = await tx.memory.create({ data: draft(memorialId) });
      try {
        await tx.$executeRaw`UPDATE "Memory" SET "tags" = NULL WHERE "id" = ${created.id}`;
        return null;
      } catch (caught) {
        return caught;
      }
    }).catch((caught: unknown) => caught);
    expect(error).not.toBeNull();
    expect(String((error as { message?: unknown }).message ?? error)).toMatch(/null value|23502|not-null/i);
  });
});
