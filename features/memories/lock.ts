import "server-only";

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
 * Serialise the global upload budget (daily memories and bytes, total ceiling;
 * issue #44). The budget is a property of the whole table, so per-memory row
 * locks cannot protect its check-then-insert; under READ COMMITTED every
 * concurrent writer would see capacity and commit past it. A transaction-level
 * advisory lock is released at commit or rollback with no unlock call, and is
 * safe behind Neon's transaction-mode pooler (a session-level lock is not).
 *
 * Lock order everywhere: lease (anchor UPDATE) → memory → contributor → budget.
 * The budget lock is always the LAST lock a transaction takes and no holder
 * waits on a row lock afterwards, so no cycle through it is possible.
 */
export async function lockBudget(tx: Tx): Promise<void> {
  // $executeRaw, not $queryRaw: the function returns `void`, which the client cannot deserialise as a column.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BUDGET_LOCK_KEY}::bigint)`;
}
