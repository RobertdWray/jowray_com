import "server-only";

import { summarizeReadyMedia } from "@/features/memories/media-summary";
import { getDb } from "@/server/db/client";
import { sendAdminNewMemory, type SendResult } from "@/services/email";

/**
 * Activation boundary for the cron backfill (ruling R6): memories created
 * before this instant existed before the alert and are never announced as
 * new. Set just before the feature merged (after the last pre-feature test
 * memory); the request path needs no cutoff.
 */
export const ADMIN_ALERT_SINCE = new Date("2026-11-03T22:00:00Z");

export type NotifyAdminsResult = SendResult | { sent: false; skipped: "not_found" | "deleted" | "not_ready" };

/**
 * Send the one "new memory" alert to the family admins, if there is
 * something to show (a READY file, or words, or a TEXT memory): the same
 * readiness rule as `confirmMemory`, but with no contributor address
 * required. Idempotency, the outbound guard and the recipient list live in
 * the email service.
 *
 * This never reads or mints the claim token: the alert carries no link by
 * ruling (R2), so the admins are told, not handed the edit capability.
 */
export async function notifyAdminsOfMemory({ memoryId }: { memoryId: string }): Promise<NotifyAdminsResult> {
  const db = getDb();
  const memory = await db.memory.findUnique({
    where: { id: memoryId },
    include: {
      contributor: { select: { name: true, email: true, relationship: true, contactOptIn: true, mailingListOptIn: true } },
      media: {
        where: { deletedAt: null },
        select: { id: true, status: true, mimeType: true, originalFilename: true, durationSeconds: true },
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
  const media = summarizeReadyMedia(memory.media);
  const hasWords = (memory.contributorNote ?? "").trim().length > 0;
  if (memory.type !== "TEXT" && media.length === 0 && !hasWords) {
    return { sent: false, skipped: "not_ready" };
  }

  return sendAdminNewMemory({
    memoryId,
    submittedAt: memory.createdAt,
    name: memory.contributor?.name ?? null,
    relationship: memory.contributor?.relationship ?? null,
    email: memory.contributor?.email ?? null,
    contactOptIn: memory.contributor?.contactOptIn ?? false,
    mailingListOptIn: memory.contributor?.mailingListOptIn ?? false,
    notifyWhenPosted: memory.notifyWhenPosted,
    approxDateText: memory.approxDateText,
    place: memory.place,
    note: memory.contributorNote,
    visibility: memory.visibility,
    media,
    filesNotReady: memory.media.length - media.length,
  });
}
