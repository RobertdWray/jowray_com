import "server-only";

import { hashClaimToken, newClaimToken } from "@/lib/claim-token";
import { consentTextFor } from "@/lib/consent";
import { createLogger } from "@/lib/logger";
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
 * the old one in the same transaction that records SENT. An emailed link
 * therefore supersedes the on-screen one (ledger ruling), and a skipped or
 * failed send changes nothing.
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
  // Cron path: the service writes the new hash together with SENT in one
  // transaction, so a skipped or failed send changes nothing and a delivered
  // email never points at an unsaved hash.
  const result = await sendMemoryConfirmation({
    memoryId,
    to: email,
    name: memory.contributor?.name ?? null,
    received: { type: memory.type, fileCount: readyCount },
    claimLink: `${getSiteUrl()}/m/${token}`,
    usageSentence: consentTextFor(CONSENT_VERSION).usage,
    ...(rotating && { rotateToClaimTokenHash: hashClaimToken(token) }),
  });
  if (rotating && result.sent) {
    log.info({ action: "token_rotated", memoryId }, "claim token rotated for an emailed link");
  }
  return result;
}
