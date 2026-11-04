import "server-only";

import type { Prisma } from "@/generated/prisma/client";

/**
 * Which memories the site itself emails (docs/plans/2026-11-03-draft-memory-on-behalf.md §3.5).
 *
 * A memory drafted by the family admin on a sender's behalf never gets the
 * site's confirmation, before or after the person presses Share: the admin's
 * own reply is the only message they hear, the confirmation's wording ("stored
 * exactly as you sent it") would be false for an excerpt, and the cron's token
 * rotation would kill the link the admin sent by hand. Only confirmations are
 * suppressed; a future "your story is posted" notice honours `notifyWhenPosted`.
 *
 * The admin alert is skipped only while the memory is a DRAFT (the admin made
 * it); once shared it is a new memory like any other.
 */
export function siteEmailsConfirmation(memory: { status: string; source: string }): boolean {
  return memory.status !== "DRAFT" && memory.source === "WEB_UPLOAD";
}

/** Prisma `where` fragment equivalent to `siteEmailsConfirmation`, for the cron's catch-up query. */
export const SITE_EMAIL_WHERE = { status: { not: "DRAFT" }, source: "WEB_UPLOAD" } as const satisfies Prisma.MemoryWhereInput;

export function siteAlertsAdmins(memory: { status: string }): boolean {
  return memory.status !== "DRAFT";
}

/** Prisma `where` fragment equivalent to `siteAlertsAdmins`. */
export const ADMIN_ALERT_WHERE = { status: { not: "DRAFT" } } as const satisfies Prisma.MemoryWhereInput;
