/**
 * An in-memory stand-in for the statements `lookupPlace` sends (plan 2026-11-06-photo-gps-places B4): the throttle row's
 * lease claim, wait read, release and fence; the daily counters; and the `PlaceLookup` cache.
 *
 * The clock is `Date.now()` (the tests fake it), playing the database's `now()`. Each statement takes effect when it is
 * called, which is when the database executes it, and its reply reaches the caller `replyDelayMs` later, so a test can
 * show the spacing holds even when replies are slow. The claim and fence must be the brief's SQL verbatim (whitespace
 * aside): any other statement against the throttle row throws.
 */
import { Prisma } from "@/generated/prisma/client";

export const CLAIM_SQL = `INSERT INTO "PlaceLookupThrottle" ("provider","nextAllowedAt","leaseToken","leaseUntil")
VALUES ($, now(), $, now() + interval '10 seconds')
ON CONFLICT ("provider") DO UPDATE SET "leaseToken" = EXCLUDED."leaseToken", "leaseUntil" = EXCLUDED."leaseUntil"
  WHERE "PlaceLookupThrottle"."nextAllowedAt" <= now()
    AND ("PlaceLookupThrottle"."leaseToken" IS NULL OR "PlaceLookupThrottle"."leaseUntil" <= now())
RETURNING "leaseToken"`;
export const FENCE_SQL = `UPDATE "PlaceLookupThrottle" SET "nextAllowedAt" = now() + interval '1100 milliseconds', "leaseToken" = NULL, "leaseUntil" = NULL WHERE "provider" = $ AND "leaseToken" = $`;

const squash = (sql: string) => sql.replace(/\s+/g, " ").trim();

export interface ThrottleRow {
  nextAllowedAt: number;
  leaseToken: string | null;
  leaseUntil: number | null;
}

export type StatementKind = "claim" | "wait" | "release" | "fence" | "count" | "cache_read" | "cache_write";

export interface FakePlacesDb {
  db: {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
    placeLookup: {
      findUnique: (args: { where: { provider_latE6_lonE6: { provider: string; latE6: number; lonE6: number } } }) => Promise<{ result: unknown } | null>;
      upsert: (args: { where: { provider_latE6_lonE6: { provider: string; latE6: number; lonE6: number } }; create: { provider: string; latE6: number; lonE6: number; result: unknown }; update: { result: unknown } }) => Promise<unknown>;
    };
  };
  throttle: Map<string, ThrottleRow>;
  /** Cache rows by `provider|latE6|lonE6`; `Prisma.DbNull` is stored as the marker it is. */
  cache: Map<string, unknown>;
  /** Counter values by scope. */
  counters: Map<string, number>;
  /** Every statement in the order the database executed it, with the scope for counters. */
  log: Array<{ kind: StatementKind; at: number; scope?: string; token?: unknown }>;
  /** Reply delay for each statement kind (ms); a function may vary it per call. */
  replyDelayMs: (kind: StatementKind) => number;
  /** Throw from the next statement of this kind (once). */
  failNext: (kind: StatementKind, error: Error) => void;
}

const cacheKey = (k: { provider: string; latE6: number; lonE6: number }) => `${k.provider}|${k.latE6}|${k.lonE6}`;

export function createFakePlacesDb(): FakePlacesDb {
  const throttle = new Map<string, ThrottleRow>();
  const cache = new Map<string, unknown>();
  const counters = new Map<string, number>();
  const log: FakePlacesDb["log"] = [];
  const failures = new Map<StatementKind, Error>();
  const fake: FakePlacesDb = {
    throttle,
    cache,
    counters,
    log,
    replyDelayMs: () => 0,
    failNext: (kind, error) => {
      failures.set(kind, error);
    },
    db: {
      $queryRaw: async (strings, ...values) => {
        const sql = squash(strings.join("$"));
        if (sql.includes('"EgressCounter"')) {
          const [scope, , limit] = values as [string, string, bigint];
          return run("count", { scope }, () => {
            const next = (counters.get(scope) ?? 0) + 1;
            if (next > Number(limit)) {
              return [];
            }
            counters.set(scope, next);
            return [{ bytes: BigInt(next) }];
          });
        }
        if (sql === squash(CLAIM_SQL)) {
          const [provider, token] = values as [string, string];
          return run("claim", { token }, () => {
            const now = Date.now();
            const row = throttle.get(provider);
            if (!row) {
              throttle.set(provider, { nextAllowedAt: now, leaseToken: token, leaseUntil: now + 10_000 });
              return [{ leaseToken: token }];
            }
            if (row.nextAllowedAt <= now && (row.leaseToken === null || (row.leaseUntil ?? 0) <= now)) {
              Object.assign(row, { leaseToken: token, leaseUntil: now + 10_000 });
              return [{ leaseToken: token }];
            }
            return [];
          });
        }
        if (sql.startsWith("SELECT") && sql.includes('"PlaceLookupThrottle"')) {
          const [provider] = values as [string];
          return run("wait", {}, () => {
            const now = Date.now();
            const row = throttle.get(provider);
            if (!row) {
              return [];
            }
            const leased = row.leaseToken !== null ? (row.leaseUntil ?? now) - now : 0;
            return [{ waitMs: Math.max(row.nextAllowedAt - now, leased, 0) }];
          });
        }
        throw new Error(`fake db: unexpected $queryRaw: ${sql}`);
      },
      $executeRaw: async (strings, ...values) => {
        const sql = squash(strings.join("$"));
        const [provider, token] = values as [string, string];
        if (sql === squash(FENCE_SQL)) {
          return run("fence", { token }, () => {
            const row = throttle.get(provider);
            if (!row || row.leaseToken !== token) {
              return 0;
            }
            Object.assign(row, { nextAllowedAt: Date.now() + 1100, leaseToken: null, leaseUntil: null });
            return 1;
          });
        }
        if (sql.startsWith('UPDATE "PlaceLookupThrottle" SET "leaseToken" = NULL')) {
          return run("release", { token }, () => {
            const row = throttle.get(provider);
            if (!row || row.leaseToken !== token) {
              return 0;
            }
            Object.assign(row, { leaseToken: null, leaseUntil: null });
            return 1;
          });
        }
        throw new Error(`fake db: unexpected $executeRaw: ${sql}`);
      },
      placeLookup: {
        findUnique: async ({ where }) =>
          run("cache_read", {}, () => {
            const key = cacheKey(where.provider_latE6_lonE6);
            if (!cache.has(key)) {
              return null;
            }
            const stored = cache.get(key);
            // Prisma reads SQL NULL back as null.
            return { result: stored === Prisma.DbNull ? null : stored };
          }),
        upsert: async ({ create, update }) =>
          run("cache_write", {}, () => {
            cache.set(cacheKey(create), update.result);
            return {};
          }),
      },
    },
  };

  async function run<T>(kind: StatementKind, extra: { scope?: string; token?: unknown }, execute: () => T): Promise<T> {
    const failure = failures.get(kind);
    if (failure) {
      failures.delete(kind);
      throw failure;
    }
    const value = execute();
    log.push({ kind, at: Date.now(), ...extra });
    const delay = fake.replyDelayMs(kind);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return value;
  }

  return fake;
}
