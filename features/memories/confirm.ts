import "server-only";

import { lockMemory } from "@/features/memories/lock";
import { submissionInFlight, summarizeReadyMedia } from "@/features/memories/media-summary";
import { notifyAdminsOfMemory } from "@/features/memories/notify-admins";
import { hashClaimToken, newClaimToken } from "@/lib/claim-token";
import { createLogger, logErrorAndFlush } from "@/lib/logger";
import { afterWithFlush } from "@/lib/sentry/after-flush";
import { getSiteUrl } from "@/lib/site-url";
import { completeSubmissionSchema } from "@/lib/validations/media";
import { getDb } from "@/server/db/client";
import { sendMemoryConfirmation, type SendResult } from "@/services/email";

const log = createLogger({ category: "email" });

export type ConfirmResult = SendResult | { sent: false; skipped: "not_found" | "deleted" | "no_email" | "not_ready" | "leased" };
/** Neon computes can take a couple of seconds to wake; Prisma's defaults (2 s / 5 s) are too tight. */
const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/**
 * Send the one confirmation email for a memory, if there is an address and
 * something READY to confirm (or the memory is TEXT). Idempotency, the
 * outbound guard and the per-recipient cap live in the email service.
 *
 * The email echoes the contributor's words and details (ruling R1) and lists
 * every READY file in upload order.
 *
 * The claim link needs the raw token, which is never stored. Request-time
 * callers (createMemory, finalizeUpload) pass it in. The reconcile cron has
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
  const memory = await db.memory.findUnique({
    where: { id: memoryId },
    include: {
      contributor: { select: { name: true, email: true, relationship: true } },
      media: {
        where: { deletedAt: null },
        select: { id: true, status: true, mimeType: true, originalFilename: true, durationSeconds: true, createdAt: true },
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
  if (claimToken !== undefined && hashClaimToken(claimToken) !== memory.claimTokenHash) {
    return { sent: false, skipped: "not_found" };
  }
  const email = memory.contributor?.email;
  if (!email) {
    return { sent: false, skipped: "no_email" };
  }
  const media = summarizeReadyMedia(memory.media);
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
    name: memory.contributor?.name ?? null,
    relationship: memory.contributor?.relationship ?? null,
    approxDateText: memory.approxDateText,
    place: memory.place,
    note: memory.contributorNote,
    media,
    claimLink: `${getSiteUrl()}/m/${token}`,
    ...(rotating && { rotateToClaimTokenHash: hashClaimToken(token) }),
  });
  if (rotating && result.sent) {
    log.info({ action: "token_rotated", memoryId }, "claim token rotated for an emailed link");
  }
  return result;
}

/**
 * The browser calls this when its batch of uploads has finished (or given up):
 * send the one confirmation with whatever is READY, using the raw token so the
 * on-screen link stays valid, then close the submission lease.
 *
 * Order matters: the lease is what keeps the cron's rotate-and-send away.
 * Sending first (settleNow ignores the lease on the request path) means the
 * email operation is already claimed in EmailLog when the lease closes, so the
 * cron can never slip into a gap, win the send, and rotate the link on screen.
 */
export async function completeSubmission(raw: unknown): Promise<ConfirmResult> {
  const parsed = completeSubmissionSchema.safeParse(raw);
  if (!parsed.success) {
    return { sent: false, skipped: "not_found" };
  }
  const { claimToken } = parsed.data;
  const claimTokenHash = hashClaimToken(claimToken);
  const db = getDb();
  const memory = await db.memory.findUnique({ where: { claimTokenHash }, select: { id: true, deletedAt: true } });
  if (!memory || memory.deletedAt !== null) {
    return { sent: false, skipped: "not_found" };
  }
  let result: ConfirmResult;
  try {
    result = await confirmMemory({ memoryId: memory.id, claimToken, settleNow: true });
  } finally {
    // Whatever happened to the send, the submission is over: the cron may reconcile from here.
    await db.$transaction(async (tx) => {
      await lockMemory(tx, memory.id);
      await tx.memory.update({ where: { id: memory.id }, data: { uploadLeaseUntil: null } });
    }, TX_OPTIONS);
  }
  log.info({ action: "submission_completed", memoryId: memory.id, sent: result.sent }, "submission closed by the contributor");
  // The family-admin alert for the whole submission runs after the response; on failure the cron (e2) retries it.
  afterWithFlush(async () => {
    try {
      await notifyAdminsOfMemory({ memoryId: memory.id, settleNow: true });
    } catch (error) {
      await logErrorAndFlush("admin alert failed after submission", error, { category: "email", memoryId: memory.id });
    }
  });
  return result;
}
