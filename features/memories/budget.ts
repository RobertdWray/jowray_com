import "server-only";

import type { Tx } from "@/features/memories/lock";
import { getUploadEnv } from "@/server/config/env";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Neon computes can take a couple of seconds to wake; Prisma's defaults (2 s / 5 s) are too tight. */
export const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/** True when one more memory and `addBytes` more ticketed bytes fit in today's budgets. */
export async function withinBudget(tx: Tx, addBytes: number, countMemory: boolean): Promise<boolean> {
  const env = getUploadEnv();
  const since = new Date(Date.now() - DAY_MS);
  if (countMemory) {
    const memories = await tx.memory.count({ where: { createdAt: { gt: since } } });
    if (memories >= env.DAILY_MEMORY_BUDGET) {
      return false;
    }
  }
  if (addBytes > 0) {
    const bytes = await tx.media.aggregate({ _sum: { maxBytes: true }, where: { createdAt: { gt: since } } });
    if ((bytes._sum.maxBytes ?? 0) + addBytes > env.DAILY_BYTE_BUDGET) {
      return false;
    }
  }
  return true;
}
