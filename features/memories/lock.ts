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
