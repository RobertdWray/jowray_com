import "server-only";

import { loadAdminPreviews, PREVIEW_COPIES, PREVIEW_READ_TIMEOUT_MS, waitForAdminPreviews } from "@/features/memories/admin-previews";
import { submissionInFlight, summarizeReadyMedia } from "@/features/memories/media-summary";
import { siteAlertsAdmins } from "@/features/memories/site-email";
import type { Prisma } from "@/generated/prisma/client";
import { createLogger } from "@/lib/logger";
import { getDb } from "@/server/db/client";
import { deliveryClosed, type MediaPreview, sendAdminNewMemory, type SendResult } from "@/services/email";

const log = createLogger({ category: "email" });

/**
 * Activation boundary for the cron backfill (ruling R6): memories created
 * before this instant existed before the alert and are never announced as
 * new. Set just before the feature merged (after the last pre-feature test
 * memory); the request path needs no cutoff.
 */
export const ADMIN_ALERT_SINCE = new Date("2026-11-03T22:00:00Z");

type AlertSkip = "not_found" | "deleted" | "draft" | "not_ready";
export type NotifyAdminsResult = SendResult | { sent: false; skipped: AlertSkip };

/** What the alert shows: the contributor's details and the live files, oldest first, each with the copies that can picture it. */
const ALERT_INCLUDE = {
  contributor: { select: { name: true, email: true, relationship: true, contactOptIn: true, mailingListOptIn: true } },
  media: {
    where: { deletedAt: null },
    select: { id: true, status: true, mimeType: true, originalFilename: true, durationSeconds: true, createdAt: true, derivatives: PREVIEW_COPIES },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.MemoryInclude;

type AlertMemory = Prisma.MemoryGetPayload<{ include: typeof ALERT_INCLUDE }>;

async function loadMemory(memoryId: string): Promise<AlertMemory | null> {
  return getDb().memory.findUnique({ where: { id: memoryId }, include: ALERT_INCLUDE });
}

/**
 * Is there something to show (a READY file, or words, or a TEXT memory), and has the submission stopped sending? The
 * same rule as `confirmMemory`, with no contributor address required, and never for a DRAFT the admin made themselves.
 */
function readiness(memory: AlertMemory | null, settleNow: boolean): { memory: AlertMemory } | { skipped: AlertSkip } {
  if (!memory) {
    return { skipped: "not_found" };
  }
  if (memory.deletedAt !== null) {
    return { skipped: "deleted" };
  }
  if (!siteAlertsAdmins(memory)) {
    return { skipped: "draft" };
  }
  const hasReadyFile = memory.media.some((file) => file.status === "READY");
  const hasWords = (memory.contributorNote ?? "").trim().length > 0;
  if (memory.type !== "TEXT" && !hasReadyFile && !hasWords) {
    return { skipped: "not_ready" };
  }
  // One alert for the whole submission: wait while files are still on their way (same rule as the confirmation).
  if (!settleNow && submissionInFlight(memory)) {
    return { skipped: "not_ready" };
  }
  return { memory };
}

/**
 * The previews, read before `readUntil` (epoch ms). A send of several memories shares one such deadline (R18), so a
 * memory reached after it reads nothing: that is logged and the alert goes without pictures. The deadline is a timer
 * of our own, cleared as soon as the reads finish (as `deriveMedia` does), rather than `AbortSignal.timeout`.
 */
async function loadPreviewsBy(memoryId: string, media: AlertMemory["media"], readUntil: number, waited: boolean): Promise<Map<string, MediaPreview>> {
  const budgetMs = readUntil - Date.now();
  if (budgetMs <= 0) {
    log.info({ action: "admin_alert_previews_skipped", memoryId, reason: "read_budget_spent", waited }, "admin alert sent without previews: the read budget is spent");
    return new Map();
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("the admin alert's preview read budget is spent", "TimeoutError")), budgetMs);
  try {
    const previews = await loadAdminPreviews(media, controller.signal);
    log.info({ action: "admin_alert_previews", memoryId, previews: previews.size, waited }, "admin alert previews loaded");
    return previews;
  } finally {
    clearTimeout(timer);
  }
}

/** Advisory, outside the outbound lock: the alert already went, is going, or never will, so no picture would be used. */
async function alertClosed(memoryId: string): Promise<boolean> {
  const row = await getDb().emailLog.findUnique({
    where: { memoryId_emailType: { memoryId, emailType: "ADMIN_NEW_MEMORY" } },
    select: { status: true, updatedAt: true, errorMessage: true },
  });
  return row !== null && deliveryClosed(row);
}

/**
 * Send the one "new memory" alert to the family admins, if the memory is
 * ready (`readiness`). Not for a DRAFT the admin made themselves
 * (`siteAlertsAdmins`); the alert goes when the person shares it.
 * Idempotency, the outbound guard and the recipient list live in the email
 * service.
 *
 * Its pictures (video posters plan T14, D8): each photo's THUMBNAIL and each
 * video's POSTER, at most four, that the producers have published. With
 * `previewsUntil` (the request paths, after the response) it first waits for
 * the copies still being made, then re-reads the memory and checks it again;
 * without it (the cron) it loads what is there. The reads stop at
 * `previewsReadUntil` (a send's shared budget, R18), or else
 * `PREVIEW_READ_TIMEOUT_MS` after they start. An alert the EmailLog shows
 * as already sent, being sent or terminally skipped skips both: the email
 * service answers it as before.
 *
 * This never reads or mints the claim token: the alert carries no link by
 * ruling (R2), so the admins are told, not handed the edit capability.
 */
export async function notifyAdminsOfMemory({
  memoryId,
  settleNow = false,
  previewsUntil,
  previewsReadUntil,
}: {
  memoryId: string;
  /** The contributor closed the submission: alert with what is READY now, whatever is still in flight. */
  settleNow?: boolean;
  /** Epoch ms: wait for missing previews until then (never past it). Omitted, nothing waits. */
  previewsUntil?: number;
  /** Epoch ms: every preview read stops then; a memory reached later goes without previews. Omitted, the reads get `PREVIEW_READ_TIMEOUT_MS`. */
  previewsReadUntil?: number;
}): Promise<NotifyAdminsResult> {
  let ready = readiness(await loadMemory(memoryId), settleNow);
  if ("skipped" in ready) {
    return { sent: false, skipped: ready.skipped };
  }
  let previews = new Map<string, MediaPreview>();
  if (!(await alertClosed(memoryId))) {
    const waited = previewsUntil !== undefined && previewsUntil > Date.now();
    if (waited) {
      await waitForAdminPreviews({ memoryId, until: previewsUntil });
      // The memory may have changed while the copies were awaited: re-read it, with them, and check it again.
      ready = readiness(await loadMemory(memoryId), settleNow);
      if ("skipped" in ready) {
        return { sent: false, skipped: ready.skipped };
      }
    }
    previews = await loadPreviewsBy(memoryId, ready.memory.media, previewsReadUntil ?? Date.now() + PREVIEW_READ_TIMEOUT_MS, waited);
  }

  const { memory } = ready;
  const media = summarizeReadyMedia(memory.media, previews);
  return sendAdminNewMemory({
    memoryId,
    // A drafted memory becomes the person's when they press Share; that is the moment the admins should see.
    submittedAt: memory.consentedAt ?? memory.createdAt,
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
