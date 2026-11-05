import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { getDb } from "@/server/db/client";

/** The interactive-transaction client Prisma hands to `$transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<ReturnType<typeof getDb>["$transaction"]>[0]>[0];

/**
 * Serialise every change to one memory's media. Interactive transactions run
 * at READ COMMITTED, so two removals could each count two live files and both
 * proceed; a `FOR UPDATE` lock on the parent row makes the second wait for the
 * first to commit and then re-read. The id travels as a bound parameter.
 */
export async function lockMemory(tx: Tx, memoryId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Memory" WHERE "id" = ${memoryId} FOR UPDATE`;
}

/**
 * Lock one contributor row (shared by every memory of a send). Lock order
 * everywhere: memory first, then contributor; the claim writer holds only the
 * memory lock and touches the contributor inside it, so an admin that takes
 * memory → contributor never deadlocks with it.
 */
export async function lockContributor(tx: Tx, contributorId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Contributor" WHERE "id" = ${contributorId} FOR UPDATE`;
}

/** Advisory-lock key of the global upload budget: one fixed bigint shared by every budget writer. */
export const BUDGET_LOCK_KEY = 7_210_044;
/**
 * How long a budget writer waits for the lock before it answers "try again
 * later" instead of a 500. Holders keep the lock for a few milliseconds (one
 * statement plus the inserts), so a wait this long means a queue of hundreds;
 * the WAF prices that queue. Under Prisma's 10 s transaction timeout.
 */
export const BUDGET_LOCK_TIMEOUT = "5s";

/** The budget lock could not be taken within BUDGET_LOCK_TIMEOUT; callers answer `budget_exceeded` (TCR #4). */
export class BudgetBusyError extends Error {
  constructor() {
    super(`budget lock not acquired within ${BUDGET_LOCK_TIMEOUT}`);
    this.name = "BudgetBusyError";
  }
}

/**
 * Postgres SQLSTATE 55P03 (lock_not_available). Prisma 7's driver adapters raise
 * a P2010 whose `meta.driverAdapterError.cause.code` is the SQLSTATE (observed
 * against Postgres through @prisma/adapter-pg); the message is the fallback.
 */
export function isLockTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const meta = (error as { meta?: { code?: unknown; driverAdapterError?: { cause?: { code?: unknown } } } }).meta;
  if (meta?.code === "55P03" || meta?.driverAdapterError?.cause?.code === "55P03") {
    return true;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.includes("canceling statement due to lock timeout");
}

/**
 * Serialise the global upload budget (daily memories and bytes, total ceiling;
 * issue #44). The budget is a property of the whole table, so per-memory row
 * locks cannot protect its check-then-insert; under READ COMMITTED every
 * concurrent writer would see capacity and commit past it. A transaction-level
 * advisory lock is released at commit or rollback with no unlock call, and is
 * safe behind Neon's transaction-mode pooler (a session-level lock is not).
 *
 * Lock order everywhere: lease (anchor UPDATE) → memory → contributor → budget.
 * The budget lock is always the LAST lock a transaction takes and no holder
 * waits on a row lock afterwards, so no cycle through it is possible. A
 * transaction may call this more than once (the lock is reentrant).
 *
 * Production runs with `lock_timeout = 0`, so a queued writer would otherwise
 * wait until Prisma's client timer fires and surface a 500; the transaction's
 * own `lock_timeout` turns that wait into `BudgetBusyError` (TCR #4).
 */
export async function lockBudget(tx: Tx): Promise<void> {
  // SET LOCAL is scoped to this transaction, so it never leaks through the pooler. SET takes no
  // bind parameters, so the compile-time constant is spliced in as raw SQL (no input reaches it).
  await tx.$executeRaw`SET LOCAL lock_timeout = '${Prisma.raw(BUDGET_LOCK_TIMEOUT)}'`;
  try {
    // $executeRaw, not $queryRaw: the function returns `void`, which the client cannot deserialise as a column.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BUDGET_LOCK_KEY}::bigint)`;
  } catch (error) {
    if (isLockTimeout(error)) {
      throw new BudgetBusyError();
    }
    throw error;
  }
}
