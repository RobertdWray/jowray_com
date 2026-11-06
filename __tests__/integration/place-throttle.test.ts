/**
 * The site-wide lease and fence on real Postgres 18 (plan 2026-11-06-photo-gps-places B4, D8): two concurrent lookups
 * of two new points, against a fake provider that records when each request leaves, must send at least 1.1 s apart.
 * The claim and the fence run as the real SQL with the database's own clock (`now()`), never the app's.
 *
 * Unlike the other integration suites this one commits: the spacing only exists across separate statements and
 * connections. Every row is keyed by a provider named `test-<uuid>` (throttle and cache), and `afterAll` deletes them
 * along with the counter rows this run added under `places:provider`. Runs only when TEST_DATABASE_URL is set.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { utcDay } from "@/features/media/egress";
import type { PlaceResult } from "@/lib/places/types";
import type { Coordinates } from "@/lib/validations/memory";
import type { ReverseGeocoder } from "@/services/places/types";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), flush: async () => true }));

import { createPlaceLookup, type PlaceLookupDeps } from "@/features/places/lookup-place";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) {
  // Skipping silently in CI would make the workflow look green with the spacing unproven.
  throw new Error("TEST_DATABASE_URL is not set in CI; the place-throttle suite must run there");
}
const client = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) : null;
/** A second connection pool, so the two callers never share a connection. */
const other = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) : null;

const provider = `test-${crypto.randomUUID()}`;
const ENV = { PLACES_DAILY_PROVIDER_CALLS: 1_000_000, PLACES_VIEWER_DAILY_REQUESTS: 1_000_000 };
const RESULT: PlaceResult = { name: "Statue of Liberty", category: "tourism", type: "attraction", addresstype: "tourism", lat: "40.689247", lon: "-74.044502", address: { city: "New York", state: "New York", country_code: "us" } };

describe.skipIf(!client)("the place lookup throttle on real Postgres", () => {
  /** Today's provider counter before this run: null when there was no row, which afterAll then removes. */
  let counterBefore: bigint | null = null;

  afterAll(async () => {
    await client!.placeLookupThrottle.deleteMany({ where: { provider } });
    await client!.placeLookup.deleteMany({ where: { provider } });
    // Put today's provider counter back as it was (only tests write it in this database).
    if (counterBefore === null) {
      await client!.$executeRaw`DELETE FROM "EgressCounter" WHERE "scope" = 'places:provider' AND "day" = ${utcDay()}::date`;
    } else {
      await client!.$executeRaw`UPDATE "EgressCounter" SET "bytes" = ${counterBefore} WHERE "scope" = 'places:provider' AND "day" = ${utcDay()}::date`;
    }
    await client!.$disconnect();
    await other!.$disconnect();
  });

  it("two concurrent lookups of two new points send at least 1100 ms apart, both answered and cached", async () => {
    const before = await client!.$queryRaw<Array<{ bytes: bigint }>>`SELECT "bytes" FROM "EgressCounter" WHERE "scope" = 'places:provider' AND "day" = ${utcDay()}::date`;
    counterBefore = before[0]?.bytes ?? null;
    const sends: number[] = [];
    const geocoder: ReverseGeocoder = {
      provider,
      remote: true,
      reverse: async (_point: Coordinates) => {
        sends.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 50)); // the provider's own latency
        return RESULT;
      },
    };
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const deps = (db: PrismaClient): PlaceLookupDeps => ({ db, geocoder, env: ENV, sleep });
    const deadline = Date.now() + 15_000;
    const [a, b] = await Promise.all([
      createPlaceLookup(deps(client!))({ latitude: 40.689247, longitude: -74.044502 }, { deadline }),
      createPlaceLookup(deps(other!))({ latitude: 40.689248, longitude: -74.044502 }, { deadline }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(sends).toHaveLength(2);
    expect(Math.abs(sends[1]! - sends[0]!)).toBeGreaterThanOrEqual(1_100);

    const throttle = await client!.placeLookupThrottle.findUniqueOrThrow({ where: { provider } });
    expect(throttle.leaseToken).toBeNull(); // the second send fenced and cleared its lease
    expect(await client!.placeLookup.count({ where: { provider } })).toBe(2);
  });
});
