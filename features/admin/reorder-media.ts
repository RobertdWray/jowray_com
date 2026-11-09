import "server-only";

import { currentMediaView, type AdminMediaEditableView } from "@/features/admin/media-editable";
import { TX_OPTIONS } from "@/features/memories/create-memory";
import { lockMemory } from "@/features/memories/lock";
import { appendRevision, LIVE_MEDIA_ORDER, snapshotsEqual, touchMemory } from "@/features/memories/media-state";
import { createLogger } from "@/lib/logger";
import { tagIds } from "@/lib/sentry/user";
import { adminMediaOrderSchema } from "@/lib/validations/admin";
import { getDb } from "@/server/db/client";

const log = createLogger({ category: "api" });

export type AdminMediaOrderResult =
  /** `changed: false`: the list was already in this order (nothing written, version unchanged). */
  | { ok: true; changed: boolean; current: AdminMediaEditableView }
  | { ok: false; code: "invalid" | "not_found" }
  /** `mismatch`: `mediaIds` is not exactly the visible files; `current.media` lists them. */
  | { ok: false; code: "stale" | "mismatch"; current: AdminMediaEditableView };

/**
 * MCP `reorder_media` (plan 2026-11-08-mcp-media-tools §3.4). Under the memory lock: re-read; `stale` when
 * `memoryVersion` moved (D11); `mismatch` unless `mediaIds` is exactly the visible set (`visibleMediaIds`: live, not
 * a pending replacement, any status, so FAILED rows count; D8). The no-op compares the id order, never the slots,
 * which have gaps after a removal (George G3). Each file takes `sortOrder = index`, and a replacement still uploading
 * takes its target's slot (as ticketing copies it); one ADMIN revision; the version moves last (D2).
 */
export async function reorderMediaAsAdmin(raw: unknown): Promise<AdminMediaOrderResult> {
  const parsed = adminMediaOrderSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const { memoryId, memoryVersion, mediaIds } = parsed.data;
  tagIds({ memoryId });

  const result = await getDb().$transaction(async (tx) => {
    await lockMemory(tx, memoryId);
    const memory = await tx.memory.findUnique({ where: { id: memoryId }, select: { deletedAt: true, updatedAt: true, consentVersion: true } });
    if (!memory || memory.deletedAt !== null) {
      return { code: "not_found" as const };
    }
    if (memory.updatedAt.toISOString() !== memoryVersion) {
      return { code: "stale" as const, current: await currentMediaView(tx, memoryId) };
    }
    const visible = await tx.media.findMany({ where: { memoryId, deletedAt: null, replacesMediaId: null }, select: { id: true, sortOrder: true }, orderBy: [...LIVE_MEDIA_ORDER] });
    const visibleIds = visible.map((row) => row.id);
    const wanted = new Set(mediaIds);
    if (visibleIds.length !== mediaIds.length || visibleIds.some((id) => !wanted.has(id))) {
      return { code: "mismatch" as const, current: await currentMediaView(tx, memoryId) };
    }
    if (snapshotsEqual({ mediaIds: visibleIds }, { mediaIds })) {
      return { code: "ok" as const, changed: false, current: await currentMediaView(tx, memoryId) };
    }
    const slotOf = new Map(visible.map((row) => [row.id, row.sortOrder]));
    for (const [index, id] of mediaIds.entries()) {
      if (slotOf.get(id) !== index) {
        await tx.media.update({ where: { id }, data: { sortOrder: index } });
      }
      // A replacement still uploading takes its target's slot when it lands; keep it in step.
      await tx.media.updateMany({ where: { memoryId, replacesMediaId: id, status: "PENDING", deletedAt: null, NOT: { sortOrder: index } }, data: { sortOrder: index } });
    }
    await appendRevision(tx, { memoryId, changedVia: "ADMIN", before: { mediaIds: visibleIds }, after: { mediaIds }, consentVersion: memory.consentVersion });
    await touchMemory(tx, memoryId, memory.updatedAt);
    return { code: "ok" as const, changed: true, current: await currentMediaView(tx, memoryId) };
  }, TX_OPTIONS);

  if (result.code === "ok") {
    if (result.changed) {
      log.info({ action: "admin_media_reordered", memoryId, files: mediaIds.length }, "files reordered through MCP");
    }
    return { ok: true, changed: result.changed, current: result.current };
  }
  if (result.code === "stale" || result.code === "mismatch") {
    return { ok: false, code: result.code, current: result.current };
  }
  return { ok: false, code: result.code };
}
