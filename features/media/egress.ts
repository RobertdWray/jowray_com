import "server-only";

import { createHash } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Counters behind the media routes (issue #45). One row per scope per UTC
 * day in `EgressCounter`; every write is a single conditional statement, so
 * two requests arriving together cannot both squeeze under a ceiling the
 * way a read-then-write would let them. Three scope families share the
 * table:
 *
 * - `global`: bytes served to claim-link holders site-wide today.
 * - `media:<id>`: bytes served from one file today.
 * - `media:<id>:<copy>:<viewer>`: requests one viewer made for one copy of
 *   one file today (the `bytes` column holds a request count here). The
 *   first request of the day is what charges the two byte counters; the
 *   rest of that viewer's day is free, because a media element asks for a
 *   file many times (a probe, the first range, seeks, reloads) and we can
 *   only see the request, never how much the blob host then sent.
 *
 * So the byte counters say "viewers × size", a fair stand-in for what a
 * day of real viewing costs, and the per-viewer request cap is what stops
 * one address looping on a file.
 */

export const GLOBAL_EGRESS_SCOPE = "global";

export function mediaEgressScope(mediaId: string): string {
  return `media:${mediaId}`;
}

/** One viewer's day with one copy of one file. The viewer key is hashed so the row never carries an address. */
export function mediaViewerScope(mediaId: string, copy: string, viewerKey: string): string {
  const viewer = createHash("sha256").update(viewerKey).digest("hex").slice(0, 16);
  return `media:${mediaId}:${copy}:${viewer}`;
}

/**
 * Who is asking, as far as a Vercel function can tell: the client address
 * Vercel puts on the request. Shared NATs look like one viewer (fine: they
 * share one charge); a phone that changes address looks like a new viewer
 * (fine: one more charge). Without either header, every viewer is `unknown`.
 */
export function viewerKeyFrom(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) {
    return real;
  }
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded && forwarded.length > 0 ? forwarded : "unknown";
}

/** The counters' window: a UTC calendar day as `YYYY-MM-DD`. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Seconds until the counters roll over, for `Retry-After`. */
export function secondsUntilNextUtcDay(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

type Db = Pick<PrismaClient, "$executeRaw" | "$queryRaw">;

interface CounterKey {
  scope: string;
  day: string;
  bytes: number;
}

function asBigInt(value: number): bigint {
  return BigInt(Math.max(0, Math.round(value)));
}

/**
 * Add `bytes` to the counter unless that would pass `limit`. True when the
 * bytes were recorded (the caller may serve), false when the ceiling held.
 */
export async function reserveEgress(db: Db, { scope, day, bytes, limit }: CounterKey & { limit: number }): Promise<boolean> {
  if (bytes > limit) {
    return false;
  }
  const changed = await db.$executeRaw`
    INSERT INTO "EgressCounter" ("scope", "day", "bytes") VALUES (${scope}, ${day}::date, ${asBigInt(bytes)})
    ON CONFLICT ("scope", "day") DO UPDATE
      SET "bytes" = "EgressCounter"."bytes" + EXCLUDED."bytes", "updatedAt" = now()
      WHERE "EgressCounter"."bytes" + EXCLUDED."bytes" <= ${asBigInt(limit)}`;
  return changed === 1;
}

/** Record bytes with no ceiling: the family admin's own views are counted, never refused. */
export async function recordEgress(db: Db, { scope, day, bytes }: CounterKey): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "EgressCounter" ("scope", "day", "bytes") VALUES (${scope}, ${day}::date, ${asBigInt(bytes)})
    ON CONFLICT ("scope", "day") DO UPDATE
      SET "bytes" = "EgressCounter"."bytes" + EXCLUDED."bytes", "updatedAt" = now()`;
}

/** Give back a reservation that was not served (a later ceiling refused). Never below zero. */
export async function releaseEgress(db: Db, { scope, day, bytes }: CounterKey): Promise<void> {
  await db.$executeRaw`
    UPDATE "EgressCounter"
      SET "bytes" = GREATEST("EgressCounter"."bytes" - ${asBigInt(bytes)}, 0), "updatedAt" = now()
      WHERE "scope" = ${scope} AND "day" = ${day}::date`;
}

/**
 * Count one more request under `scope` unless that would pass `limit`.
 * Answers the request's ordinal for the day (1 for the first), or null when
 * the cap held. One statement, so concurrent first requests (a media
 * element's probe and its first range arrive together) get 1 and 2, never
 * 1 and 1.
 */
export async function countRequest(db: Db, { scope, day, limit }: { scope: string; day: string; limit: number }): Promise<number | null> {
  const rows = await db.$queryRaw<Array<{ bytes: bigint | number }>>`
    INSERT INTO "EgressCounter" ("scope", "day", "bytes") VALUES (${scope}, ${day}::date, 1)
    ON CONFLICT ("scope", "day") DO UPDATE
      SET "bytes" = "EgressCounter"."bytes" + 1, "updatedAt" = now()
      WHERE "EgressCounter"."bytes" + 1 <= ${asBigInt(limit)}
    RETURNING "bytes"`;
  const first = rows[0];
  return first === undefined ? null : Number(first.bytes);
}
