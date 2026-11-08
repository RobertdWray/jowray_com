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
import { afterAll, describe, expect, it, vi } from "vitest";

import { getPublicMemory, listPublicMemories, PUBLIC_MEMORY_WHERE } from "@/features/memories/public";
import { PrismaClient } from "@/generated/prisma/client";
import { MemoryStatus, Visibility } from "@/generated/prisma/enums";
import { isPublicMemory } from "@/lib/memories/public-rule";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) {
  throw new Error("TEST_DATABASE_URL is not set in CI; the public-memories suite must run there");
}
const client = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) : null;

/** The feature reads through `getDb()`; point it at the rolled-back transaction of the test that is running. */
let current: unknown = null;
vi.mock("@/server/db/client", () => ({ getDb: () => current }));

afterAll(async () => {
  await client?.$disconnect();
});

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

describe.skipIf(!client)("listPublicMemories and getPublicMemory (real Postgres, plan L8)", () => {
  it("returns only APPROVED + PUBLIC + live memories, with their tags and a rounded point", async () => {
    const ids = await inRolledBackTx(async (tx, memorialId) => {
      current = tx;
      const consented = { status: "APPROVED", consentedAt: new Date(), consentVersion: "test" } as const;
      const shown = await tx.memory.create({ data: { ...draft(memorialId), ...consented, visibility: "PUBLIC", tags: ["quilting", "Café"], place: "Towson, MD", latitude: 39.48153, longitude: -76.64471, approxDateText: "Summer 1985", contributorNote: "Jo and the calico" } });
      const family = await tx.memory.create({ data: { ...draft(memorialId), ...consented, visibility: "FAMILY" } });
      const pending = await tx.memory.create({ data: { ...draft(memorialId), status: "PENDING", consentedAt: new Date(), consentVersion: "test", visibility: "PUBLIC" } });
      const deleted = await tx.memory.create({ data: { ...draft(memorialId), ...consented, visibility: "PUBLIC", deletedAt: new Date() } });
      const listed = (await listPublicMemories()).map((memory) => memory.id);
      const one = await getPublicMemory(shown.id);
      const hidden = await Promise.all([family.id, pending.id, deleted.id].map((id) => getPublicMemory(id)));
      current = null;
      return { shown: shown.id, others: [family.id, pending.id, deleted.id], listed, one, hidden };
    });
    expect(ids.listed).toContain(ids.shown);
    for (const other of ids.others) {
      expect(ids.listed).not.toContain(other);
    }
    expect(ids.one).toMatchObject({ id: ids.shown, tags: [{ name: "quilting", slug: "quilting" }, { name: "Café", slug: "cafe" }], point: { lat: 39.5, lon: -76.65 }, year: 1985, place: { label: "Towson, MD", slug: "towson-md" }, note: "Jo and the calico", media: [] });
    expect(ids.hidden).toEqual([null, null, null]);
  });
});

describe.skipIf(!client)("PUBLIC_MEMORY_WHERE and isPublicMemory agree on real Postgres (D1, TCR round 1 B2-2)", () => {
  it("select exactly the same rows out of every status × visibility × deleted combination", async () => {
    const { rows, matched } = await inRolledBackTx(async (tx, memorialId) => {
      const created: Array<{ id: string; status: string; visibility: string; deletedAt: Date | null }> = [];
      for (const status of Object.values(MemoryStatus)) {
        for (const visibility of Object.values(Visibility)) {
          for (const deletedAt of [null, new Date("2026-11-08T12:00:00Z")]) {
            // Only a DRAFT may lack the consent stamp (Memory_consent_when_not_draft).
            const consentedAt = status === "DRAFT" ? null : new Date("2026-11-07T12:00:00Z");
            created.push(await tx.memory.create({ data: { ...draft(memorialId), status, visibility, deletedAt, consentedAt }, select: { id: true, status: true, visibility: true, deletedAt: true } }));
          }
        }
      }
      const found = await tx.memory.findMany({ where: { memorialId, ...PUBLIC_MEMORY_WHERE }, select: { id: true } });
      return { rows: created, matched: found.map((row) => row.id).sort() };
    });
    expect(rows).toHaveLength(Object.values(MemoryStatus).length * Object.values(Visibility).length * 2);
    expect(matched).toEqual(rows.filter(isPublicMemory).map((row) => row.id).sort());
    expect(matched).toHaveLength(1);
  });
});
