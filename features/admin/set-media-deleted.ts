import "server-only";

import { currentMediaView, REMOVED_MEDIA_GRACE_MS, type AdminMediaEditableView } from "@/features/admin/media-editable";
import { TX_OPTIONS } from "@/features/memories/create-memory";
import { lockMemory } from "@/features/memories/lock";
import { appendRevision, hasWords, recomputeMemoryType, touchMemory, visibleMediaIds } from "@/features/memories/media-state";
import { createLogger } from "@/lib/logger";
import { MAX_FILES_PER_MEMORY } from "@/lib/media-types";
import { tagIds } from "@/lib/sentry/user";
import { adminMediaDeletedSchema } from "@/lib/validations/admin";
import { getDb } from "@/server/db/client";

const log = createLogger({ category: "api" });

export type AdminMediaDeletedResult =
  /** `changed: false`: already in the requested state (nothing written). `restorableUntil` only after removing a READY file. */
  | { ok: true; changed: boolean; current: AdminMediaEditableView; restorableUntil?: Date }
  | { ok: false; code: "invalid" | "not_found" | "last_file" | "not_restorable" | "too_many_files" }
  | { ok: false; code: "stale"; current: AdminMediaEditableView };

/**
 * MCP `set_media_deleted` (plan 2026-11-08-mcp-media-tools §3.3). Under the memory lock: re-read; `stale` when
 * `memoryVersion` moved (before the file, D11); the target is a file of this memory that is not a pending replacement.
 *
 * Remove: a live READY file (not yet claimed by the cron) keeps its bytes until `purgeAfter` (now + 30 days) and can
 * be restored; a PENDING or FAILED file, or one the cron has claimed, is a cancellation with today's purge (D6: cron
 * steps (a) and (f2) act on PENDING rows without reading `purgeAfter`). The last live READY file of a memory without
 * words stays (`last_file`, as on the claim page). A replacement still uploading for the target is cancelled with it
 * (`deletedAt` only).
 *
 * Restore: only a READY file removed here whose bytes the cron has not claimed (D7), within the file cap. It keeps
 * its old slot (D9). Both directions recompute the memory's type, append one ADMIN revision and move the version
 * last (D2).
 */
export async function setMediaDeletedAsAdmin(raw: unknown): Promise<AdminMediaDeletedResult> {
  const parsed = adminMediaDeletedSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const { memoryId, memoryVersion, mediaId, deleted } = parsed.data;
  tagIds({ memoryId, mediaId });

  const result = await getDb().$transaction(async (tx) => {
    await lockMemory(tx, memoryId);
    const memory = await tx.memory.findUnique({ where: { id: memoryId }, select: { deletedAt: true, updatedAt: true, consentVersion: true, contributorNote: true, type: true } });
    if (!memory || memory.deletedAt !== null) {
      return { code: "not_found" as const };
    }
    if (memory.updatedAt.toISOString() !== memoryVersion) {
      return { code: "stale" as const, current: await currentMediaView(tx, memoryId) };
    }
    const target = await tx.media.findFirst({
      where: { id: mediaId, memoryId, replacesMediaId: null },
      select: { id: true, status: true, deletedAt: true, purgeAfter: true, purgedAt: true },
    });
    if (!target) {
      return { code: "not_found" as const };
    }
    // A file the cron has claimed (`purgedAt`) is gone or going, whatever its status still says: it neither holds the
    // memory up nor has bytes to keep (TCR round 1, #1).
    const liveReady = target.status === "READY" && target.purgedAt === null;
    if ((target.deletedAt !== null) === deleted) {
      // Already removed through MCP and still restorable: repeat when it may be purged, as the removal answered (George G9).
      const restorable = deleted && liveReady ? target.purgeAfter : null;
      return { code: "ok" as const, changed: false, current: await currentMediaView(tx, memoryId), restorableUntil: restorable ?? undefined };
    }
    const now = new Date();
    const before = { mediaIds: await visibleMediaIds(tx, memoryId), type: memory.type };
    let after: Record<string, unknown>;
    let restorableUntil: Date | undefined;

    if (deleted) {
      if (liveReady && !hasWords(memory.contributorNote)) {
        // The same rule for the others: a file marked for purge cannot hold the memory up.
        const readyFiles = await tx.media.count({ where: { memoryId, deletedAt: null, status: "READY", purgedAt: null } });
        if (readyFiles <= 1) {
          return { code: "last_file" as const };
        }
      }
      const purgeAfter = liveReady ? new Date(now.getTime() + REMOVED_MEDIA_GRACE_MS) : null;
      await tx.media.update({ where: { id: target.id }, data: { deletedAt: now, purgeAfter } });
      const replacements = await tx.media.findMany({ where: { memoryId, replacesMediaId: target.id, deletedAt: null, status: "PENDING" }, select: { id: true }, orderBy: { id: "asc" } });
      if (replacements.length > 0) {
        await tx.media.updateMany({ where: { id: { in: replacements.map((r) => r.id) } }, data: { deletedAt: now } });
      }
      const type = (await recomputeMemoryType(tx, memoryId, memory.contributorNote)) ?? memory.type;
      after = {
        mediaIds: await visibleMediaIds(tx, memoryId),
        type,
        removedMediaId: target.id,
        purgeAfter: purgeAfter?.toISOString() ?? null,
        ...(replacements.length > 0 && { cancelledReplacementIds: replacements.map((r) => r.id) }),
      };
      restorableUntil = purgeAfter ?? undefined;
    } else {
      if (target.status !== "READY" || target.purgeAfter === null || target.purgedAt !== null) {
        return { code: "not_restorable" as const };
      }
      const liveFiles = await tx.media.count({ where: { memoryId, deletedAt: null, status: { in: ["PENDING", "READY"] } } });
      if (liveFiles >= MAX_FILES_PER_MEMORY) {
        return { code: "too_many_files" as const };
      }
      await tx.media.update({ where: { id: target.id }, data: { deletedAt: null, purgeAfter: null } });
      const type = (await recomputeMemoryType(tx, memoryId, memory.contributorNote)) ?? memory.type;
      after = { mediaIds: await visibleMediaIds(tx, memoryId), type, restoredMediaId: target.id };
    }

    await appendRevision(tx, { memoryId, changedVia: "ADMIN", before, after, consentVersion: memory.consentVersion });
    await touchMemory(tx, memoryId, memory.updatedAt);
    return { code: "ok" as const, changed: true, current: await currentMediaView(tx, memoryId), restorableUntil };
  }, TX_OPTIONS);

  if (result.code === "ok") {
    if (result.changed) {
      log.info({ action: deleted ? "admin_media_removed" : "admin_media_restored", memoryId, mediaId, graced: result.restorableUntil !== undefined }, deleted ? "file removed through MCP" : "file restored through MCP");
    }
    return { ok: true, changed: result.changed, current: result.current, ...(result.restorableUntil !== undefined && { restorableUntil: result.restorableUntil }) };
  }
  if (result.code === "stale") {
    return { ok: false, code: "stale", current: result.current };
  }
  return { ok: false, code: result.code };
}
