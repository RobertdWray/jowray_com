import "server-only";

import type { Tx } from "@/features/memories/lock";
import { LIVE_MEDIA_ORDER } from "@/features/memories/media-state";
import type { AdminMemoryStatus } from "@/lib/validations/admin";

/**
 * How long a READY file removed through MCP keeps its bytes (plan 2026-11-08-mcp-media-tools D6): the same 30 days
 * cron step (f) gives a deleted memory (`DELETED_MEMORY_GRACE_MS`).
 */
export const REMOVED_MEDIA_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/** One file the photo tools can edit or reorder: a visible file (`visibleMediaIds`), any status. */
export interface AdminMediaEditable {
  id: string;
  status: "PENDING" | "READY" | "FAILED";
  mimeType: string;
  originalFilename: string | null;
  caption: string | null;
  approxDateText: string | null;
  place: string | null;
  sortOrder: number;
}

/** A READY file removed through MCP whose bytes are still kept: `set_media_deleted` can restore it (D7). */
export interface AdminRemovedMedia {
  id: string;
  mimeType: string;
  originalFilename: string | null;
  caption: string | null;
  approxDateText: string | null;
  removedAt: Date;
  /** The earliest moment cron step (f) may purge it; a restore still works until the cron has claimed the row. */
  restorableUntil: Date;
}

/**
 * `current` in every photo tool's answer (§3.1, D12): what the stale rule compares, so a caller can tell whether
 * only the version moved. Read inside the tool's transaction, after its write.
 */
export interface AdminMediaEditableView {
  memoryVersion: string;
  status: AdminMemoryStatus;
  visibility: "PUBLIC" | "FAMILY" | "PRIVATE";
  media: AdminMediaEditable[];
  removedMedia: AdminRemovedMedia[];
}

/** The delegates these reads use: the transaction client inside a tool, `getDb()` for `get_memory`. */
export type MediaReader = Pick<Tx, "memory" | "media">;

/**
 * The files `set_media_deleted` may restore (D7): removed through MCP while READY (only then is `purgeAfter` set),
 * bytes not yet claimed by the cron, and never a pending replacement (a cancelled replacement stays cancelled).
 */
export function restorableWhere(memoryId: string) {
  return { memoryId, status: "READY", deletedAt: { not: null }, purgeAfter: { not: null }, purgedAt: null, replacesMediaId: null } as const;
}

/** The restorable removed files of a memory, most recently removed first. */
export async function removedMediaOf(db: MediaReader, memoryId: string): Promise<AdminRemovedMedia[]> {
  const rows = await db.media.findMany({
    where: restorableWhere(memoryId),
    select: { id: true, mimeType: true, originalFilename: true, caption: true, approxDateText: true, deletedAt: true, purgeAfter: true },
    orderBy: [{ deletedAt: "desc" }, { id: "asc" }],
  });
  return rows.flatMap((row) =>
    // The where clause guarantees both stamps; the guard narrows the types without a cast.
    row.deletedAt !== null && row.purgeAfter !== null
      ? [{ id: row.id, mimeType: row.mimeType, originalFilename: row.originalFilename, caption: row.caption, approxDateText: row.approxDateText, removedAt: row.deletedAt, restorableUntil: row.purgeAfter }]
      : []
  );
}

/**
 * `current` inside a photo tool's transaction, which holds the memory's lock: memory rows are never hard-deleted, so
 * a missing row here is a broken invariant and throws (the MCP boundary reports it to Sentry).
 */
export async function currentMediaView(tx: Tx, memoryId: string): Promise<AdminMediaEditableView> {
  const view = await mediaEditableView(tx, memoryId);
  if (!view) {
    throw new Error(`memory ${memoryId} vanished while locked`);
  }
  return view;
}

/** The memory's editable files and restorable removed files; null when the memory row does not exist. */
export async function mediaEditableView(db: MediaReader, memoryId: string): Promise<AdminMediaEditableView | null> {
  const memory = await db.memory.findUnique({ where: { id: memoryId }, select: { updatedAt: true, status: true, visibility: true } });
  if (!memory) {
    return null;
  }
  const media = await db.media.findMany({
    where: { memoryId, deletedAt: null, replacesMediaId: null },
    select: { id: true, status: true, mimeType: true, originalFilename: true, caption: true, approxDateText: true, place: true, sortOrder: true },
    orderBy: [...LIVE_MEDIA_ORDER],
  });
  return {
    memoryVersion: memory.updatedAt.toISOString(),
    status: memory.status,
    visibility: memory.visibility,
    media,
    removedMedia: await removedMediaOf(db, memoryId),
  };
}
