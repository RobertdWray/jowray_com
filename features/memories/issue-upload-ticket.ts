import "server-only";

import { budgetHasRoom, TX_OPTIONS, type UploadGrant } from "@/features/memories/create-memory";
import { BudgetBusyError, lockBudget } from "@/features/memories/lock";
import { renewUploadLease } from "@/features/memories/upload-lease";
import { hashClaimToken } from "@/lib/claim-token";
import { createLogger } from "@/lib/logger";
import { tagIds } from "@/lib/sentry/user";
import { mintUploadTicket, UPLOAD_WINDOW_MS } from "@/lib/upload-ticket";
import { issueTicketRequestSchema } from "@/lib/validations/memory";
import { getDb } from "@/server/db/client";

const log = createLogger({ category: "upload" });
/** A reservation is a day's promise at most: after this no new token is minted and the cron gives up on it. */
const RESERVATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type IssueTicketResult =
  | { ok: true; upload: UploadGrant }
  | { ok: false; code: "invalid" | "not_found" | "not_pending" | "expired" | "budget_exceeded" };

type Refusal = Exclude<IssueTicketResult, { ok: true }>["code"];

/**
 * Mint the upload ticket for one PENDING row right before its upload, so the
 * token exchange always happens inside the ticket's 15-minute TTL however
 * long the earlier files took. The row's own pathname, MIME type and ceiling
 * are the claims; the caller never chooses them.
 *
 * Authorization is per resource: the claim token must own the memory and the
 * row must belong to that memory, be live and still PENDING (C2). The send's
 * lease is renewed on the anchor so the cron does not email or rotate while
 * this file is landing. The same path serves the claim page's "Try again".
 *
 * Every mint is recorded on the row (issue #44, Oscar #18): `reservedUntil`
 * moves to the last moment a Blob token obtained with this ticket could still
 * land bytes (ticket TTL + token lifetime = UPLOAD_WINDOW_MS). The cron never
 * fails or purges a row before that moment, so no byte can arrive on a FAILED
 * row. Until then the row also holds its bytes of the daily budget; once the
 * window has closed it stopped counting, so a new ticket is a new promise and
 * re-reserves its bytes. A reservation older than a day gets no ticket at
 * all, which bounds how far any window can run past the cron's give-up point.
 *
 * Whether the window is open is decided under the budget lock, on a fresh
 * read with a fresh clock (TCR #2/#11): an allocator holding that lock counts
 * this row as open or expired by the same rule at the same instant, so a
 * window cannot expire between our read and our stamp, two retries cannot
 * both re-reserve, and time spent waiting for the lease or the lock never
 * shortens the ticket. Lock order: lease first (C24, C25), budget last. The
 * stamp is a conditional update on the state we read; its row count is the
 * final authorisation.
 */
export async function issueUploadTicket(raw: unknown): Promise<IssueTicketResult> {
  const parsed = issueTicketRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const { claimToken, mediaId } = parsed.data;
  const claimTokenHash = hashClaimToken(claimToken);
  let result: Refusal | { pathname: string; ticket: UploadGrant["ticket"]; memoryId: string };
  try {
    result = await getDb().$transaction(async (tx) => {
      const memory = await tx.memory.findUnique({ where: { claimTokenHash } });
      if (!memory || memory.deletedAt !== null) {
        return "not_found" as const;
      }
      // Cheap refusals before any lock; everything is decided again under the lock.
      const first = await tx.media.findFirst({ where: { id: mediaId, memoryId: memory.id, deletedAt: null } });
      if (!first) {
        return "not_found" as const;
      }
      if (first.status !== "PENDING") {
        return "not_pending" as const;
      }
      if (first.createdAt.getTime() < Date.now() - RESERVATION_MAX_AGE_MS) {
        return "expired" as const;
      }
      tagIds({ memoryId: memory.id, mediaId: first.id });
      await renewUploadLease(tx, memory);
      await lockBudget(tx);
      const row = await tx.media.findUnique({ where: { id: first.id } });
      const now = Date.now();
      if (!row || row.deletedAt !== null || row.status !== "PENDING") {
        return "not_pending" as const;
      }
      if (row.createdAt.getTime() < now - RESERVATION_MAX_AGE_MS) {
        return "expired" as const;
      }
      // A row the old code wrote has no window yet; it has counted since its creation, so it is open.
      const open = row.reservedUntil === null || row.reservedUntil.getTime() > now;
      if (!open && !(await budgetHasRoom(tx, row.maxBytes, 0, new Date(now)))) {
        return "budget_exceeded" as const;
      }
      const stamped = await tx.media.updateMany({
        where: { id: row.id, status: "PENDING", deletedAt: null, reservedUntil: row.reservedUntil },
        data: { reservedUntil: new Date(now + UPLOAD_WINDOW_MS) },
      });
      if (stamped.count !== 1) {
        return "not_pending" as const;
      }
      const ticket = mintUploadTicket({ mediaId: row.id, memoryId: memory.id, pathname: row.storageKey, mimeType: row.mimeType, maxBytes: row.maxBytes }, { now });
      return { pathname: row.storageKey, ticket, memoryId: memory.id };
    }, TX_OPTIONS);
  } catch (error) {
    if (!(error instanceof BudgetBusyError)) {
      throw error;
    }
    log.warn({ action: "budget_busy", mediaId }, "budget lock wait timed out; answered budget_exceeded");
    result = "budget_exceeded";
  }
  if (typeof result === "string") {
    if (result === "budget_exceeded") {
      log.warn({ action: "budget_refusal", mediaId }, "re-ticket refused: daily budget reached");
    }
    return { ok: false, code: result };
  }
  log.info({ action: "ticket_issued", mediaId, memoryId: result.memoryId }, "upload ticket issued");
  return { ok: true, upload: { pathname: result.pathname, ticket: result.ticket } };
}
