import "server-only";

import { SendGridTransport } from "@/integrations/sendgrid";
import { createLogger, logError } from "@/lib/logger";
import { getEmailEnv, getOutboundEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";

import { buildMemoryConfirmation } from "./templates/memory-confirmation";
import type { EmailTransport, MemoryConfirmationInput, SendResult } from "./types";

export type {
  EmailAttachment,
  EmailTransport,
  MediaKind,
  MemoryConfirmationContent,
  MemoryConfirmationInput,
  MemoryMediaSummary,
  OutboundEmail,
  SendResult,
  SkipReason,
} from "./types";
export { buildMemoryConfirmation, MEMORY_CONFIRMATION_SUBJECT } from "./templates/memory-confirmation";

const log = createLogger({ category: "email" });

const EMAIL_TYPE = "MEMORY_CONFIRMATION" as const;
const RECIPIENT_DAILY_CAP = 3;
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

/**
 * Send the one confirmation email for a memory.
 *
 * - Idempotent through the `(memoryId, emailType)` unique key and an atomic
 *   claim (`PENDING|FAILED|SKIPPED → SENDING`): two concurrent callers
 *   produce one email; a SENT row is never sent again.
 * - Skips (outbound guard, per-recipient cap) leave a terminal SKIPPED row
 *   with the reason, so the reconcile cron does not pick the memory up again
 *   and again; a later request-path call may still claim it.
 * - Failures leave a FAILED row with `attempts` and `nextAttemptAt` for the cron.
 */
export async function sendMemoryConfirmation(input: MemoryConfirmationInput): Promise<SendResult> {
  const db = getDb();
  const recipient = input.to.trim().toLowerCase();
  const key = { memoryId_emailType: { memoryId: input.memoryId, emailType: EMAIL_TYPE } };

  const existing = await db.emailLog.findUnique({ where: key });
  if (existing?.status === "SENT") {
    return { sent: false, skipped: "already_sent" };
  }

  const skip = async (reason: "outbound_disabled" | "recipient_capped"): Promise<SendResult> => {
    // Create the terminal row if there is none; otherwise only move rows that
    // nobody is sending (never SENDING or SENT, which a concurrent caller may
    // have reached since `existing` was read).
    if (!existing) {
      await createOrLoad(input.memoryId, recipient);
    }
    await db.emailLog.updateMany({
      where: { memoryId: input.memoryId, emailType: EMAIL_TYPE, status: { in: ["PENDING", "FAILED", "SKIPPED"] } },
      data: { status: "SKIPPED", errorMessage: reason },
    });
    log.info({ action: "skip", memoryId: input.memoryId, reason }, "confirmation skipped");
    return { sent: false, skipped: reason };
  };

  if (!outboundAllowed(recipient)) {
    return skip("outbound_disabled");
  }
  // Counted by the last state change (the send), not the row's creation: a
  // row created days ago and sent today still counts for today.
  const recentToRecipient = await db.emailLog.count({
    where: {
      recipientEmail: recipient,
      updatedAt: { gte: new Date(Date.now() - DAY_MS) },
      status: { in: [...COUNTED] },
      NOT: { memoryId: input.memoryId },
    },
  });
  if (recentToRecipient >= RECIPIENT_DAILY_CAP) {
    return skip("recipient_capped");
  }

  // Create the row only when there is none: an upsert with an empty update
  // could still touch `updatedAt`, which the stale-claim rule below relies on.
  const row = existing ?? (await createOrLoad(input.memoryId, recipient));
  const claimed = await db.emailLog.updateMany({
    where: {
      id: row.id,
      OR: [{ status: { in: [...CLAIMABLE] } }, { status: "SENDING", updatedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } }],
    },
    data: { status: "SENDING" },
  });
  if (claimed.count === 0) {
    return { sent: false, skipped: "in_progress" };
  }

  const rendered = buildMemoryConfirmation(input);
  let messageId: string | undefined;
  try {
    ({ messageId } = await getTransport().send({
      to: recipient,
      from: getEmailEnv().SENDGRID_FROM_EMAIL,
      ...rendered,
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
    logError("confirmation email failed", error, { category: "email", memoryId: input.memoryId, attempts });
    return { sent: false, skipped: "failed", error: message };
  }

  // The email is out. Record SENT (and the rotated claim hash, atomically);
  // retry the bookkeeping a few times before leaving the row SENDING, which
  // the stale-claim rule would otherwise re-send after 15 minutes.
  const sentData = { status: "SENT" as const, sentAt: new Date(), sendgridMessageId: messageId ?? null, errorMessage: null };
  let recorded = false;
  for (let attempt = 1; attempt <= 3 && !recorded; attempt += 1) {
    try {
      if (input.rotateToClaimTokenHash) {
        await db.$transaction([
          db.emailLog.update({ where: { id: row.id }, data: sentData }),
          db.memory.update({ where: { id: input.memoryId }, data: { claimTokenHash: input.rotateToClaimTokenHash } }),
        ]);
      } else {
        await db.emailLog.update({ where: { id: row.id }, data: sentData });
      }
      recorded = true;
    } catch (error) {
      if (attempt === 3) {
        logError("confirmation sent but could not be recorded as SENT", error, { category: "email", memoryId: input.memoryId });
      } else {
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
      }
    }
  }
  log.info({ action: "sent", memoryId: input.memoryId, recorded }, "confirmation sent");
  return { sent: true, messageId };
}

/** The row for this memory, creating it when absent; a concurrent creator's row is loaded instead. */
async function createOrLoad(memoryId: string, recipient: string) {
  const db = getDb();
  try {
    return await db.emailLog.create({
      data: { memoryId, recipientEmail: recipient, emailType: EMAIL_TYPE, status: "PENDING" },
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002") {
      const row = await db.emailLog.findUnique({ where: { memoryId_emailType: { memoryId, emailType: EMAIL_TYPE } } });
      if (row) {
        return row;
      }
    }
    throw error;
  }
}
