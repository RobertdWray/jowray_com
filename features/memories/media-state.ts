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

/**
 * Append a CLAIM_LINK revision. The first revision of a memory, whatever kind
 * of edit it is, also records the consent version in force; every writer goes
 * through here so a removal or a swap can never hide that record.
 */
export async function appendClaimRevision(
  tx: Tx,
  { memoryId, before, after, consentVersion }: { memoryId: string; before: Record<string, unknown>; after: Record<string, unknown>; consentVersion: string }
): Promise<void> {
  const isFirst = (await tx.memoryRevision.count({ where: { memoryId } })) === 0;
  await tx.memoryRevision.create({
    data: {
      memoryId,
      changedVia: "CLAIM_LINK",
      before: before as Prisma.InputJsonValue,
      after: (isFirst ? { ...after, consentVersion } : after) as Prisma.InputJsonValue,
    },
  });
}
