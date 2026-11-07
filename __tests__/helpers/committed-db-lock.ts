import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/** Shared only by suites whose committed rows must survive the budget suite's TRUNCATE. */
const COMMITTED_DB_LOCK_KEY = 7_210_075;

/**
 * A session advisory lock needs one dedicated connection for its entire lifetime.
 * Test databases use direct Postgres, never a transaction-mode pooler. Keep this
 * client separate from each suite's pool so its concurrent writers still race.
 * Disable idle eviction: closing the session would silently release the lock
 * while the suite is still using its committed rows.
 */
export async function acquireCommittedDbLock(url: string): Promise<{ release(): Promise<void> }> {
  const holder = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1, idleTimeoutMillis: 0 }) });
  try {
    // $executeRaw avoids trying to deserialize pg_advisory_lock's void result.
    await holder.$executeRaw`SELECT pg_advisory_lock(${COMMITTED_DB_LOCK_KEY}::bigint)`;
  } catch (error) {
    await holder.$disconnect();
    throw error;
  }
  return {
    async release() {
      try {
        const rows = await holder.$queryRaw<Array<{ unlocked: boolean }>>`SELECT pg_advisory_unlock(${COMMITTED_DB_LOCK_KEY}::bigint) AS unlocked`;
        if (rows[0]?.unlocked !== true) { throw new Error("Committed database suite lock was lost"); }
      }
      finally { await holder.$disconnect(); }
    },
  };
}
