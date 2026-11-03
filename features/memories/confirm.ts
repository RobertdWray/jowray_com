import "server-only";

import { hashClaimToken, newClaimToken } from "@/lib/claim-token";
import { consentTextFor } from "@/lib/consent";
import { createLogger, logError } from "@/lib/logger";
import { getSiteUrl } from "@/lib/site-url";
import { getMemorialEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { sendMemoryConfirmation, type SendResult } from "@/services/email";

const log = createLogger({ category: "email" });

export type ConfirmResult = SendResult | { sent: false; skipped: "not_found" | "deleted" | "no_email" | "not_ready" };

/**
 * Send the one confirmation email for a memory, if there is an address and
 * something READY to confirm (or the memory is TEXT). Idempotency, the
 * outbound guard and the per-recipient cap live in the email service.
 *
 * The claim link needs the raw token, which is never stored. Request-time
 * callers (createMemory, finalizeUpload) pass it in. The reconcile cron has
 * only the hash, so when `claimToken` is omitted the token is rotated: a
 * fresh one is minted, the email carries the new link, and its hash replaces
 * the old one only after the send succeeded. An emailed link therefore
 * supersedes the on-screen one, and a skipped or failed send changes nothing.
 */
export async function confirmMemory({ memoryId, claimToken }: { memoryId: string; claimToken?: string }): Promise<ConfirmResult> {
  const db = getDb();
  const memory = await db.memory.findUnique({
    where: { id: memoryId },
    include: { contributor: { select: { name: true, email: true } }, media: { select: { status: true } } },
  });
  if (!memory) {
    return { sent: false, skipped: "not_found" };
  }
  if (memory.deletedAt !== null) {
    return { sent: false, skipped: "deleted" };
  }
  if (claimToken !== undefined && hashClaimToken(claimToken) !== memory.claimTokenHash) {
    return { sent: false, skipped: "not_found" };
  }
  const email = memory.contributor?.email;
  if (!email) {
    return { sent: false, skipped: "no_email" };
  }
  const readyCount = memory.media.filter((m) => m.status === "READY").length;
  const hasWords = (memory.contributorNote ?? "").trim().length > 0;
  // Something to confirm: a file that arrived, or words (a TEXT memory, or a
  // memory whose file failed but whose note was saved).
  if (memory.type !== "TEXT" && readyCount === 0 && !hasWords) {
    return { sent: false, skipped: "not_ready" };
  }

  const rotating = claimToken === undefined;
  const token = claimToken ?? newClaimToken();

  const { CONSENT_VERSION } = getMemorialEnv();
  const result = await sendMemoryConfirmation({
    memoryId,
    to: email,
    name: memory.contributor?.name ?? null,
    received: { type: memory.type, fileCount: readyCount },
    claimLink: `${getSiteUrl()}/m/${token}`,
    usageSentence: consentTextFor(CONSENT_VERSION).usage,
  });

  // Cron path: the new token is persisted only once the email actually went
  // out, so a skipped or failed send never invalidates the link the
  // contributor already has on screen.
  if (rotating && result.sent) {
    try {
      await db.memory.update({ where: { id: memoryId }, data: { claimTokenHash: hashClaimToken(token) } });
      log.info({ action: "token_rotated", memoryId }, "claim token rotated for an emailed link");
    } catch (error) {
      // The email carries a token whose hash was not saved: put the row back
      // to FAILED so the cron sends a fresh link instead of leaving a dead one.
      await db.emailLog.updateMany({
        where: { memoryId, emailType: "MEMORY_CONFIRMATION", status: "SENT" },
        data: { status: "FAILED", attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000), errorMessage: "rotated claim token could not be persisted" },
      });
      logError("rotated claim token not persisted after send", error, { category: "email", memoryId });
      return { sent: false, skipped: "failed", error: "rotated claim token could not be persisted" };
    }
  }
  return result;
}
