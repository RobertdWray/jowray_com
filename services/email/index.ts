import "server-only";

import { Prisma } from "@/generated/prisma/client";
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
  MediaPreview,
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
/** A SKIPPED row with one of these reasons is final: no sender, request path or cron may ever claim it. */
export const TERMINAL_SKIP_REASONS = ["admin_shared"] as const;
/** A SENDING row older than this was abandoned by a crashed or timed-out function. */
const STALE_CLAIM_MS = 15 * 60 * 1000;
/**
 * `errorMessage` of the one "arriving quickly" notice that replaces the alert
 * crossing the admin hourly cap (issue #46, D4). It tells that row apart from
 * the alerts it stands in for, so the notice goes once per hour: while a notice
 * is within the hour, further alerts skip; normal alerts are counted without it.
 */
export const ADMIN_PAUSED_MARK = "admin_paused";
/**
 * One application-defined lock for every outbound decision (issue #46, D2):
 * the counts and the claim run under `pg_advisory_xact_lock`, so two
 * concurrent sends cannot both see one free slot. Transaction-level: released
 * at commit or rollback, which also makes it safe on a pooled connection.
 * Distinct from the upload budget's lock (`features/memories/lock.ts`), and the
 * two are never taken in one transaction: a budget transaction has committed
 * before any email decision starts. Any constant works; this one is the issue
 * number with a date prefix.
 */
const OUTBOUND_LOCK_KEY = 2026110546;
/**
 * How long a decision may wait for the lock. Each waiter holds a pooled
 * connection, so the wait is bounded server-side (`SET LOCAL lock_timeout`):
 * past it the statement is cancelled, nothing is written, the caller gets
 * `busy`, and the cron's catch-up sends the email on a later run.
 */
export const LOCK_WAIT_SECONDS = 3;
/** Short and local: the lock is held only for a handful of indexed queries; SendGrid is called after it is released. */
const DECISION_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;
/** PostgreSQL's `lock_not_available`, raised when `lock_timeout` runs out. */
const PG_LOCK_NOT_AVAILABLE = "55P03";

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
  updatedAt: Date;
  errorMessage: string | null;
}

type Decision =
  | { outcome: "already_sent" }
  | { outcome: "in_progress" }
  | { outcome: "skipped"; reason: "outbound_disabled" | "recipient_capped" | "admin_capped" | (typeof TERMINAL_SKIP_REASONS)[number] }
  | { outcome: "global_capped"; retryAt: Date }
  | { outcome: "claimed"; row: LogRow; rendered: Rendered; mark: string | null };

/** Rows a sender may take over: never SENT or terminal skips, and SENDING only once stale. Exported for the real-Postgres test. */
export function claimableWhere(now: number): Prisma.EmailLogWhereInput {
  return {
    OR: [
      { status: { in: ["PENDING", "FAILED"] } },
      // SQL NOT IN does not match NULL: legacy skips without a reason remain claimable.
      { status: "SKIPPED", OR: [{ errorMessage: null }, { errorMessage: { notIn: [...TERMINAL_SKIP_REASONS] } }] },
      { status: "SENDING", updatedAt: { lt: new Date(now - STALE_CLAIM_MS) } },
    ],
  };
}

/** True while another sender's claim on this row is live. */
function inFlight(row: LogRow, now: number): boolean {
  return row.status === "SENDING" && row.updatedAt.getTime() >= now - STALE_CLAIM_MS;
}

/**
 * Rows of the given types that reached, or are reaching, an address in the
 * window: SENT rows by their last state change, SENDING rows only while the
 * claim is fresh (a stale one was abandoned and will be reclaimed). This row
 * itself is left out, never its whole memory (the other confirmation type on
 * an anchor is a real email and counts).
 */
function countedWhere(now: number, windowMs: number, excludeId: string, types: readonly EmailType[], recipientKeyField?: string): Prisma.EmailLogWhereInput {
  const windowStart = new Date(now - windowMs);
  return {
    ...(recipientKeyField !== undefined && { recipientKey: recipientKeyField }),
    emailType: { in: [...types] },
    NOT: { id: excludeId },
    OR: [
      { status: "SENT", updatedAt: { gte: windowStart } },
      { status: "SENDING", updatedAt: { gte: new Date(Math.max(windowStart.getTime(), now - STALE_CLAIM_MS)) } },
    ],
  };
}

/** Only rows nobody is sending move: never SENT, never a fresh SENDING claim (a concurrent sender owns it). */
async function markSkipped(tx: Tx, now: number, memoryId: string, emailType: EmailType, reason: "outbound_disabled" | "recipient_capped" | "admin_capped"): Promise<void> {
  await tx.emailLog.updateMany({
    where: { memoryId, emailType, ...claimableWhere(now) },
    data: { status: "SKIPPED", errorMessage: reason },
  });
}

/** Take the outbound lock with a bounded wait; both statements are transaction-local. */
async function lockOutbound(tx: Tx): Promise<void> {
  await tx.$executeRaw`SET LOCAL lock_timeout = '${Prisma.raw(String(LOCK_WAIT_SECONDS))}s'`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${OUTBOUND_LOCK_KEY}::bigint)`;
}

/** The row for this memory and type, created PENDING when absent. Under the outbound lock no other creator can race this. */
async function loadOrCreate(tx: Tx, memoryId: string, emailType: EmailType, recipientEmail: string, recipientKeyField: string): Promise<LogRow> {
  const key = { memoryId_emailType: { memoryId, emailType } };
  return (await tx.emailLog.findUnique({ where: key })) ?? (await tx.emailLog.create({ data: { memoryId, emailType, recipientEmail, recipientKey: recipientKeyField, status: "PENDING" } }));
}

/**
 * Permanently suppress the alert for an on-behalf share (R5, D11, C40).
 * This is the one EmailLog row creation outside the outbound lock.
 * Precondition: the caller holds the memory lock and re-reads a memory that
 * is still a DRAFT inside the same transaction, before applying its share
 * status change. Call this helper in that transaction before committing.
 * No alert creator acts on a DRAFT (siteAlertsAdmins, ADMIN_ALERT_WHERE), and
 * this row commits together with the status change: the first moment any
 * creator can see the shared memory, the terminal row already exists.
 * An existing terminal skip is already suppressed. Any other existing row
 * breaks the DRAFT invariant: fail closed so the whole share rolls back,
 * because committing could leave an alert able to send after later activity.
 */
export async function suppressAdminAlertForDraftShare(tx: Prisma.TransactionClient, memoryId: string): Promise<void> {
  const emailType = "ADMIN_NEW_MEMORY";
  const inserted = await tx.emailLog.createMany({
    data: { memoryId, emailType, status: "SKIPPED", errorMessage: "admin_shared", recipientEmail: "", recipientKey: "" },
    skipDuplicates: true,
  });
  if (inserted.count === 0) {
    const existing = await tx.emailLog.findUnique({ where: { memoryId_emailType: { memoryId, emailType } }, select: { status: true, errorMessage: true } });
    if (existing?.status === "SKIPPED" && TERMINAL_SKIP_REASONS.some((reason) => reason === existing.errorMessage)) {
      return;
    }
    throw new Error(`admin alert row already exists for draft memory ${memoryId} (status ${existing?.status ?? "missing"}); share refused`);
  }
}

/**
 * Was this error PostgreSQL giving up on the lock wait (`lock_timeout`)?
 * With Prisma 7 and `@prisma/adapter-neon` a raw-query failure arrives as a
 * `P2010` whose `meta.driverAdapterError.cause` is the adapter's
 * `{ kind: "postgres", code, originalCode, … }` (see `convertDriverError` in
 * the adapter and the `P2010` wrapper in `@prisma/client/runtime/client.js`).
 * Older shapes (`meta.code`, a `.code` on the error or on a `.cause` chain)
 * are accepted too; they cost nothing and keep this robust to an upgrade.
 */
function isLockTimeout(error: unknown): boolean {
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (typeof current !== "object" || current === null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    const record = current as { code?: unknown; originalCode?: unknown; meta?: { code?: unknown; driverAdapterError?: unknown }; cause?: unknown };
    if (record.code === PG_LOCK_NOT_AVAILABLE || record.originalCode === PG_LOCK_NOT_AVAILABLE || record.meta?.code === PG_LOCK_NOT_AVAILABLE) {
      return true;
    }
    queue.push(record.meta?.driverAdapterError, record.cause);
  }
  return false;
}

/**
 * When the global ceilings for contributor email would be crossed by one more
 * send, the instant the earliest counted row leaves its window (plus a margin);
 * null while there is room. Both windows are checked and the later time wins.
 */
async function globalCapRetryAt(tx: Tx, now: number, excludeId: string): Promise<Date | null> {
  const { OUTBOUND_HOURLY_CAP, OUTBOUND_DAILY_CAP } = getOutboundEnv();
  let retryAt: Date | null = null;
  for (const { cap, windowMs } of [
    { cap: OUTBOUND_HOURLY_CAP, windowMs: HOUR_MS },
    { cap: OUTBOUND_DAILY_CAP, windowMs: DAY_MS },
  ]) {
    const where = countedWhere(now, windowMs, excludeId, CAPPED_EMAIL_TYPES);
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
 * a memory the caps have already answered), a live claim by another sender
 * answers `in_progress` before any cap can misreport it, the caps are counted
 * against rows that are SENT or freshly in flight, and the claim moves the row
 * to SENDING in the same transaction. No network call happens here.
 */
async function decide(delivery: Delivery, allowed: string[], recipientField: string, recipientKeyField: string): Promise<Decision> {
  const { memoryId, emailType } = delivery;
  return getDb().$transaction(async (tx) => {
    await lockOutbound(tx);
    const now = Date.now();
    const row = await loadOrCreate(tx, memoryId, emailType, recipientField, recipientKeyField);
    if (row.status === "SENT") {
      return { outcome: "already_sent" };
    }
    const terminalReason = row.status === "SKIPPED" ? TERMINAL_SKIP_REASONS.find((reason) => reason === row.errorMessage) : undefined;
    if (terminalReason !== undefined) {
      return { outcome: "skipped", reason: terminalReason };
    }
    if (inFlight(row, now)) {
      return { outcome: "in_progress" };
    }
    if (allowed.length === 0) {
      await markSkipped(tx, now, memoryId, emailType, "outbound_disabled");
      return { outcome: "skipped", reason: "outbound_disabled" };
    }
    let rendered = delivery.rendered;
    let mark: string | null = null;
    if (delivery.policy.kind === "contributor") {
      // Counted by the last state change (the send), not the row's creation: a
      // row created days ago and sent today still counts for today. Only rows
      // of the capped types count, so an admin who also contributes is never
      // capped by their own alerts.
      const recentToInbox = await tx.emailLog.count({ where: countedWhere(now, DAY_MS, row.id, CAPPED_EMAIL_TYPES, recipientKeyField) });
      if (recentToInbox >= RECIPIENT_DAILY_CAP) {
        await markSkipped(tx, now, memoryId, emailType, "recipient_capped");
        return { outcome: "skipped", reason: "recipient_capped" };
      }
      const retryAt = await globalCapRetryAt(tx, now, row.id);
      if (retryAt !== null) {
        // Retryable, not terminal: `attempts` is untouched (this is not a failure of the
        // send), and the cron's FAILED-and-due selection picks the row up after the window.
        await tx.emailLog.updateMany({
          where: { id: row.id, ...claimableWhere(now) },
          data: { status: "FAILED", nextAttemptAt: retryAt, errorMessage: "global_capped", recipientEmail: recipientField, recipientKey: recipientKeyField },
        });
        return { outcome: "global_capped", retryAt };
      }
    } else {
      const { ADMIN_ALERT_HOURLY_CAP } = getAdminAlertEnv();
      const thisHour = countedWhere(now, HOUR_MS, row.id, ["ADMIN_NEW_MEMORY"]);
      // One notice per hour: while the last notice is within the hour, every further alert skips.
      const pausedThisHour = await tx.emailLog.count({ where: { ...thisHour, errorMessage: ADMIN_PAUSED_MARK } });
      if (pausedThisHour > 0) {
        await markSkipped(tx, now, memoryId, emailType, "admin_capped");
        return { outcome: "skipped", reason: "admin_capped" };
      }
      // Otherwise count the alerts themselves; the one that would cross the cap becomes the notice.
      const recentAlerts = await tx.emailLog.count({ where: { ...thisHour, errorMessage: null } });
      if (recentAlerts >= ADMIN_ALERT_HOURLY_CAP) {
        rendered = buildAdminAlertsPaused({ cap: ADMIN_ALERT_HOURLY_CAP });
        mark = ADMIN_PAUSED_MARK;
      }
    }
    const claimed = await tx.emailLog.updateMany({
      where: { id: row.id, ...claimableWhere(now) },
      data: { status: "SENDING", recipientEmail: recipientField, recipientKey: recipientKeyField, errorMessage: mark },
    });
    if (claimed.count === 0) {
      return { outcome: "in_progress" };
    }
    return { outcome: "claimed", row, rendered, mark };
  }, DECISION_TX_OPTIONS);
}

/**
 * Deliver one email of one type for one memory. Shared by the contributor
 * confirmations and the admin alert.
 *
 * - Idempotent through the `(memoryId, emailType)` unique key and an atomic
 *   claim (`PENDING|FAILED|SKIPPED → SENDING`) taken under the outbound lock:
 *   two concurrent callers produce one email; a SENT row is never sent again.
 * - Ordinary skips (outbound guard, per-inbox cap, admin cap) leave a SKIPPED
 *   row with the reason, so the reconcile cron does not pick the memory up
 *   again and again; a later request-path call may still claim it. Terminal
 *   skips (TERMINAL_SKIP_REASONS) can never be claimed or sent again.
 * - A global-ceiling refusal leaves a FAILED row with `nextAttemptAt` at the
 *   window's end and `attempts` unchanged, so the cron sends it later.
 * - A decision that cannot be made (lock wait exhausted: `busy`; any other
 *   database error: `failed`) writes nothing and never throws at the caller;
 *   with no row, the cron's catch-up queries find the memory on a later run.
 * - Failures at SendGrid leave a FAILED row with `attempts` and `nextAttemptAt` for the cron.
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

  let decision: Decision;
  try {
    decision = await decide(delivery, allowed, recipientField, recipientKeyField);
  } catch (error) {
    if (isLockTimeout(error)) {
      log.warn({ action: "busy", memoryId, emailType, lockWaitSeconds: LOCK_WAIT_SECONDS }, `${label} deferred: outbound lock busy`);
      return { sent: false, skipped: "busy" };
    }
    const message = error instanceof Error ? error.message : String(error);
    logError(`${label} decision failed`, error, { category: "email", memoryId, emailType });
    return { sent: false, skipped: "failed", error: message };
  }
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
  const { row, rendered, mark } = decision;

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
  // stale-claim rule would otherwise re-send after 15 minutes. The pause
  // notice keeps its mark so the next decision can see it.
  const sentData = { status: "SENT" as const, sentAt: new Date(), sendgridMessageId: messageId ?? null, errorMessage: mark };
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
  log.info({ action: "sent", memoryId, emailType, recorded, ...(mark && { mark }) }, `${label} sent`);
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
 * SKIPPED row, so the reconcile cron stops selecting it. A terminal skip, a SENT
 * row and a live SENDING claim are never touched (a send of several memories
 * whose anchor was removed is still emailed for its live siblings; this is
 * only for a send with no live memory at all). Taken under the outbound lock
 * like other outbound row creation (the DRAFT-guarded exception is documented
 * in suppressAdminAlertForDraftShare); a decision that cannot be made is
 * reported and answered, never thrown.
 */
export async function skipDelivery({ memoryId, emailType, reason }: { memoryId: string; emailType: EmailType; reason: "nothing_to_send" }): Promise<SendResult> {
  let outcome: "already_sent" | "in_progress" | "nothing_to_send" | (typeof TERMINAL_SKIP_REASONS)[number];
  try {
    outcome = await getDb().$transaction(async (tx) => {
      await lockOutbound(tx);
      const now = Date.now();
      const row = await loadOrCreate(tx, memoryId, emailType, "", "");
      if (row.status === "SENT") {
        return "already_sent";
      }
      if (inFlight(row, now)) {
        return "in_progress";
      }
      const terminalReason = row.status === "SKIPPED" ? TERMINAL_SKIP_REASONS.find((skipReason) => skipReason === row.errorMessage) : undefined;
      if (terminalReason !== undefined) {
        return terminalReason;
      }
      await tx.emailLog.updateMany({
        where: { memoryId, emailType, ...claimableWhere(now) },
        data: { status: "SKIPPED", errorMessage: reason },
      });
      return reason;
    }, DECISION_TX_OPTIONS);
  } catch (error) {
    if (isLockTimeout(error)) {
      log.warn({ action: "busy", memoryId, emailType, lockWaitSeconds: LOCK_WAIT_SECONDS }, "skip deferred: outbound lock busy");
      return { sent: false, skipped: "busy" };
    }
    const message = error instanceof Error ? error.message : String(error);
    logError("skip decision failed", error, { category: "email", memoryId, emailType });
    return { sent: false, skipped: "failed", error: message };
  }
  if (outcome === "nothing_to_send") {
    log.info({ action: "skip", memoryId, emailType, reason }, "nothing to send");
  }
  return { sent: false, skipped: outcome };
}
