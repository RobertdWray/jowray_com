import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Bytes-served counters behind the media routes (issue #45). One row per
 * scope per UTC day in `EgressCounter`; a scope is `global` or one file.
 * Every write is a single conditional upsert, so two requests arriving
 * together cannot both squeeze under a ceiling the way a read-then-write
 * would let them. Counting happens when a response is issued (the size of
 * the copy about to be served), which over-counts a partial fetch and never
 * under-counts: the conservative side for a shared bill.
 */

export const GLOBAL_EGRESS_SCOPE = "global";

export function mediaEgressScope(mediaId: string): string {
  return `media:${mediaId}`;
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

type Db = Pick<PrismaClient, "$executeRaw">;

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
