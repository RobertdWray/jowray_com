import "server-only";

import { mediaKindOf, submissionInFlight } from "@/features/memories/media-summary";
import { siteEmailsConfirmation } from "@/features/memories/site-email";
import { hashClaimToken, newClaimToken } from "@/lib/claim-token";
import { createLogger } from "@/lib/logger";
import { getSiteUrl } from "@/lib/site-url";
import { getDb } from "@/server/db/client";
import { sendMemoryConfirmation, type SendResult } from "@/services/email";

const log = createLogger({ category: "email" });

export type ConfirmResult = SendResult | { sent: false; skipped: "not_found" | "deleted" | "no_site_email" | "no_email" | "not_ready" | "in_submission" | "leased" };

/**
 * Send the one confirmation email for a memory, if there is an address and
 * something READY to confirm (or the memory is TEXT). Memories the admin
 * drafted on someone's behalf are never confirmed by the site
 * (`siteEmailsConfirmation`, `no_site_email`); memories that belong to a send
 * are left to `confirmSubmission` (`in_submission`). Idempotency, the
 * outbound guard and the per-recipient cap live in the email service.
 *
 * The email is fixed content (issue #46, D1, 2026-11-05, replacing ruling R1):
 * the private link, what kinds of files arrived, and nothing the contributor
 * typed. Their words and details live on the page the link opens.
 *
 * The claim link needs the raw token, which is never stored. Request-time
 * callers (finalizeUpload) pass it in. The reconcile cron has
 * only the hash, so when `claimToken` is omitted the token is rotated: a
 * fresh one is minted, the email carries the new link, and its hash replaces
 * the old one in the same transaction that records SENT. An emailed link
 * therefore supersedes the on-screen one (ledger ruling), and a skipped or
 * failed send changes nothing.
 */
export async function confirmMemory({
  memoryId,
  claimToken,
  settleNow = false,
}: {
  memoryId: string;
  claimToken?: string;
  /** The submission is being closed by its contributor: send with what is READY now, whatever is still in flight. */
  settleNow?: boolean;
}): Promise<ConfirmResult> {
  const db = getDb();
  // Only what the decision and the fixed-content receipt need: no contributor-written text is selected (issue #46, review #5).
  const memory = await db.memory.findUnique({
    where: { id: memoryId },
    select: {
      id: true,
      deletedAt: true,
      status: true,
      source: true,
      submissionId: true,
      claimTokenHash: true,
      type: true,
      contributorNote: true,
      uploadLeaseUntil: true,
      contributor: { select: { email: true } },
      media: {
        where: { deletedAt: null },
        select: { id: true, status: true, mimeType: true, durationSeconds: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!memory) {
    return { sent: false, skipped: "not_found" };
  }
  if (memory.deletedAt !== null) {
    return { sent: false, skipped: "deleted" };
  }
  if (!siteEmailsConfirmation(memory)) {
    // Logged so a local walk-through can see the skip, not only the absence of an EmailLog row.
    log.info({ action: "confirmation_skipped", memoryId, reason: "no_site_email" }, "no site confirmation for an admin-drafted memory");
    return { sent: false, skipped: "no_site_email" };
  }
  // A memory sent with others gets one receipt for the whole send (Task 15,
  // `confirmSubmission`), never a per-memory email, the anchor included.
  if (memory.submissionId !== null) {
    return { sent: false, skipped: "in_submission" };
  }
  if (claimToken !== undefined && hashClaimToken(claimToken) !== memory.claimTokenHash) {
    return { sent: false, skipped: "not_found" };
  }
  const email = memory.contributor?.email;
  if (!email) {
    return { sent: false, skipped: "no_email" };
  }
  const media = memory.media.filter((row) => row.status === "READY").map((row) => ({ kind: mediaKindOf(row.mimeType), durationSeconds: row.durationSeconds }));
  const hasWords = (memory.contributorNote ?? "").trim().length > 0;
  // Something to confirm: a file that arrived, or words (a TEXT memory, or a
  // memory whose file failed but whose note was saved).
  if (memory.type !== "TEXT" && media.length === 0 && !hasWords) {
    return { sent: false, skipped: "not_ready" };
  }
  // The one email should list the whole submission; completeSubmission settles regardless.
  if (!settleNow && submissionInFlight(memory)) {
    return { sent: false, skipped: "not_ready" };
  }

  const rotating = claimToken === undefined;
  // The cron (no raw token) rotates the link; it must not do that while the
  // contributor is still sending files with the link they have.
  if (rotating && memory.uploadLeaseUntil !== null && memory.uploadLeaseUntil.getTime() > Date.now()) {
    return { sent: false, skipped: "leased" };
  }
  const token = claimToken ?? newClaimToken();

  // Cron path: the service writes the new hash together with SENT in one
  // transaction, so a skipped or failed send changes nothing and a delivered
  // email never points at an unsaved hash.
  const result = await sendMemoryConfirmation({
    memoryId,
    to: email,
    hasWords,
    media,
    claimLink: `${getSiteUrl()}/m/${token}`,
    ...(rotating && { rotateToClaimTokenHash: hashClaimToken(token) }),
  });
  if (rotating && result.sent) {
    log.info({ action: "token_rotated", memoryId }, "claim token rotated for an emailed link");
  }
  return result;
}
