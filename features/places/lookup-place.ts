import "server-only";

import { createHash, randomUUID } from "node:crypto";

import * as Sentry from "@sentry/nextjs";

import { countRequest, utcDay } from "@/features/media/egress";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { createLogger } from "@/lib/logger";
import { isPlaceProviderRefusedError } from "@/lib/places/errors";
import { placeLabels } from "@/lib/places/label";
import { PLACE_SEND_BUDGET_MS } from "@/lib/places/timing";
import { type PlaceLabel, type PlaceResult, placeResultSchema } from "@/lib/places/types";
import type { Coordinates } from "@/lib/validations/memory";
import { type PlacesEnv, getPlacesEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { getReverseGeocoder, type ReverseGeocoder } from "@/services/places";

const log = createLogger({ category: "api" });

/** Shown wherever these results are shown, as the OSMF attribution guidelines ask [C8]. */
export const PLACES_ATTRIBUTION = "© OpenStreetMap contributors";
/** The longest single wait between claim attempts (D8). */
const MAX_PAUSE_MS = 500;
/** The shortest: a row that looked free a moment ago is retried soon, never in a tight loop. */
const MIN_PAUSE_MS = 10;

export type PlaceLookupCode = "rate_limited" | "daily_limit" | "busy" | "disabled" | "provider_refused" | "failed";
export type PlaceLookupResult = { ok: true; labels: PlaceLabel[]; attribution: string } | { ok: false; code: PlaceLookupCode };

export interface PlaceLookupDeps {
  db: Pick<PrismaClient, "$queryRaw" | "$executeRaw" | "placeLookup">;
  /** null when PLACES_PROVIDER is `off`. */
  geocoder: ReverseGeocoder | null;
  env: Pick<PlacesEnv, "PLACES_DAILY_PROVIDER_CALLS" | "PLACES_VIEWER_DAILY_REQUESTS">;
  sleep: (ms: number) => Promise<void>;
}

export interface PlaceLookupOptions {
  /** Who is asking (`viewerKeyFrom(request.headers)`); counted per UTC day. The MCP path has none. */
  viewerKey?: string;
  /** Epoch ms after which no new claim attempt starts; then the answer is `busy`. */
  deadline: number;
}

/**
 * Place labels for a point (plan 2026-11-06-photo-gps-places B4). Never throws.
 *
 * 1. The cache key is the point in degrees × 1e6.
 * 2. With a viewer key, count the request first (D9); over the day's limit is `rate_limited`, and nothing else is spent.
 * 3. `off` is `disabled`; `stub` answers its labels at once (never throttled, counted or cached).
 * 4. A cache hit answers from the cache.
 * 5. Otherwise claim the site-wide lease in one statement [C23], retrying in steps of at most 500 ms until the deadline
 *    (then `busy`, having spent nothing more).
 * 6. Re-read the cache: another caller may have just looked this point up. A hit releases the lease (no send happened,
 *    so the fence is not moved) and answers.
 * 7. Count the provider call (D9); over the day's limit releases the lease and is `daily_limit`.
 * 8. Send at once, then fence: next-allowed = the database's `now()` + 1.1 s, lease cleared. The send started before
 *    that `now()`, and the next claim needs `now()` at or past it, so real sends are at least 1.1 s apart site-wide; no
 *    transaction is held across the HTTP call [C22], and a dead holder blocks others for at most its 10 s lease. A send
 *    may start only within PLACE_SEND_BUDGET_MS (3 s) of issuing the winning claim, so its fence always lands while the
 *    lease is still held; a holder stalled past that releases the lease and answers `busy` (B4 fix round 1).
 * 9. Cache the answer (`Prisma.DbNull` when the provider had none) and return its labels with the OSM credit. A refusal
 *    is a Sentry warning and `provider_refused`; any other failure is reported and `failed` (retryable).
 */
export async function lookupPlace(point: Coordinates, options: PlaceLookupOptions): Promise<PlaceLookupResult> {
  let deps: PlaceLookupDeps;
  try {
    deps = { db: getDb(), geocoder: getReverseGeocoder(), env: getPlacesEnv(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
  } catch (error) {
    return failed(error);
  }
  return createPlaceLookup(deps)(point, options);
}

/** `lookupPlace` over the given database, geocoder, ceilings and sleep (the tests and the throttle proof use it directly). */
export function createPlaceLookup({ db, geocoder, env, sleep }: PlaceLookupDeps): (point: Coordinates, options: PlaceLookupOptions) => Promise<PlaceLookupResult> {
  return async (point, { viewerKey, deadline }) => {
    try {
      const day = utcDay();
      if (viewerKey !== undefined) {
        const nth = await countRequest(db, { scope: viewerScope(viewerKey), day, limit: env.PLACES_VIEWER_DAILY_REQUESTS });
        if (nth === null) {
          return { ok: false, code: "rate_limited" };
        }
      }
      if (geocoder === null) {
        return { ok: false, code: "disabled" };
      }
      if (!geocoder.remote) {
        return answered(await geocoder.reverse(point));
      }

      const key = { provider: geocoder.provider, latE6: Math.round(point.latitude * 1e6), lonE6: Math.round(point.longitude * 1e6) };
      const cached = await readCache(db, key);
      if (cached.hit) {
        log.debug({ action: "place_lookup", outcome: "cache_hit" }, "place lookup answered from the cache");
        return answered(cached.result);
      }

      const token = randomUUID();
      const claimIssuedAt = await claimLease(db, geocoder.provider, token, deadline, sleep);
      if (claimIssuedAt === null) {
        log.info({ action: "place_lookup", outcome: "busy" }, "place lookup gave up waiting for the provider slot");
        return { ok: false, code: "busy" };
      }
      return await withLease(db, geocoder.provider, token, claimIssuedAt, async (send) => {
        const fresh = await readCache(db, key);
        if (fresh.hit) {
          return answered(fresh.result);
        }
        if ((await countRequest(db, { scope: PROVIDER_SCOPE, day, limit: env.PLACES_DAILY_PROVIDER_CALLS })) === null) {
          log.warn({ action: "place_lookup", outcome: "daily_limit" }, "daily provider calls used up");
          return { ok: false, code: "daily_limit" };
        }
        let result: PlaceResult | null;
        try {
          result = await send(() => geocoder.reverse(point));
        } catch (error) {
          if (error instanceof SendBudgetSpentError) {
            // Nothing was sent; withLease releases the lease (next-allowed unchanged). The provider count above stays
            // spent: over-counting is the safe direction for a quota. Retryable, like any wait for the slot.
            log.warn({ action: "place_lookup", outcome: "busy", reason: "send_budget_spent" }, "place lookup held its lease too long to send");
            return { ok: false, code: "busy" };
          }
          if (isPlaceProviderRefusedError(error)) {
            Sentry.captureException(error, { level: "warning", tags: { step: "place_lookup", provider: geocoder.provider } });
            log.warn({ action: "place_lookup", outcome: "provider_refused", status: error.status }, "place provider refused the request");
            return { ok: false, code: "provider_refused" };
          }
          return failed(error);
        }
        try {
          await db.placeLookup.upsert({
            where: { provider_latE6_lonE6: key },
            create: { ...key, result: result ?? Prisma.DbNull },
            update: { result: result ?? Prisma.DbNull, fetchedAt: new Date() },
          });
        } catch (error) {
          // The answer is good; only the cache missed it. Report and answer anyway.
          report(error);
        }
        log.info({ action: "place_lookup", outcome: "sent", found: result !== null }, "place provider answered");
        return answered(result);
      });
    } catch (error) {
      return failed(error);
    }
  };
}

const PROVIDER_SCOPE = "places:provider";

/** The viewer's counter scope: a hash prefix of the key, so the row never carries an address (as mediaViewerScope). */
function viewerScope(viewerKey: string): string {
  return `places:viewer:${createHash("sha256").update(viewerKey).digest("hex").slice(0, 16)}`;
}

function answered(result: PlaceResult | null): PlaceLookupResult {
  return { ok: true, labels: placeLabels(result), attribution: PLACES_ATTRIBUTION };
}

/** A cached row, parsed back into the trimmed shape; a row that no longer parses is treated as a miss. */
async function readCache(db: PlaceLookupDeps["db"], key: { provider: string; latE6: number; lonE6: number }): Promise<{ hit: true; result: PlaceResult | null } | { hit: false }> {
  const row = await db.placeLookup.findUnique({ where: { provider_latE6_lonE6: key }, select: { result: true } });
  if (row === null) {
    return { hit: false };
  }
  if (row.result === null) {
    return { hit: true, result: null };
  }
  const parsed = placeResultSchema.safeParse(row.result);
  return parsed.success ? { hit: true, result: parsed.data } : { hit: false };
}

/**
 * Take the site-wide lease for `provider` [C23]: one statement that inserts the row or takes it over only when the
 * fence has passed and no live lease exists, by the database's clock. Until the deadline, a refusal reads how long the
 * row stays busy and waits for that, at most 500 ms at a time.
 *
 * Answers `performance.now()` taken just before the winning claim was issued (the lease's 10 s start no earlier than
 * that), or null when the deadline came first.
 */
async function claimLease(db: PlaceLookupDeps["db"], provider: string, token: string, deadline: number, sleep: PlaceLookupDeps["sleep"]): Promise<number | null> {
  for (;;) {
    if (Date.now() >= deadline) {
      return null;
    }
    const issuedAt = performance.now();
    const claimed = await db.$queryRaw<Array<{ leaseToken: string }>>`
      INSERT INTO "PlaceLookupThrottle" ("provider","nextAllowedAt","leaseToken","leaseUntil")
      VALUES (${provider}, now(), ${token}, now() + interval '10 seconds')
      ON CONFLICT ("provider") DO UPDATE SET "leaseToken" = EXCLUDED."leaseToken", "leaseUntil" = EXCLUDED."leaseUntil"
        WHERE "PlaceLookupThrottle"."nextAllowedAt" <= now()
          AND ("PlaceLookupThrottle"."leaseToken" IS NULL OR "PlaceLookupThrottle"."leaseUntil" <= now())
      RETURNING "leaseToken"`;
    if (claimed.length === 1) {
      return issuedAt;
    }
    // How long the row stays busy, computed by the database from nextAllowedAt, leaseUntil and now(), so the app's
    // clock (and any time-zone reading of the timestamp columns) never enters the spacing.
    const rows = await db.$queryRaw<Array<{ waitMs: number }>>`
      SELECT GREATEST(
        EXTRACT(EPOCH FROM ("nextAllowedAt" - now())) * 1000,
        CASE WHEN "leaseToken" IS NOT NULL THEN EXTRACT(EPOCH FROM ("leaseUntil" - now())) * 1000 ELSE 0 END,
        0)::float8 AS "waitMs"
      FROM "PlaceLookupThrottle" WHERE "provider" = ${provider}`;
    const pause = Math.min(Math.max(Number(rows[0]?.waitMs ?? 0), MIN_PAUSE_MS), MAX_PAUSE_MS);
    if (Date.now() + pause >= deadline) {
      return null;
    }
    await sleep(pause);
  }
}

/** `send` refused to start: the send budget since the winning claim was spent (a stall between claim and send). */
class SendBudgetSpentError extends Error {
  constructor() {
    super("place lookup send budget spent");
    this.name = "SendBudgetSpentError";
  }
}

/**
 * Run `work` holding the lease, and give the lease back however it ends. `work` sends through `send`, and the fence
 * (next-allowed = the database's now() + 1.1 s, lease cleared) runs the moment the request settles, before anything
 * else (the cache write) happens, so the next caller's wait starts as early as the spacing allows. Without a send the
 * lease is released (next-allowed unchanged). A give-back that fails is logged and left to the lease's 10 s expiry; it
 * never changes the answer.
 *
 * `send` starts the request only within PLACE_SEND_BUDGET_MS of `claimIssuedAt` (performance.now() before the winning
 * claim), checked immediately before the request with nothing awaited between; past it, it throws
 * SendBudgetSpentError without sending. The check lives here so no path can send on a lease too old to fence.
 */
async function withLease<T>(db: PlaceLookupDeps["db"], provider: string, token: string, claimIssuedAt: number, work: (send: <R>(request: () => Promise<R>) => Promise<R>) => Promise<T>): Promise<T> {
  let returned = false;
  const giveBack = async (afterSend: boolean): Promise<void> => {
    if (returned) {
      return;
    }
    returned = true;
    try {
      if (afterSend) {
        const fenced = await db.$executeRaw`UPDATE "PlaceLookupThrottle" SET "nextAllowedAt" = now() + interval '1100 milliseconds', "leaseToken" = NULL, "leaseUntil" = NULL WHERE "provider" = ${provider} AND "leaseToken" = ${token}`;
        if (fenced === 0) {
          // Unreachable in practice: the send started at most 3 s (the send budget) after the claim and the provider is
          // cut off at 5 s, so this fence is issued at least 2 s before the 10 s lease runs out. Only a fence statement
          // delayed past that could miss, and the spacing still holds then: the next claim waited for the lease's
          // expiry, more than 7 s after this send started.
          log.warn({ action: "place_lookup_fence_missed", provider }, "place lookup lease expired before its fence");
        }
      } else {
        await db.$executeRaw`UPDATE "PlaceLookupThrottle" SET "leaseToken" = NULL, "leaseUntil" = NULL WHERE "provider" = ${provider} AND "leaseToken" = ${token}`;
      }
    } catch (error) {
      log.warn({ action: "place_lookup_lease_not_returned", provider, errorType: error instanceof Error ? error.name : typeof error }, "place lookup lease left to expire");
    }
  };
  const send = async <R>(request: () => Promise<R>): Promise<R> => {
    if (performance.now() - claimIssuedAt > PLACE_SEND_BUDGET_MS) {
      throw new SendBudgetSpentError();
    }
    try {
      return await request();
    } finally {
      await giveBack(true);
    }
  };
  try {
    return await work(send);
  } finally {
    await giveBack(false);
  }
}

function report(error: unknown): void {
  Sentry.captureException(error, { tags: { step: "place_lookup" } });
}

/** Reported, and answered as retryable. The log line names only the error's type (a driver error can quote parameters). */
function failed(error: unknown): PlaceLookupResult {
  report(error);
  log.warn({ action: "place_lookup", outcome: "failed", errorType: error instanceof Error ? error.name : typeof error }, "place lookup failed");
  return { ok: false, code: "failed" };
}
