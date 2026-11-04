import "server-only";

import { SendGridTransport } from "@/integrations/sendgrid";
import { createLogger, logError } from "@/lib/logger";
import { getAdminAlertEnv, getEmailEnv, getOutboundEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";

import { buildAdminNewMemory } from "./templates/admin-new-memory";
import { buildMemoryConfirmation } from "./templates/memory-confirmation";
import type { AdminNewMemoryContent, EmailAttachment, EmailTransport, MemoryConfirmationInput, SendResult } from "./types";

export type {
  AdminNewMemoryContent,
  EmailAttachment,
  EmailTransport,
  MediaKind,
  MemoryConfirmationContent,
  MemoryConfirmationInput,
  MemoryMediaSummary,
  MemoryVisibility,
  OutboundEmail,
  SendResult,
  SkipReason,
} from "./types";
export { ADMIN_TIME_ZONE, adminNewMemorySubject, buildAdminNewMemory } from "./templates/admin-new-memory";
export { buildMemoryConfirmation, MEMORY_CONFIRMATION_SUBJECT } from "./templates/memory-confirmation";

const log = createLogger({ category: "email" });

type EmailType = "MEMORY_CONFIRMATION" | "ADMIN_NEW_MEMORY";

/** Contributor confirmations only: a contributor address gets at most this many in a rolling day. Admin alerts are exempt (ruling R4). */
const RECIPIENT_DAILY_CAP = 3;
const CAPPED_EMAIL_TYPE: EmailType = "MEMORY_CONFIRMATION";
const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_STEP_MS = 15 * 60 * 1000;
/** Statuses a new send may claim from; a SENDING row is reclaimed only once its claim is stale. */
const CLAIMABLE = ["PENDING", "FAILED", "SKIPPED"] as const;
/** A SENDING row older than this was abandoned by a crashed or timed-out function. */
const STALE_CLAIM_MS = 15 * 60 * 1000;
/** Statuses that count against the per-recipient cap: delivered or in flight. FAILED and SKIPPED rows never reached the address, and counting FAILED would lock retries out. */
const COUNTED = ["SENDING", "SENT"] as const;

let transport: EmailTransport | undefined;
function getTransport(): EmailTransport {
  transport ??= new SendGridTransport();
  return transport;
}

function outboundAllowed(recipient: string): boolean {
  const env = getOutboundEnv();
  return env.OUTBOUND_ENABLED || env.OUTBOUND_ALLOWLIST.includes(recipient);
}

interface Rendered {
  subject: string;
  text: string;
  html: string;
  attachments: EmailAttachment[];
}

interface Delivery {
  memoryId: string;
  emailType: EmailType;
  /** Lower-cased, deduplicated. Several recipients means one message they all see. */
  recipients: string[];
  /** Already rendered: a template error must surface before any row is claimed, never strand a SENDING row. */
  rendered: Rendered;
  /** Apply the per-recipient daily cap (contributor confirmations only). */
  enforceCap: boolean;
  /** Cron path of the confirmation: write this claim hash together with SENT in one transaction. */
  rotateToClaimTokenHash?: string;
  /** For log lines and Sentry messages. */
  label: string;
}

/**
 * Deliver one email of one type for one memory. Shared by the contributor
 * confirmation and the admin alert.
 *
 * - Idempotent through the `(memoryId, emailType)` unique key and an atomic
 *   claim (`PENDING|FAILED|SKIPPED → SENDING`): two concurrent callers
 *   produce one email; a SENT row is never sent again.
 * - Skips (outbound guard, per-recipient cap) leave a terminal SKIPPED row
 *   with the reason, so the reconcile cron does not pick the memory up again
 *   and again; a later request-path call may still claim it.
 * - Failures leave a FAILED row with `attempts` and `nextAttemptAt` for the cron.
 * - The row's `recipientEmail` is the set actually attempted (after the
 *   outbound guard), joined with ", " when there are several. SENT means
 *   SendGrid accepted the message for that set, not per-recipient delivery.
 * - Guarantee: one row prevents concurrent sends. A crash between SendGrid's
 *   202 and the SENT write leaves a SENDING row that is reclaimed after
 *   15 minutes, so a duplicate is possible in that window (accepted, R5).
 */
async function deliver(delivery: Delivery): Promise<SendResult> {
  const db = getDb();
  const { memoryId, emailType, label } = delivery;
  const key = { memoryId_emailType: { memoryId, emailType } };

  const existing = await db.emailLog.findUnique({ where: key });
  if (existing?.status === "SENT") {
    return { sent: false, skipped: "already_sent" };
  }

  const allowed = delivery.recipients.filter(outboundAllowed);
  const recipientField = (allowed.length > 0 ? allowed : delivery.recipients).join(", ");

  const skip = async (reason: "outbound_disabled" | "recipient_capped"): Promise<SendResult> => {
    // Create the terminal row if there is none; otherwise only move rows that
    // nobody is sending (never SENDING or SENT, which a concurrent caller may
    // have reached since `existing` was read).
    if (!existing) {
      await createOrLoad(memoryId, emailType, recipientField);
    }
    await db.emailLog.updateMany({
      where: { memoryId, emailType, status: { in: ["PENDING", "FAILED", "SKIPPED"] } },
      data: { status: "SKIPPED", errorMessage: reason },
    });
    log.info({ action: "skip", memoryId, emailType, reason }, `${label} skipped`);
    return { sent: false, skipped: reason };
  };

  if (allowed.length === 0) {
    return skip("outbound_disabled");
  }
  if (allowed.length < delivery.recipients.length) {
    log.info({ action: "recipients_dropped", memoryId, emailType, dropped: delivery.recipients.length - allowed.length }, `${label}: outbound guard dropped recipients`);
  }
  if (delivery.enforceCap) {
    // Counted by the last state change (the send), not the row's creation: a
    // row created days ago and sent today still counts for today. Only rows
    // of the capped type count, so an admin who also contributes is never
    // capped by their own alerts.
    const recentToRecipient = await db.emailLog.count({
      where: {
        recipientEmail: recipientField,
        emailType: CAPPED_EMAIL_TYPE,
        updatedAt: { gte: new Date(Date.now() - DAY_MS) },
        status: { in: [...COUNTED] },
        NOT: { memoryId },
      },
    });
    if (recentToRecipient >= RECIPIENT_DAILY_CAP) {
      return skip("recipient_capped");
    }
  }

  // Create the row only when there is none: an upsert with an empty update
  // could still touch `updatedAt`, which the stale-claim rule below relies on.
  const row = existing ?? (await createOrLoad(memoryId, emailType, recipientField));
  const claimed = await db.emailLog.updateMany({
    where: {
      id: row.id,
      OR: [{ status: { in: [...CLAIMABLE] } }, { status: "SENDING", updatedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } }],
    },
    data: { status: "SENDING", recipientEmail: recipientField },
  });
  if (claimed.count === 0) {
    return { sent: false, skipped: "in_progress" };
  }

  let messageId: string | undefined;
  try {
    ({ messageId } = await getTransport().send({
      to: allowed,
      from: getEmailEnv().SENDGRID_FROM_EMAIL,
      ...delivery.rendered,
    }));
  } catch (error) {
    const attempts = row.attempts + 1;
    const message = error instanceof Error ? error.message : String(error);
    await db.emailLog.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        attempts,
        nextAttemptAt: new Date(Date.now() + RETRY_STEP_MS * attempts),
        errorMessage: message.slice(0, 1000),
      },
    });
    logError(`${label} failed`, error, { category: "email", memoryId, emailType, attempts });
    return { sent: false, skipped: "failed", error: message };
  }

  // The email is out. Record SENT (and the rotated claim hash, atomically);
  // retry the bookkeeping a few times before leaving the row SENDING, which
  // the stale-claim rule would otherwise re-send after 15 minutes.
  const sentData = { status: "SENT" as const, sentAt: new Date(), sendgridMessageId: messageId ?? null, errorMessage: null };
  let recorded = false;
  for (let attempt = 1; attempt <= 3 && !recorded; attempt += 1) {
    try {
      if (delivery.rotateToClaimTokenHash) {
        await db.$transaction([
          db.emailLog.update({ where: { id: row.id }, data: sentData }),
          db.memory.update({ where: { id: memoryId }, data: { claimTokenHash: delivery.rotateToClaimTokenHash } }),
        ]);
      } else {
        await db.emailLog.update({ where: { id: row.id }, data: sentData });
      }
      recorded = true;
    } catch (error) {
      if (attempt === 3) {
        logError(`${label} sent but could not be recorded as SENT`, error, { category: "email", memoryId, emailType });
      } else {
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
      }
    }
  }
  log.info({ action: "sent", memoryId, emailType, recorded }, `${label} sent`);
  return { sent: true, messageId };
}

/** Send the one confirmation email for a memory to its contributor (capped at three per address per day). */
export async function sendMemoryConfirmation(input: MemoryConfirmationInput): Promise<SendResult> {
  return deliver({
    memoryId: input.memoryId,
    emailType: "MEMORY_CONFIRMATION",
    recipients: [input.to.trim().toLowerCase()],
    rendered: buildMemoryConfirmation(input),
    enforceCap: true,
    rotateToClaimTokenHash: input.rotateToClaimTokenHash,
    label: "confirmation",
  });
}

/**
 * Send the one "new memory" alert for a memory to the family admins in
 * `ADMIN_ALERT_EMAILS`: one message they all see, no daily cap, no links.
 * An empty list writes no row and returns `no_recipients`, so the reconcile
 * cron alerts the memory once the list is configured (ruling R7).
 */
export async function sendAdminNewMemory(content: AdminNewMemoryContent): Promise<SendResult> {
  const recipients = [...new Set(getAdminAlertEnv().ADMIN_ALERT_EMAILS)];
  if (recipients.length === 0) {
    log.info({ action: "skip", memoryId: content.memoryId, emailType: "ADMIN_NEW_MEMORY", reason: "no_recipients" }, "admin alert skipped: ADMIN_ALERT_EMAILS is empty");
    return { sent: false, skipped: "no_recipients" };
  }
  return deliver({
    memoryId: content.memoryId,
    emailType: "ADMIN_NEW_MEMORY",
    recipients,
    rendered: buildAdminNewMemory(content),
    enforceCap: false,
    label: "admin alert",
  });
}

/** The row for this memory and type, creating it when absent; a concurrent creator's row is loaded instead. */
async function createOrLoad(memoryId: string, emailType: EmailType, recipientEmail: string) {
  const db = getDb();
  try {
    return await db.emailLog.create({
      data: { memoryId, recipientEmail, emailType, status: "PENDING" },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002") {
      const row = await db.emailLog.findUnique({ where: { memoryId_emailType: { memoryId, emailType } } });
      if (row) {
        return row;
      }
    }
    throw error;
  }
}
