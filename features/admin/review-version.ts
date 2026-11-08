import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { computeReviewVersion } from "@/lib/review-version";

/**
 * The rows behind a memory's review version (lib/review-version.ts, TCR round 1 B1-3): its own `updatedAt`, its
 * contributor's, and every live file's id, status and `updatedAt`. `getMemoryForAdmin` reads the same live files
 * (`deletedAt` null), so the version it hands out and the one recomputed here agree while nothing changes.
 */
export const REVIEW_FACTS_SELECT = {
  updatedAt: true,
  contributor: { select: { updatedAt: true } },
  media: { where: { deletedAt: null }, select: { id: true, status: true, updatedAt: true } },
} satisfies Prisma.MemorySelect;

type ReviewRow = Prisma.MemoryGetPayload<{ select: typeof REVIEW_FACTS_SELECT }>;

/**
 * The version for rows read with REVIEW_FACTS_SELECT (or a superset of it). The approving writers spread the select
 * into the read they already make under the memory lock, so the version is judged on locked rows in one statement.
 */
export function reviewVersionOf(row: ReviewRow): string {
  return computeReviewVersion({ memoryUpdatedAt: row.updatedAt, contributorUpdatedAt: row.contributor?.updatedAt ?? null, media: row.media });
}
