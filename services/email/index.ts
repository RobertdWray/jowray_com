import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { SendGridTransport } from "@/integrations/sendgrid";
import { createLogger, logError } from "@/lib/logger";
import { getAdminAlertEnv, getEmailEnv, getOutboundEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";

import { recipientKey } from "./recipient-key";
import { buildAdminAlertsPaused } from "./templates/admin-alerts-paused";
import { buildAdminNewMemory } from "./templates/admin-new-memory";
import { buildMemoryConfirmation } from "./templates/memory-confirmation";
import { buildSubmissionConfirmation } from "./templates/submission-confirmation";
import type { AdminNewMemoryContent, ClaimRotation, EmailAttachment, EmailTransport, MemoryConfirmationInput, SendResult, SubmissionConfirmationInput } from "./types";

export type {
  AdminNewMemoryContent,
  ClaimRotation,
  EmailAttachment,
  EmailTransport,
  MediaKind,
  MemoryConfirmationContent,
  MemoryConfirmationInput,
  MemoryMediaSummary,
  MemoryVisibility,
  OutboundEmail,
  ReceiptMediaSummary,
  SendResult,
  SkipReason,
  SubmissionConfirmationContent,
  SubmissionConfirmationInput,
  SubmissionMemoryContent,
} from "./types";
export { recipientKey } from "./recipient-key";
export { ADMIN_ALERTS_PAUSED_SUBJECT, buildAdminAlertsPaused } from "./templates/admin-alerts-paused";
export { ADMIN_TIME_ZONE, adminNewMemorySubject, buildAdminNewMemory } from "./templates/admin-new-memory";
export { buildMemoryConfirmation, MEMORY_CONFIRMATION_SUBJECT } from "./templates/memory-confirmation";
export { buildSubmissionConfirmation, memoryLabel, submissionConfirmationSubject } from "./templates/submission-confirmation";

const log = createLogger({ category: "email" });

type EmailType = "MEMORY_CONFIRMATION" | "ADMIN_NEW_MEMORY" | "SUBMISSION_CONFIRMATION";

/**
 * Contributor receipts only: one inbox gets at most this many in a rolling day
 * (D15: raised from 3 so a phone user sending one memory at a time still gets
 * every email). Counted by `recipientKey`, so `+tag` aliases and Gmail dots
 * are one inbox (issue #46, D3). A send of several memories is one receipt,
 * so it counts once. Admin alerts have their own hourly cap (R4, #46 D4).
 */
export const RECIPIENT_DAILY_CAP = 15;
const CAPPED_EMAIL_TYPES: readonly EmailType[] = ["MEMORY_CONFIRMATION", "SUBMISSION_CONFIRMATION"];
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
const RETRY_STEP_MS = 15 * 60 * 1000;
/** Added to a cap's retry time so the retry lands after the oldest counted row has left the window, not on its edge. */
const CAP_RETRY_MARGIN_MS = 60 * 1000;
/** Statuses a new send may claim from; a SENDING row is reclaimed only once its claim is stale. */
const CLAIMABLE = ["PENDING", "FAILED", "SKIPPED"] as const;
/** A SENDING row older than this was abandoned by a crashed or timed-out function. */
const STALE_CLAIM_MS = 15 * 60 * 1000;
/** Statuses that count against every cap: delivered or in flight. FAILED and SKIPPED rows never reached the address, and counting FAILED would lock retries out. */
const COUNTED = ["SENDING", "SENT"] as const;
/**
 * One application-defined lock for every outbound decision (issue #46, D2):
 * the counts and the claim run under `pg_advisory_xact_lock`, so two
 * concurrent sends cannot both see one free slot. Transaction-level: released
 * at commit or rollback, which also makes it safe on a pooled connection.
 * Any constant works; this one is the issue number with a date prefix.
 */
const OUTBOUND_LOCK_KEY = 2026110546;
/** Short and local: the lock is held only for a handful of indexed queries; SendGrid is called after it is released. */
const DECISION_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

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

/**
 * Which ceilings a delivery is subject to.
 * - `contributor`: the per-inbox daily cap, then the global hourly and daily
 *   ceilings; a global refusal is retryable (FAILED, `nextAttemptAt` at the
 *   window's end) so a real relative's receipt still arrives later.
 * - `admin`: the admin hourly cap; the alert that reaches it is replaced by one
 *   fixed "arriving quickly" notice and the rest of the hour is skipped.
 */
type CapPolicy = { kind: "contributor" } | { kind: "admin" };

interface Delivery {
  memoryId: string;
  emailType: EmailType;
  /** Lower-cased, deduplicated. Several recipients means one message they all see. */
  recipients: string[];
  /** Already rendered: a template error must surface before any row is claimed, never strand a SENDING row. */
  rendered: Rendered;
  policy: CapPolicy;
  /** Cron path of a receipt: write these claim hashes together with SENT in one transaction, in this order (anchor first). */
  rotations?: ClaimRotation[];
  /** For log lines and Sentry messages. */
  label: string;
}

/** The client inside an interactive transaction: the same API without the transaction methods. */
type Tx = Prisma.TransactionClient;

interface LogRow {
  id: string;
  status: "PENDING" | "SENDING" | "SENT" | "FAILED" | "SKIPPED";
  attempts: number;
}

type Decision =
  | { outcome: "already_sent" }
  | { outcome: "in_progress" }
  | { outcome: "skipped"; reason: "outbound_disabled" | "recipient_capped" | "admin_capped" }
  | { outcome: "global_capped"; retryAt: Date }
  | { outcome: "claimed"; row: LogRow; rendered: Rendered };

/** Count rows of the given types that reached or are reaching an address in the window, leaving this memory's own row out. */
function countedWhere(now: number, windowMs: number, memoryId: string, types: readonly EmailType[], recipientKeyField?: string) {
  return {
    ...(recipientKeyField !== undefined && { recipientKey: recipientKeyField }),
    emailType: { in: [...types] },
    updatedAt: { gte: new Date(now - windowMs) },
    status: { in: [...COUNTED] },
    NOT: { memoryId },
  };
}

/** Only rows nobody is sending move: never SENDING (a concurrent sender owns it) or SENT. */
async function markSkipped(tx: Tx, memoryId: string, emailType: EmailType, reason: "outbound_disabled" | "recipient_capped" | "admin_capped"): Promise<void> {
  await tx.emailLog.updateMany({
    where: { memoryId, emailType, status: { in: [...CLAIMABLE] } },
    data: { status: "SKIPPED", errorMessage: reason },
  });
}

/**
 * When the global ceilings for contributor email would be crossed by one more
 * send, the instant the earliest counted row leaves its window (plus a margin);
 * null while there is room. Both windows are checked and the later time wins.
 */
async function globalCapRetryAt(tx: Tx, now: number, memoryId: string): Promise<Date | null> {
  const { OUTBOUND_HOURLY_CAP, OUTBOUND_DAILY_CAP } = getOutboundEnv();
  let retryAt: Date | null = null;
  for (const { cap, windowMs } of [
    { cap: OUTBOUND_HOURLY_CAP, windowMs: HOUR_MS },
    { cap: OUTBOUND_DAILY_CAP, windowMs: DAY_MS },
  ]) {
    const where = countedWhere(now, windowMs, memoryId, CAPPED_EMAIL_TYPES);
    const recent = await tx.emailLog.count({ where });
    if (recent < cap) {
      continue;
    }
    const oldest = await tx.emailLog.findFirst({ where, orderBy: { updatedAt: "asc" }, select: { updatedAt: true } });
    const candidate = new Date((oldest?.updatedAt.getTime() ?? now) + windowMs + CAP_RETRY_MARGIN_MS);
    if (retryAt === null || candidate > retryAt) {
      retryAt = candidate;
    }
  }
  return retryAt;
}

/**
 * Everything that decides whether this delivery goes out, under the outbound
 * lock: the row exists afterwards in every case (so the cron never re-selects
 * a memory the caps have already answered), the caps are counted against rows
 * that are SENT or in flight, and the claim moves the row to SENDING in the
 * same transaction. No network call happens here.
 */
async function decide(delivery: Delivery, allowed: string[], recipientField: string, recipientKeyField: string): Promise<Decision> {
  const { memoryId, emailType } = delivery;
  const key = { memoryId_emailType: { memoryId, emailType } };
  return getDb().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${OUTBOUND_LOCK_KEY}::bigint)`;
    const row = (await tx.emailLog.findUnique({ where: key })) ?? (await tx.emailLog.create({ data: { memoryId, emailType, recipientEmail: recipientField, recipientKey: recipientKeyField, status: "PENDING" } }));
    if (row.status === "SENT") {
      return { outcome: "already_sent" };
    }
    if (allowed.length === 0) {
      await markSkipped(tx, memoryId, emailType, "outbound_disabled");
      return { outcome: "skipped", reason: "outbound_disabled" };
    }
    const now = Date.now();
    let rendered = delivery.rendered;
    if (delivery.policy.kind === "contributor") {
      // Counted by the last state change (the send), not the row's creation: a
      // row created days ago and sent today still counts for today. Only rows
      // of the capped types count, so an admin who also contributes is never
      // capped by their own alerts.
      const recentToInbox = await tx.emailLog.count({ where: countedWhere(now, DAY_MS, memoryId, CAPPED_EMAIL_TYPES, recipientKeyField) });
      if (recentToInbox >= RECIPIENT_DAILY_CAP) {
        await markSkipped(tx, memoryId, emailType, "recipient_capped");
        return { outcome: "skipped", reason: "recipient_capped" };
      }
      const retryAt = await globalCapRetryAt(tx, now, memoryId);
      if (retryAt !== null) {
        // Retryable, not terminal: `attempts` is untouched (this is not a failure of the
        // send), and the cron's FAILED-and-due selection picks the row up after the window.
        await tx.emailLog.updateMany({
          where: { id: row.id, status: { in: [...CLAIMABLE] } },
          data: { status: "FAILED", nextAttemptAt: retryAt, errorMessage: "global_capped", recipientEmail: recipientField, recipientKey: recipientKeyField },
        });
        return { outcome: "global_capped", retryAt };
      }
    } else {
      const { ADMIN_ALERT_HOURLY_CAP } = getAdminAlertEnv();
      const recentAlerts = await tx.emailLog.count({ where: countedWhere(now, HOUR_MS, memoryId, ["ADMIN_NEW_MEMORY"]) });
      if (recentAlerts > ADMIN_ALERT_HOURLY_CAP) {
        await markSkipped(tx, memoryId, emailType, "admin_capped");
        return { outcome: "skipped", reason: "admin_capped" };
      }
      if (recentAlerts === ADMIN_ALERT_HOURLY_CAP) {
        // The alert that crosses the cap becomes the one pause notice; it counts, so the next one skips.
        rendered = buildAdminAlertsPaused({ cap: ADMIN_ALERT_HOURLY_CAP });
      }
    }
    const claimed = await tx.emailLog.updateMany({
      where: {
        id: row.id,
        OR: [{ status: { in: [...CLAIMABLE] } }, { status: "SENDING", updatedAt: { lt: new Date(now - STALE_CLAIM_MS) } }],
      },
      data: { status: "SENDING", recipientEmail: recipientField, recipientKey: recipientKeyField },
    });
    if (claimed.count === 0) {
      return { outcome: "in_progress" };
    }
    return { outcome: "claimed", row: { id: row.id, status: row.status, attempts: row.attempts }, rendered };
  }, DECISION_TX_OPTIONS);
}

/**
 * Deliver one email of one type for one memory. Shared by the contributor
 * confirmations and the admin alert.
 *
 * - Idempotent through the `(memoryId, emailType)` unique key and an atomic
 *   claim (`PENDING|FAILED|SKIPPED → SENDING`) taken under the outbound lock:
 *   two concurrent callers produce one email; a SENT row is never sent again.
 * - Skips (outbound guard, per-inbox cap, admin cap) leave a terminal SKIPPED
 *   row with the reason, so the reconcile cron does not pick the memory up
 *   again and again; a later request-path call may still claim it.
 * - A global-ceiling refusal leaves a FAILED row with `nextAttemptAt` at the
 *   window's end and `attempts` unchanged, so the cron sends it later.
 * - Failures leave a FAILED row with `attempts` and `nextAttemptAt` for the cron.
 * - The row's `recipientEmail` is the set actually attempted (after the
 *   outbound guard), joined with ", " when there are several; `recipientKey`
 *   is the same set in canonical form. SENT means SendGrid accepted the
 *   message for that set, not per-recipient delivery.
 * - Guarantee: one row prevents concurrent sends. A crash between SendGrid's
 *   202 and the SENT write leaves a SENDING row that is reclaimed after
 *   15 minutes, so a duplicate is possible in that window (accepted, R5).
 */
async function deliver(delivery: Delivery): Promise<SendResult> {
  const db = getDb();
  const { memoryId, emailType, label } = delivery;

  const allowed = delivery.recipients.filter(outboundAllowed);
  const attempted = allowed.length > 0 ? allowed : delivery.recipients;
  const recipientField = attempted.join(", ");
  const recipientKeyField = attempted.map(recipientKey).join(", ");
  if (allowed.length > 0 && allowed.length < delivery.recipients.length) {
    log.info({ action: "recipients_dropped", memoryId, emailType, dropped: delivery.recipients.length - allowed.length }, `${label}: outbound guard dropped recipients`);
  }

  const decision = await decide(delivery, allowed, recipientField, recipientKeyField);
  switch (decision.outcome) {
    case "already_sent":
      return { sent: false, skipped: "already_sent" };
    case "in_progress":
      return { sent: false, skipped: "in_progress" };
    case "skipped":
      log.info({ action: "skip", memoryId, emailType, reason: decision.reason }, `${label} skipped`);
      return { sent: false, skipped: decision.reason };
    case "global_capped":
      log.warn({ action: "global_capped", memoryId, emailType, retryAt: decision.retryAt.toISOString() }, `${label} held: global outbound ceiling reached`);
      return { sent: false, skipped: "global_capped" };
    case "claimed":
      break;
  }
  const { row, rendered } = decision;

  let messageId: string | undefined;
  try {
    ({ messageId } = await getTransport().send({
      to: allowed,
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
    logError(`${label} failed`, error, { category: "email", memoryId, emailType, attempts });
    return { sent: false, skipped: "failed", error: message };
  }

  // The email is out. Record SENT (and the rotated claim hashes, atomically
  // and in the order given, so every writer takes the anchor first); retry
  // the bookkeeping a few times before leaving the row SENDING, which the
  // stale-claim rule would otherwise re-send after 15 minutes.
  const sentData = { status: "SENT" as const, sentAt: new Date(), sendgridMessageId: messageId ?? null, errorMessage: null };
  const rotations = delivery.rotations ?? [];
  let recorded = false;
  for (let attempt = 1; attempt <= 3 && !recorded; attempt += 1) {
    try {
      if (rotations.length > 0) {
        await db.$transaction([
          db.emailLog.update({ where: { id: row.id }, data: sentData }),
          ...rotations.map((r) => db.memory.update({ where: { id: r.memoryId }, data: { claimTokenHash: r.claimTokenHash } })),
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

/** Send the one confirmation email for a memory to its contributor (capped per inbox per day and by the global ceilings). */
export async function sendMemoryConfirmation(input: MemoryConfirmationInput): Promise<SendResult> {
  return deliver({
    memoryId: input.memoryId,
    emailType: "MEMORY_CONFIRMATION",
    recipients: [input.to.trim().toLowerCase()],
    rendered: buildMemoryConfirmation(input),
    policy: { kind: "contributor" },
    rotations: input.rotateToClaimTokenHash ? [{ memoryId: input.memoryId, claimTokenHash: input.rotateToClaimTokenHash }] : undefined,
    label: "confirmation",
  });
}

/**
 * Send the one receipt for a whole send of memories (Task 15). The row hangs
 * off the anchor under its own type, so it is independent of any per-memory
 * confirmation row; the caps count it once however many memories it lists.
 */
export async function sendSubmissionConfirmation(input: SubmissionConfirmationInput): Promise<SendResult> {
  return deliver({
    memoryId: input.anchorMemoryId,
    emailType: "SUBMISSION_CONFIRMATION",
    recipients: [input.to.trim().toLowerCase()],
    rendered: buildSubmissionConfirmation(input),
    policy: { kind: "contributor" },
    rotations: input.rotations,
    label: "send receipt",
  });
}

/**
 * Send the one "new memory" alert for a memory to the family admins in
 * `ADMIN_ALERT_EMAILS`: one message they all see, no links. Capped per
 * rolling hour by `ADMIN_ALERT_HOURLY_CAP` (one pause notice, then skips).
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
    policy: { kind: "admin" },
    label: "admin alert",
  });
}

/**
 * Record that there is nothing to send for this memory and type, as a
 * terminal SKIPPED row, so the reconcile cron stops selecting it. A SENT or
 * SENDING row is never touched (a send of several memories whose anchor was
 * removed is still emailed for its live siblings; this is only for a send
 * with no live memory at all). Taken under the outbound lock like every other
 * row creation, so no creator ever races another.
 */
export async function skipDelivery({ memoryId, emailType, reason }: { memoryId: string; emailType: EmailType; reason: "nothing_to_send" }): Promise<SendResult> {
  const key = { memoryId_emailType: { memoryId, emailType } };
  const outcome = await getDb().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${OUTBOUND_LOCK_KEY}::bigint)`;
    const row = (await tx.emailLog.findUnique({ where: key })) ?? (await tx.emailLog.create({ data: { memoryId, emailType, recipientEmail: "", recipientKey: "", status: "PENDING" } }));
    if (row.status === "SENT") {
      return "already_sent" as const;
    }
    await tx.emailLog.updateMany({
      where: { memoryId, emailType, status: { in: [...CLAIMABLE] } },
      data: { status: "SKIPPED", errorMessage: reason },
    });
    return reason;
  }, DECISION_TX_OPTIONS);
  if (outcome === "already_sent") {
    return { sent: false, skipped: "already_sent" };
  }
  log.info({ action: "skip", memoryId, emailType, reason }, "nothing to send");
  return { sent: false, skipped: reason };
}
