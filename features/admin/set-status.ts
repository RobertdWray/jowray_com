import "server-only";

import { REVIEW_FACTS_SELECT, reviewVersionOf } from "@/features/admin/review-version";
import { TX_OPTIONS } from "@/features/memories/create-memory";
import { lockMemory } from "@/features/memories/lock";
import { appendRevision } from "@/features/memories/media-state";
import { createLogger } from "@/lib/logger";
import { adminStatusSchema } from "@/lib/validations/admin";
import { getDb } from "@/server/db/client";

const log = createLogger({ category: "api" });

export type AdminStatusResult = { ok: true } | { ok: false; code: "invalid" | "not_found" | "draft" | "stale" };

/**
 * Approve, hide or send back to pending (plan §4.4). Never from DRAFT: only
 * the sender's Share or share_draft leaves it, and the CHECK constraint would
 * refuse a non-DRAFT status with `consentedAt` null anyway. Writes one ADMIN
 * revision and sends no email. See memories reads APPROVED + PUBLIC (Everyone),
 * not deleted, once the family turns on PUBLIC_MEMORIES_ENABLED (D1, D15).
 *
 * Approving publishes, so it carries the `reviewVersion` the approver read
 * (TCR round 1, B1-3): recomputed under the memory lock, a mismatch (the
 * memory, its contributor or a file changed since) answers `stale` and writes
 * nothing, and the approver reads it again. Pending and Hide never need it.
 */
export async function setMemoryStatusAsAdmin(raw: unknown): Promise<AdminStatusResult> {
  const parsed = adminStatusSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const { memoryId, status, reviewVersion } = parsed.data;
  const result = await getDb().$transaction(async (tx) => {
    await lockMemory(tx, memoryId);
    const fresh = await tx.memory.findUnique({ where: { id: memoryId }, select: { status: true, deletedAt: true, consentVersion: true, ...REVIEW_FACTS_SELECT } });
    if (!fresh || fresh.deletedAt !== null) {
      return "not_found" as const;
    }
    if (fresh.status === "DRAFT") {
      return "draft" as const;
    }
    if (fresh.status === status) {
      return "unchanged" as const;
    }
    if (status === "APPROVED" && reviewVersionOf(fresh) !== reviewVersion) {
      return "stale" as const;
    }
    await tx.memory.update({ where: { id: memoryId }, data: { status } });
    await appendRevision(tx, { memoryId, changedVia: "ADMIN", before: { status: fresh.status }, after: { status }, consentVersion: fresh.consentVersion });
    return "ok" as const;
  }, TX_OPTIONS);

  if (result === "not_found" || result === "draft" || result === "stale") {
    if (result === "stale") {
      log.info({ action: "admin_status_stale", memoryId }, "approval refused: the memory changed since it was read");
    }
    return { ok: false, code: result };
  }
  if (result === "ok") {
    log.info({ action: "admin_status_set", memoryId, status }, "memory status changed from the admin page");
  }
  return { ok: true };
}
