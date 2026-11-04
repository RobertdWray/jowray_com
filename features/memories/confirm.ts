import "server-only";

import { lockMemory } from "@/features/memories/lock";
import { hashClaimToken, newClaimToken } from "@/lib/claim-token";
import { createLogger } from "@/lib/logger";
import { getSiteUrl } from "@/lib/site-url";
import { TICKET_TTL_MS } from "@/lib/upload-ticket";
import { getDb } from "@/server/db/client";
import { type MediaKind, type MemoryMediaSummary, sendMemoryConfirmation, type SendResult } from "@/services/email";

const log = createLogger({ category: "email" });

export type ConfirmResult = SendResult | { sent: false; skipped: "not_found" | "deleted" | "no_email" | "not_ready" | "leased" };
/** Neon computes can take a couple of seconds to wake; Prisma's defaults (2 s / 5 s) are too tight. */
const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

function kindOf(mimeType: string): MediaKind {
  if (mimeType.startsWith("image/")) {
    return "PHOTO";
  }
  if (mimeType.startsWith("audio/")) {
    return "VOICE";
  }
  return "VIDEO";
}

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
  const ready = memory.media.filter((m) => m.status === "READY");
  const hasWords = (memory.contributorNote ?? "").trim().length > 0;
  // Something to confirm: a file that arrived, or words (a TEXT memory, or a
  // memory whose file failed but whose note was saved).
  if (memory.type !== "TEXT" && ready.length === 0 && !hasWords) {
    return { sent: false, skipped: "not_ready" };
  }
  // The one email should list the whole submission: wait while a file ticketed
  // less than a ticket-lifetime ago may still arrive, unless the contributor
  // closed the submission (completeSubmission) or the reservation is older.
  const inFlight = memory.media.some((m) => m.status === "PENDING" && m.createdAt.getTime() > Date.now() - TICKET_TTL_MS);
  if (inFlight && !settleNow) {
    return { sent: false, skipped: "not_ready" };
  }

  const media: MemoryMediaSummary[] = ready.map((m) => ({
    kind: kindOf(m.mimeType),
    originalFilename: m.originalFilename,
    durationSeconds: m.durationSeconds,
    preview: null,
  }));

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
 * close the submission lease and send the one confirmation with whatever is
 * READY, using the raw token so the on-screen link stays valid.
 */
export async function completeSubmission({ claimToken }: { claimToken: string }): Promise<ConfirmResult> {
  if (typeof claimToken !== "string" || claimToken.length < 16 || claimToken.length > 128) {
    return { sent: false, skipped: "not_found" };
  }
  const claimTokenHash = hashClaimToken(claimToken);
  const db = getDb();
  const memoryId = await db.$transaction(async (tx) => {
    const memory = await tx.memory.findUnique({ where: { claimTokenHash }, select: { id: true, deletedAt: true, claimTokenHash: true } });
    if (!memory || memory.deletedAt !== null || memory.claimTokenHash !== claimTokenHash) {
      return null;
    }
    await lockMemory(tx, memory.id);
    await tx.memory.update({ where: { id: memory.id }, data: { uploadLeaseUntil: null } });
    return memory.id;
  }, TX_OPTIONS);
  if (memoryId === null) {
    return { sent: false, skipped: "not_found" };
  }
  log.info({ action: "submission_completed", memoryId }, "submission closed by the contributor");
  return confirmMemory({ memoryId, claimToken, settleNow: true });
}
