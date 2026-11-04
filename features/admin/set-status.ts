import "server-only";

import { TX_OPTIONS } from "@/features/memories/create-memory";
import { lockMemory } from "@/features/memories/lock";
import { appendRevision } from "@/features/memories/media-state";
import { createLogger } from "@/lib/logger";
import { adminStatusSchema } from "@/lib/validations/admin";
import { getDb } from "@/server/db/client";

const log = createLogger({ category: "api" });

export type AdminStatusResult = { ok: true } | { ok: false; code: "invalid" | "not_found" | "draft" };

/**
 * Approve, hide or send back to pending (plan §4.4). Never from DRAFT: only
 * the sender's Share leaves it, and the CHECK constraint would refuse a
 * non-DRAFT status with `consentedAt` null anyway. No side effects beyond the
 * ADMIN revision; nothing public reads APPROVED/HIDDEN yet and nothing emails.
 */
export async function setMemoryStatusAsAdmin(raw: unknown): Promise<AdminStatusResult> {
  const parsed = adminStatusSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const { memoryId, status } = parsed.data;
  const result = await getDb().$transaction(async (tx) => {
    await lockMemory(tx, memoryId);
    const fresh = await tx.memory.findUnique({ where: { id: memoryId }, select: { status: true, deletedAt: true, consentVersion: true } });
    if (!fresh || fresh.deletedAt !== null) {
      return "not_found" as const;
    }
    if (fresh.status === "DRAFT") {
      return "draft" as const;
    }
    if (fresh.status === status) {
      return "unchanged" as const;
    }
    await tx.memory.update({ where: { id: memoryId }, data: { status } });
    await appendRevision(tx, { memoryId, changedVia: "ADMIN", before: { status: fresh.status }, after: { status }, consentVersion: fresh.consentVersion });
    return "ok" as const;
  }, TX_OPTIONS);

  if (result === "not_found" || result === "draft") {
    return { ok: false, code: result };
  }
  if (result === "ok") {
    log.info({ action: "admin_status_set", memoryId, status }, "memory status changed from the admin page");
  }
  return { ok: true };
}
