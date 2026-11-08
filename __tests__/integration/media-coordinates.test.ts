/**
 * The four CHECK constraints on `Media.latitude`/`longitude`/`gpsCheckedAt` and the
 * `PlaceLookup` cache's "provider had no result" row
 * (prisma/migrations/20261106200000_photo_gps_places; plan 2026-11-06-photo-gps-places B1).
 *
 * Prisma's schema has no CHECK syntax and the feature tests mock `getDb()`, so
 * only a real Postgres shows the constraints exist. Like memory-coordinates,
 * this runs only when TEST_DATABASE_URL names a database at the repo's latest
 * migration (CI provides one) and never reads the app's DATABASE_URL.
 *
 * Every case runs inside a transaction that is always rolled back: nothing is
 * committed, so the budget suite (which truncates Memory and, by cascade, Media)
 * can share the database while vitest runs the files at once.
 *
 * Each refusal case is built so exactly one constraint can fire: a range case
 * starts from a complete, checked pair; a pair case keeps `gpsCheckedAt` set; the
 * checked case uses a valid pair. Each refusal is asserted by SQLSTATE 23514
 * (check_violation, shared by all four) and by the constraint's name.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";

import { Prisma, PrismaClient } from "@/generated/prisma/client";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) {
  // Skipping silently in CI would make the workflow look green with the constraints unproven.
  throw new Error("TEST_DATABASE_URL is not set in CI; the media-coordinates suite must run there");
}
const client = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) : null;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Thrown to end a transaction that succeeded, so its writes are never committed. */
class RolledBack extends Error {}

/** Runs `work` in a transaction that never commits; resolves with what `work` threw, or `null`. */
async function rolledBack(work: (tx: Tx) => Promise<unknown>): Promise<unknown> {
  try {
    await client!.$transaction(async (tx) => {
      await work(tx);
      throw new RolledBack();
    });
  } catch (error) {
    return error instanceof RolledBack ? null : error;
  }
  throw new Error("unreachable: the transaction always throws");
}

/** A fresh memorial and DRAFT memory (no consent stamp, so Memory_consent_when_not_draft holds) to hang media on. */
async function freshMemoryId(tx: Tx): Promise<string> {
  const memorial = await tx.memorial.create({ data: { name: "Media coordinates test", slug: `media-coordinates-${crypto.randomUUID()}` } });
  const memory = await tx.memory.create({
    data: {
      memorialId: memorial.id,
      type: "PHOTO",
      source: "OTHER",
      status: "DRAFT",
      consentVersion: "test",
      consentedAt: null,
      claimTokenHash: crypto.randomUUID().replaceAll("-", "").padEnd(64, "0"),
    },
    select: { id: true },
  });
  return memory.id;
}

type Gps = { latitude: number | null; longitude: number | null; gpsCheckedAt: Date | null };

/** A photo row; only the GPS fields vary between cases. */
function photo(memoryId: string, gps: Gps) {
  return { memoryId, storageKey: `test/media-coordinates/${crypto.randomUUID()}.jpg`, mimeType: "image/jpeg", maxBytes: 1024, ...gps } as const;
}

const CHECKED = new Date("2026-11-06T12:00:00.000Z");
/** The plan's fixture point: the Statue of Liberty at full detail (6 dp), never a family photo. */
const LIBERTY = { latitude: 40.689247, longitude: -74.044502 } as const;
/**
 * The trimmed shape the lookup stores (D5, [C7]): the matched place's own point as the provider's strings, and no
 * house_number, road or postcode. Only the shape is under test, so the point reuses LIBERTY rather than a looked-up value.
 */
const TRIMMED_RESULT = {
  name: "Statue of Liberty",
  category: "tourism",
  type: "attraction",
  addresstype: "tourism",
  lat: "40.689247",
  lon: "-74.044502",
  address: { city: "New York", county: "New York County", state: "New York", country: "United States", country_code: "us" },
};
/** LIBERTY as the lookup's cache key (degrees × 1e6, rounded). */
const LIBERTY_E6 = { latE6: 40_689_247, lonE6: -74_044_502 };

/** The Postgres error under Prisma 7's driver-adapter wrapper (observed: P2039 with `meta.driverAdapterError.cause`). */
function postgresCause(error: unknown): { code?: unknown; message?: unknown } {
  return (error as { meta?: { driverAdapterError?: { cause?: { code?: unknown; message?: unknown } } } }).meta?.driverAdapterError?.cause ?? {};
}

function expectCheckViolation(error: unknown, constraint: string) {
  expect(error, `${constraint}: the write should have been refused`).not.toBeNull();
  const cause = postgresCause(error);
  expect(cause.code, constraint).toBe("23514");
  expect(String(cause.message)).toContain(`"${constraint}"`);
}

describe.skipIf(!client)("Media coordinate constraints and the PlaceLookup cache (real Postgres)", () => {
  afterAll(async () => {
    await client!.$disconnect();
  });

  it.each([
    { name: "latitude above 90 with a valid longitude", gps: { latitude: 91, longitude: 0, gpsCheckedAt: CHECKED }, constraint: "Media_latitude_range" },
    { name: "latitude below -90 with a valid longitude", gps: { latitude: -90.5, longitude: 0, gpsCheckedAt: CHECKED }, constraint: "Media_latitude_range" },
    { name: "longitude above 180 with a valid latitude", gps: { latitude: 0, longitude: 181, gpsCheckedAt: CHECKED }, constraint: "Media_longitude_range" },
    { name: "longitude below -180 with a valid latitude", gps: { latitude: 0, longitude: -180.5, gpsCheckedAt: CHECKED }, constraint: "Media_longitude_range" },
    { name: "latitude without longitude", gps: { latitude: LIBERTY.latitude, longitude: null, gpsCheckedAt: CHECKED }, constraint: "Media_coordinates_pair" },
    { name: "longitude without latitude", gps: { latitude: null, longitude: LIBERTY.longitude, gpsCheckedAt: CHECKED }, constraint: "Media_coordinates_pair" },
    { name: "coordinates without gpsCheckedAt", gps: { ...LIBERTY, gpsCheckedAt: null }, constraint: "Media_coordinates_checked" },
  ])("refuses $name on insert ($constraint, SQLSTATE 23514)", async ({ gps, constraint }) => {
    const error = await rolledBack(async (tx) => tx.media.create({ data: photo(await freshMemoryId(tx), gps) }));
    expectCheckViolation(error, constraint);
  });

  it.each([true, false])("refuses gpsScanComplete=%s without gpsCheckedAt (Media_gps_scan_decided, TCR round 1 B1-1)", async (gpsScanComplete) => {
    const error = await rolledBack(async (tx) => tx.media.create({ data: { ...photo(await freshMemoryId(tx), { latitude: null, longitude: null, gpsCheckedAt: null }), mimeType: "video/quicktime", gpsScanComplete } }));
    expectCheckViolation(error, "Media_gps_scan_decided");
  });

  it("accepts gpsScanComplete on a decided row and keeps it when the stamp stays", async () => {
    const stored: unknown[] = [];
    const error = await rolledBack(async (tx) => {
      const memoryId = await freshMemoryId(tx);
      for (const gpsScanComplete of [true, false, null]) {
        const row = await tx.media.create({ data: { ...photo(memoryId, { latitude: null, longitude: null, gpsCheckedAt: CHECKED }), mimeType: "video/quicktime", gpsScanComplete }, select: { gpsScanComplete: true } });
        stored.push(row.gpsScanComplete);
      }
    });
    expect(error).toBeNull();
    expect(stored).toEqual([true, false, null]);
  });

  it("refuses an update that breaks the pair, a range or the checked stamp on an existing row", async () => {
    for (const [data, constraint] of [
      [{ longitude: null }, "Media_coordinates_pair"],
      [{ latitude: 90.0001 }, "Media_latitude_range"],
      [{ longitude: -181 }, "Media_longitude_range"],
      [{ gpsCheckedAt: null }, "Media_coordinates_checked"],
    ] as const) {
      const error = await rolledBack(async (tx) => {
        const row = await tx.media.create({ data: photo(await freshMemoryId(tx), { ...LIBERTY, gpsCheckedAt: CHECKED }) });
        await tx.media.update({ where: { id: row.id }, data });
      });
      expectCheckViolation(error, constraint);
    }
  });

  it("accepts found, absent and undecided rows, the extremes of both ranges, and stores them unchanged at full detail", async () => {
    const select = { latitude: true, longitude: true, gpsCheckedAt: true, gpsAttempts: true } as const;
    const stored: unknown[] = [];
    const error = await rolledBack(async (tx) => {
      const memoryId = await freshMemoryId(tx);
      for (const gps of [
        { ...LIBERTY, gpsCheckedAt: CHECKED }, // found
        { latitude: 90, longitude: 180, gpsCheckedAt: CHECKED },
        { latitude: -90, longitude: -180, gpsCheckedAt: CHECKED },
        { latitude: null, longitude: null, gpsCheckedAt: CHECKED }, // absent: decided, nothing found
        { latitude: null, longitude: null, gpsCheckedAt: null }, // not yet decided
      ]) {
        stored.push(await tx.media.create({ data: photo(memoryId, gps), select }));
      }
      // The extraction step's order: claim an attempt, then write the pair and the stamp in one update.
      const pending = await tx.media.create({ data: { memoryId, storageKey: `test/media-coordinates/${crypto.randomUUID()}.heic`, mimeType: "image/heic", maxBytes: 1024 } });
      await tx.media.update({ where: { id: pending.id }, data: { gpsAttempts: { increment: 1 } } });
      stored.push(await tx.media.update({ where: { id: pending.id }, data: { ...LIBERTY, gpsCheckedAt: CHECKED }, select }));
    });
    expect(error).toBeNull();
    expect(stored).toEqual([
      { ...LIBERTY, gpsCheckedAt: CHECKED, gpsAttempts: 0 },
      { latitude: 90, longitude: 180, gpsCheckedAt: CHECKED, gpsAttempts: 0 },
      { latitude: -90, longitude: -180, gpsCheckedAt: CHECKED, gpsAttempts: 0 },
      { latitude: null, longitude: null, gpsCheckedAt: CHECKED, gpsAttempts: 0 },
      { latitude: null, longitude: null, gpsCheckedAt: null, gpsAttempts: 0 },
      { ...LIBERTY, gpsCheckedAt: CHECKED, gpsAttempts: 1 },
    ]);
  });


  it("round-trips a PlaceLookup row: Prisma.DbNull is stored as SQL NULL (a cached 'no result'), a trimmed result as JSON", async () => {
    const provider = `test-${crypto.randomUUID()}`;
    const empty = { provider, ...LIBERTY_E6 };
    const named = { provider, latE6: LIBERTY_E6.latE6 + 1, lonE6: LIBERTY_E6.lonE6 };
    const reads: { empty?: { result: unknown; fetchedAt: Date } | null; sql?: Array<{ isSqlNull: boolean }>; miss?: unknown; named?: { result: unknown } | null } = {};
    const error = await rolledBack(async (tx) => {
      await tx.placeLookup.create({ data: { ...empty, result: Prisma.DbNull } });
      await tx.placeLookup.create({ data: { ...named, result: TRIMMED_RESULT } });
      reads.empty = await tx.placeLookup.findUnique({ where: { provider_latE6_lonE6: empty }, select: { result: true, fetchedAt: true } });
      // DbNull (SQL NULL) and JsonNull (JSON 'null') both read back as null through Prisma; only SQL tells them apart.
      reads.sql = await tx.$queryRaw`SELECT "result" IS NULL AS "isSqlNull" FROM "PlaceLookup" WHERE "provider" = ${provider} AND "latE6" = ${empty.latE6} AND "lonE6" = ${empty.lonE6}`;
      reads.miss = await tx.placeLookup.findUnique({ where: { provider_latE6_lonE6: { ...empty, lonE6: empty.lonE6 + 1 } } });
      reads.named = await tx.placeLookup.findUnique({ where: { provider_latE6_lonE6: named }, select: { result: true } });
    });
    expect(error).toBeNull();
    // A row whose result is null is a cached "provider had no result"; no row at all is a cache miss.
    expect(reads.empty?.result).toBeNull();
    expect(reads.empty?.fetchedAt).toBeInstanceOf(Date);
    expect(reads.sql).toEqual([{ isSqlNull: true }]);
    expect(reads.miss).toBeNull();
    expect(reads.named).toEqual({ result: TRIMMED_RESULT });
  });

  it("keys PlaceLookup by (provider, latE6, lonE6): a second row for the same point is refused (P2002), another provider is not", async () => {
    const provider = `test-${crypto.randomUUID()}`;
    const duplicate = await rolledBack(async (tx) => {
      await tx.placeLookup.create({ data: { provider, ...LIBERTY_E6, result: Prisma.DbNull } });
      await tx.placeLookup.create({ data: { provider, ...LIBERTY_E6, result: TRIMMED_RESULT } });
    });
    expect((duplicate as { code?: unknown } | null)?.code).toBe("P2002");
    const otherProvider = await rolledBack(async (tx) => {
      await tx.placeLookup.create({ data: { provider, ...LIBERTY_E6, result: Prisma.DbNull } });
      await tx.placeLookup.create({ data: { provider: `${provider}-other`, ...LIBERTY_E6, result: TRIMMED_RESULT } });
    });
    expect(otherProvider).toBeNull();
  });
});
