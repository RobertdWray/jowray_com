import "server-only";

import { TX_OPTIONS } from "@/features/memories/create-memory";
import { lockMemory } from "@/features/memories/lock";
import { appendRevision } from "@/features/memories/media-state";
import { createLogger } from "@/lib/logger";
import { adminShareDraftSchema } from "@/lib/validations/admin";
import { getMemorialEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { suppressAdminAlertForDraftShare } from "@/services/email";

const log = createLogger({ category: "api" });

export type ShareDraftResult =
  | { ok: true; status: "PENDING" | "APPROVED"; memoryVersion: string }
  | { ok: false; code: "invalid" | "not_found" | "not_draft" }
  | { ok: false; code: "stale"; current: { memoryVersion: string; status: "DRAFT" } };

/**
 * Share a DRAFT on its sender's behalf (R4, R7). Only Rob's explicit word that
 * the named sender agreed justifies a call. APPROVED publishes nothing public
 * yet (R4a). Record the sender's consent stamp and an ADMIN revision (R6),
 * preserving every preference and the claim link (D8). The status, stamp and
 * permanent admin-alert suppression commit together (R5, D11) in this one
 * transaction; helpers use its client and never open another (D12).
 */
export async function shareDraftAsAdmin(raw: unknown): Promise<ShareDraftResult> {
  const parsed = adminShareDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const { memoryId, memoryVersion, status } = parsed.data;
  const result = await getDb().$transaction(async (tx): Promise<ShareDraftResult> => {
    await lockMemory(tx, memoryId);
    const fresh = await tx.memory.findUnique({ where: { id: memoryId }, select: { status: true, deletedAt: true, updatedAt: true, consentVersion: true } });
    if (!fresh || fresh.deletedAt !== null) {
      return { ok: false, code: "not_found" };
    }
    // A sender's Share also changes updatedAt: not_draft is the truer refusal.
    if (fresh.status !== "DRAFT") {
      return { ok: false, code: "not_draft" };
    }
    const current = { memoryVersion: fresh.updatedAt.toISOString(), status: fresh.status };
    if (current.memoryVersion !== memoryVersion) {
      return { ok: false, code: "stale", current };
    }
    const consentedAt = new Date();
    const consentVersion = getMemorialEnv().CONSENT_VERSION;
    const updated = await tx.memory.update({ where: { id: memoryId }, data: { status, consentedAt, consentVersion }, select: { updatedAt: true } });
    await appendRevision(tx, { memoryId, changedVia: "ADMIN", before: { status: "DRAFT", consentedAt: null }, after: { status, consentedAt: consentedAt.toISOString() }, consentVersion });
    await suppressAdminAlertForDraftShare(tx, memoryId);
    return { ok: true, status, memoryVersion: updated.updatedAt.toISOString() };
  }, TX_OPTIONS);

  if (result.ok) {
    log.info({ action: "admin_draft_shared", memoryId, status }, "draft shared on the sender's behalf");
  }
  return result;
}
