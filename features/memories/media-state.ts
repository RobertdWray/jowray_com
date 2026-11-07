import "server-only";

import type { Tx } from "@/features/memories/lock";
import type { Prisma } from "@/generated/prisma/client";
import { summarizeMemoryType } from "@/lib/media-types";

export type MemoryType = "VOICE" | "VIDEO" | "PHOTO" | "TEXT";

/** Files the contributor sees as theirs: live rows in display order, excluding pending replacements of another row. */
export const LIVE_MEDIA_ORDER = [{ sortOrder: "asc" }, { createdAt: "asc" }] as const;

export function hasWords(note: string | null): boolean {
  return (note ?? "").trim().length > 0;
}

export async function visibleMediaIds(tx: Tx, memoryId: string): Promise<string[]> {
  const rows = await tx.media.findMany({
    where: { memoryId, deletedAt: null, replacesMediaId: null },
    select: { id: true },
    orderBy: [...LIVE_MEDIA_ORDER],
  });
  return rows.map((r) => r.id);
}

/**
 * Live READY files of a memory, in display order, optionally leaving one row
 * out: the snapshot an admin upload's revision records (plan
 * 2026-11-06-mcp-attach-media §8.3, D10). Unlike `visibleMediaIds` it filters
 * on READY, so a PENDING → READY transition changes it. Run inside the
 * transaction that holds `lockMemory`.
 */
export async function readyLiveMediaIds(tx: Tx, memoryId: string, excludeId?: string): Promise<string[]> {
  const rows = await tx.media.findMany({
    where: { memoryId, status: "READY", deletedAt: null, replacesMediaId: null, ...(excludeId !== undefined && { NOT: { id: excludeId } }) },
    select: { id: true },
    orderBy: [...LIVE_MEDIA_ORDER],
  });
  return rows.map((r) => r.id);
}

/**
 * Recompute `Memory.type` from the live READY media and the note (plan P8):
 * VIDEO > VOICE > PHOTO, TEXT with words, otherwise the provisional type is
 * kept (the invariants in claim.ts stop that state from being created).
 * Must run inside a transaction that already holds `lockMemory`.
 */
export async function recomputeMemoryType(tx: Tx, memoryId: string, note: string | null): Promise<MemoryType | null> {
  const ready = await tx.media.findMany({ where: { memoryId, deletedAt: null, status: "READY" }, select: { mimeType: true } });
  const type = summarizeMemoryType(ready, hasWords(note));
  if (type !== null) {
    await tx.memory.update({ where: { id: memoryId }, data: { type } });
  }
  return type;
}

export type RevisionVia = "WEB" | "SMS" | "CLAIM_LINK" | "ADMIN";

/**
 * Revisions kept per memory (issue #44, Oscar #17): the first one (it records
 * the consent version) and the latest MAX_REVISIONS_PER_MEMORY − 1. When a new
 * revision would pass the cap, the oldest of the rest are dropped first, so a
 * claim link replayed in a loop can hold at most this many snapshots.
 */
export const MAX_REVISIONS_PER_MEMORY = 200;

/**
 * True when an edit changes nothing: the same keys with the same values
 * (Dates by instant, arrays of ids element by element). A save that changes
 * nothing writes no row and no revision (issue #44, Oscar #17).
 */
export function snapshotsEqual(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const a = before[key];
    const b = after[key];
    if (a instanceof Date && b instanceof Date) {
      if (a.getTime() !== b.getTime()) {
        return false;
      }
      continue;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length || a.some((value, i) => value !== b[i])) {
        return false;
      }
      continue;
    }
    if (a !== b) {
      return false;
    }
  }
  return true;
}

/**
 * Append a revision. The first revision of a memory, whatever kind of edit it
 * is, also records the consent version in force; every writer goes through
 * here so a removal or a swap can never hide that record. Must run inside a
 * transaction that already holds `lockMemory`, which serialises the count,
 * the trim and the insert per memory.
 */
export async function appendRevision(
  tx: Tx,
  { memoryId, changedVia, before, after, consentVersion }: { memoryId: string; changedVia: RevisionVia; before: Record<string, unknown>; after: Record<string, unknown>; consentVersion: string }
): Promise<void> {
  const existing = await tx.memoryRevision.count({ where: { memoryId } });
  const isFirst = existing === 0;
  if (existing >= MAX_REVISIONS_PER_MEMORY) {
    // Keep the first row and make room for this one: drop the oldest of the rest.
    const surplus = await tx.memoryRevision.findMany({
      where: { memoryId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: 1,
      take: existing - MAX_REVISIONS_PER_MEMORY + 1,
      select: { id: true },
    });
    await tx.memoryRevision.deleteMany({ where: { id: { in: surplus.map((r) => r.id) } } });
  }
  await tx.memoryRevision.create({
    data: {
      memoryId,
      changedVia,
      before: before as Prisma.InputJsonValue,
      after: (isFirst ? { ...after, consentVersion } : after) as Prisma.InputJsonValue,
    },
  });
}

/** A CLAIM_LINK revision (the claim page's writers). */
export function appendClaimRevision(
  tx: Tx,
  input: { memoryId: string; before: Record<string, unknown>; after: Record<string, unknown>; consentVersion: string }
): Promise<void> {
  return appendRevision(tx, { ...input, changedVia: "CLAIM_LINK" });
}
