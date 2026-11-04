import "server-only";

import { TX_OPTIONS } from "@/features/memories/create-memory";
import { lockMemory } from "@/features/memories/lock";
import { appendRevision } from "@/features/memories/media-state";
import { createLogger } from "@/lib/logger";
import { adminDeletedSchema } from "@/lib/validations/admin";
import { getDb } from "@/server/db/client";

const log = createLogger({ category: "api" });

export type AdminDeletedResult = { ok: true; purgedFiles: number } | { ok: false; code: "invalid" | "not_found" };

/**
 * Soft-delete or restore (plan §3.5, §4.5). A deleted memory leaves the
 * family's view and its claim page 404s; cron step (f) removes its files only
 * after 30 days, and marks each with `purgedAt` before the first byte goes.
 * Restore brings the words back whenever; `purgedFiles` says how many live
 * files are gone or going so the page can say so. Idempotent: already in the
 * requested state is a success with no revision.
 */
export async function setMemoryDeletedAsAdmin(raw: unknown): Promise<AdminDeletedResult> {
  const parsed = adminDeletedSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const { memoryId, deleted } = parsed.data;
  const result = await getDb().$transaction(async (tx) => {
    await lockMemory(tx, memoryId);
    const fresh = await tx.memory.findUnique({ where: { id: memoryId }, select: { deletedAt: true, consentVersion: true } });
    if (!fresh) {
      return "not_found" as const;
    }
    const purgedFiles = await tx.media.count({ where: { memoryId, deletedAt: null, purgedAt: { not: null } } });
    if ((fresh.deletedAt !== null) === deleted) {
      return { changed: false, purgedFiles };
    }
    const deletedAt = deleted ? new Date() : null;
    await tx.memory.update({ where: { id: memoryId }, data: { deletedAt } });
    await appendRevision(tx, {
      memoryId,
      changedVia: "ADMIN",
      before: { deletedAt: fresh.deletedAt?.toISOString() ?? null },
      after: { deletedAt: deletedAt?.toISOString() ?? null },
      consentVersion: fresh.consentVersion,
    });
    return { changed: true, purgedFiles };
  }, TX_OPTIONS);

  if (result === "not_found") {
    return { ok: false, code: "not_found" };
  }
  if (result.changed) {
    log.info({ action: deleted ? "admin_memory_deleted" : "admin_memory_restored", memoryId, purgedFiles: result.purgedFiles }, deleted ? "memory deleted from the admin page" : "memory restored from the admin page");
  }
  return { ok: true, purgedFiles: result.purgedFiles };
}
