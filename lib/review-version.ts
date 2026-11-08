import { createHash } from "node:crypto";

/**
 * What an approval vouches for (TCR round 1, B1-3). Approving publishes a memory on See memories, so the family must
 * approve what they read: the admin page and MCP `get_memory` hand out this version with the memory, and
 * `set_status` (and `share_draft` to APPROVED) recompute it under the memory lock and refuse with `stale` when it
 * differs.
 *
 * The facts are timestamps Prisma's `@updatedAt` moves on every write: the memory row (its words, date, place,
 * visibility, tags, status), the contributor row (the name and relationship every memory of the send shows) and each
 * live file (`deletedAt` null), by id, status and `updatedAt` (a file added, removed, replaced, re-captioned or
 * finished). Any of them moving means the memory is no longer exactly what was read. Background work on a file (the
 * location scan, the hash) also moves `updatedAt`, so a version can go stale without a visible change; re-reading is
 * the answer either way.
 */
export interface ReviewFacts {
  memoryUpdatedAt: Date;
  /** null for a memory with no contributor row. */
  contributorUpdatedAt: Date | null;
  /** The memory's live files (`deletedAt` null), in any order. */
  media: ReadonlyArray<{ id: string; status: string; updatedAt: Date }>;
}

/** The version string: a prefix naming the scheme, then a SHA-256 (base64url) of the facts in a fixed order. */
export function computeReviewVersion({ memoryUpdatedAt, contributorUpdatedAt, media }: ReviewFacts): string {
  const files = [...media]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((file) => [file.id, file.status, file.updatedAt.toISOString()]);
  const canonical = JSON.stringify([memoryUpdatedAt.toISOString(), contributorUpdatedAt?.toISOString() ?? null, files]);
  return `rv1.${createHash("sha256").update(canonical).digest("base64url")}`;
}
