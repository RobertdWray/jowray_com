import "server-only";

import { SendGridTransport } from "@/integrations/sendgrid";
import { createLogger, logError } from "@/lib/logger";
import { getEmailEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";

import { buildMemoryConfirmation } from "./templates/memory-confirmation";
import type { EmailTransport, MemoryConfirmationInput, SendResult } from "./types";

export type { EmailTransport, MemoryConfirmationInput, OutboundEmail, ReceivedType, SendResult, SkipReason } from "./types";
export { buildMemoryConfirmation, MEMORY_CONFIRMATION_SUBJECT } from "./templates/memory-confirmation";

const log = createLogger({ category: "email" });

const EMAIL_TYPE = "MEMORY_CONFIRMATION" as const;
const RECIPIENT_DAILY_CAP = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_STEP_MS = 15 * 60 * 1000;

let transport: EmailTransport | undefined;
function getTransport(): EmailTransport {
  transport ??= new SendGridTransport();
  return transport;
}

function outboundAllowed(recipient: string): boolean {
  const env = getEmailEnv();
  return env.OUTBOUND_ENABLED || env.OUTBOUND_ALLOWLIST.includes(recipient);
}

/**
 * Send the one confirmation email for a memory. Idempotent through the
 * `(memoryId, emailType)` unique key: a memory whose row is SENT is never
 * emailed twice. Respects the outbound guard and the per-recipient cap.
 * Failures leave a FAILED row with `nextAttemptAt` for the reconcile cron.
 */
export async function sendMemoryConfirmation(input: MemoryConfirmationInput): Promise<SendResult> {
  const recipient = input.to.trim().toLowerCase();
  if (!outboundAllowed(recipient)) {
    log.info({ action: "skip", memoryId: input.memoryId, reason: "outbound_disabled" }, "confirmation skipped");
    return { sent: false, skipped: "outbound_disabled" };
  }

  const db = getDb();
  const key = { memoryId_emailType: { memoryId: input.memoryId, emailType: EMAIL_TYPE } };
  const existing = await db.emailLog.findUnique({ where: key });
  if (existing?.status === "SENT") {
    return { sent: false, skipped: "already_sent" };
  }

  const recentToRecipient = await db.emailLog.count({
    where: {
      recipientEmail: recipient,
      createdAt: { gte: new Date(Date.now() - DAY_MS) },
      NOT: { memoryId: input.memoryId },
    },
  });
  if (recentToRecipient >= RECIPIENT_DAILY_CAP) {
    log.warn({ action: "skip", memoryId: input.memoryId, reason: "recipient_capped" }, "confirmation skipped");
    return { sent: false, skipped: "recipient_capped" };
  }

  const row = await db.emailLog.upsert({
    where: key,
    create: { memoryId: input.memoryId, recipientEmail: recipient, emailType: EMAIL_TYPE, status: "PENDING" },
    update: {},
  });

  const rendered = buildMemoryConfirmation(input);
  try {
    const { messageId } = await getTransport().send({
      to: recipient,
      from: getEmailEnv().SENDGRID_FROM_EMAIL,
      ...rendered,
    });
    await db.emailLog.update({
      where: { id: row.id },
      data: { status: "SENT", sentAt: new Date(), sendgridMessageId: messageId ?? null, errorMessage: null },
    });
    log.info({ action: "sent", memoryId: input.memoryId }, "confirmation sent");
    return { sent: true, messageId };
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
    logError("confirmation email failed", error, { category: "email", memoryId: input.memoryId, attempts });
    return { sent: false, skipped: "failed", error: message };
  }
}
