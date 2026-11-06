/**
 * The three CHECK constraints on `Memory.latitude`/`longitude`
 * (prisma/migrations/20261106120000_memory_coordinates; plan 2026-11-06 §4.2).
 *
 * Prisma's schema has no CHECK syntax and the feature tests mock `getDb()`, so
 * only a real Postgres shows the constraints exist. Like budget-concurrency,
 * this runs only when TEST_DATABASE_URL names a database at the repo's latest
 * migration (CI provides one) and never reads the app's DATABASE_URL.
 *
 * Every case runs inside a transaction that is always rolled back: nothing is
 * committed, so the budget suite (which counts today's memories and truncates
 * the table) can share the database while vitest runs both files at once.
 *
 * A range case starts from a complete pair, so the range check is the only
 * constraint that can fire: with a null partner the pair check would fire
 * first and hide a missing range check. Each refusal is asserted by SQLSTATE
 * 23514 (check_violation, shared by all three) and by the constraint's name.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) {
  // Skipping silently in CI would make the workflow look green with the constraints unproven.
  throw new Error("TEST_DATABASE_URL is not set in CI; the memory-coordinates suite must run there");
}
const client = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) : null;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Thrown to end a transaction that succeeded, so its writes are never committed. */
class RolledBack extends Error {}

/** Runs `write` against a fresh memorial in a transaction that never commits; resolves with what `write` threw, or `null`. */
async function attempt(write: (tx: Tx, memorialId: string) => Promise<unknown>): Promise<unknown> {
  try {
    await client!.$transaction(async (tx) => {
      const memorial = await tx.memorial.create({ data: { name: "Coordinates test", slug: `memory-coordinates-${crypto.randomUUID()}` } });
      await write(tx, memorial.id);
      throw new RolledBack();
    });
  } catch (error) {
    return error instanceof RolledBack ? null : error;
  }
  throw new Error("unreachable: the transaction always throws");
}

/** A DRAFT with no consent stamp satisfies Memory_consent_when_not_draft, so only the coordinate checks are in play. */
function draft(memorialId: string, pair: { latitude: number | null; longitude: number | null }) {
  return { memorialId, type: "TEXT", source: "OTHER", status: "DRAFT", consentVersion: "test", consentedAt: null, claimTokenHash: crypto.randomUUID().replaceAll("-", "").padEnd(64, "0"), ...pair } as const;
}

/** The Postgres error under Prisma 7's driver-adapter wrapper (observed: P2039 with `meta.driverAdapterError.cause`). */
function postgresCause(error: unknown): { code?: unknown; message?: unknown } {
  return (error as { meta?: { driverAdapterError?: { cause?: { code?: unknown; message?: unknown } } } }).meta?.driverAdapterError?.cause ?? {};
}

describe.skipIf(!client)("Memory coordinate constraints (real Postgres)", () => {
  afterAll(async () => {
    await client!.$disconnect();
  });

  it.each([
    { name: "latitude above 90 with a valid longitude", pair: { latitude: 91, longitude: 0 }, constraint: "Memory_latitude_range" },
    { name: "latitude below -90 with a valid longitude", pair: { latitude: -90.5, longitude: 0 }, constraint: "Memory_latitude_range" },
    { name: "longitude above 180 with a valid latitude", pair: { latitude: 0, longitude: 181 }, constraint: "Memory_longitude_range" },
    { name: "longitude below -180 with a valid latitude", pair: { latitude: 0, longitude: -180.5 }, constraint: "Memory_longitude_range" },
    { name: "latitude without longitude", pair: { latitude: 39.4815, longitude: null }, constraint: "Memory_coordinates_pair" },
    { name: "longitude without latitude", pair: { latitude: null, longitude: -76.6447 }, constraint: "Memory_coordinates_pair" },
  ])("refuses $name on insert ($constraint, SQLSTATE 23514)", async ({ pair, constraint }) => {
    const error = await attempt((tx, memorialId) => tx.memory.create({ data: draft(memorialId, pair) }));
    expect(error, "the insert should have been refused").not.toBeNull();
    const cause = postgresCause(error);
    expect(cause.code).toBe("23514");
    expect(String(cause.message)).toContain(`"${constraint}"`);
  });

  it("refuses an update that breaks the pair or a range on an existing row", async () => {
    for (const [data, constraint] of [
      [{ longitude: null }, "Memory_coordinates_pair"],
      [{ latitude: 90.0001 }, "Memory_latitude_range"],
      [{ longitude: -181 }, "Memory_longitude_range"],
    ] as const) {
      const error = await attempt(async (tx, memorialId) => {
        const row = await tx.memory.create({ data: draft(memorialId, { latitude: 39.4815, longitude: -76.6447 }) });
        await tx.memory.update({ where: { id: row.id }, data });
      });
      const cause = postgresCause(error);
      expect(cause.code, constraint).toBe("23514");
      expect(String(cause.message)).toContain(`"${constraint}"`);
    }
  });

  it("accepts a valid pair, the extremes of both ranges and no coordinates at all, and stores them unchanged", async () => {
    const stored: Array<{ latitude: number | null; longitude: number | null }> = [];
    const error = await attempt(async (tx, memorialId) => {
      for (const pair of [{ latitude: 39.4815, longitude: -76.6447 }, { latitude: 90, longitude: 180 }, { latitude: -90, longitude: -180 }, { latitude: null, longitude: null }]) {
        const row = await tx.memory.create({ data: draft(memorialId, pair), select: { latitude: true, longitude: true } });
        stored.push(row);
      }
      // Clearing both at once is allowed too.
      const set = await tx.memory.create({ data: draft(memorialId, { latitude: 1, longitude: 2 }) });
      stored.push(await tx.memory.update({ where: { id: set.id }, data: { latitude: null, longitude: null }, select: { latitude: true, longitude: true } }));
    });
    expect(error).toBeNull();
    expect(stored).toEqual([
      { latitude: 39.4815, longitude: -76.6447 },
      { latitude: 90, longitude: 180 },
      { latitude: -90, longitude: -180 },
      { latitude: null, longitude: null },
      { latitude: null, longitude: null },
    ]);
  });
});
