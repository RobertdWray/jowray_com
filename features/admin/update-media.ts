import "server-only";

import { currentMediaView, type AdminMediaEditableView } from "@/features/admin/media-editable";
import { TX_OPTIONS } from "@/features/memories/create-memory";
import { lockMemory } from "@/features/memories/lock";
import { appendRevision, touchMemory } from "@/features/memories/media-state";
import { createLogger } from "@/lib/logger";
import { tagIds } from "@/lib/sentry/user";
import { adminMediaWordsSchema } from "@/lib/validations/admin";
import { getDb } from "@/server/db/client";

const log = createLogger({ category: "api" });

const WORD_KEYS = ["caption", "approxDateText", "place"] as const;
type WordKey = (typeof WORD_KEYS)[number];

export type AdminMediaWordsResult =
  /** `written` names the keys that changed (empty when every word was already equal: nothing written, version unchanged). */
  | { ok: true; written: WordKey[]; current: AdminMediaEditableView }
  | { ok: false; code: "invalid" | "not_found" }
  | { ok: false; code: "stale"; current: AdminMediaEditableView };

/**
 * MCP `update_media` (plan 2026-11-08-mcp-media-tools §3.2): edit a READY file's caption, rough date or place. Under
 * the memory lock: re-read; `stale` when `memoryVersion` moved (checked before the file, D11); only a visible READY
 * file that is not purged is a target (D10: a PENDING row's words are rewritten by a `request_upload` retry); write
 * the keys that differ, copy them to a replacement still uploading (as the claim page does), append one ADMIN
 * revision and move the version last (D2). An admin edit never reopens review (D4).
 */
export async function updateMediaAsAdmin(raw: unknown): Promise<AdminMediaWordsResult> {
  const parsed = adminMediaWordsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const { memoryId, memoryVersion, mediaId, changes } = parsed.data;
  tagIds({ memoryId, mediaId });

  const result = await getDb().$transaction(async (tx) => {
    await lockMemory(tx, memoryId);
    const memory = await tx.memory.findUnique({ where: { id: memoryId }, select: { deletedAt: true, updatedAt: true, consentVersion: true } });
    if (!memory || memory.deletedAt !== null) {
      return { code: "not_found" as const };
    }
    if (memory.updatedAt.toISOString() !== memoryVersion) {
      return { code: "stale" as const, current: await currentMediaView(tx, memoryId) };
    }
    const target = await tx.media.findFirst({
      where: { id: mediaId, memoryId, status: "READY", deletedAt: null, replacesMediaId: null, purgedAt: null },
      select: { id: true, caption: true, approxDateText: true, place: true },
    });
    if (!target) {
      return { code: "not_found" as const };
    }
    const written = WORD_KEYS.filter((key) => changes[key] !== undefined && changes[key] !== target[key]);
    if (written.length === 0) {
      return { code: "ok" as const, written, current: await currentMediaView(tx, memoryId) };
    }
    const before: Record<string, unknown> = { mediaId };
    const words: Partial<Record<WordKey, string | null>> = {};
    for (const key of written) {
      before[key] = target[key];
      words[key] = changes[key] ?? null;
    }
    await tx.media.update({ where: { id: target.id }, data: words });
    // A replacement still on its way copied the target's words when it was ticketed; keep it current so the swap cannot restore stale words.
    await tx.media.updateMany({ where: { memoryId, replacesMediaId: target.id, status: "PENDING", deletedAt: null }, data: words });
    await appendRevision(tx, { memoryId, changedVia: "ADMIN", before, after: { mediaId, ...words }, consentVersion: memory.consentVersion });
    await touchMemory(tx, memoryId, memory.updatedAt);
    return { code: "ok" as const, written, current: await currentMediaView(tx, memoryId) };
  }, TX_OPTIONS);

  if (result.code === "ok") {
    if (result.written.length > 0) {
      log.info({ action: "admin_media_updated", memoryId, mediaId, keys: result.written }, "file words edited through MCP");
    }
    return { ok: true, written: result.written, current: result.current };
  }
  if (result.code === "stale") {
    return { ok: false, code: "stale", current: result.current };
  }
  return { ok: false, code: result.code };
}
