import "server-only";

import type { UploadGrant } from "@/features/memories/create-memory";
import { renewUploadLease } from "@/features/memories/upload-lease";
import { hashClaimToken } from "@/lib/claim-token";
import { createLogger } from "@/lib/logger";
import { tagIds } from "@/lib/sentry/user";
import { mintUploadTicket } from "@/lib/upload-ticket";
import { issueTicketRequestSchema } from "@/lib/validations/memory";
import { getDb } from "@/server/db/client";

const log = createLogger({ category: "upload" });

export type IssueTicketResult =
  | { ok: true; upload: UploadGrant }
  | { ok: false; code: "invalid" | "not_found" | "not_pending" };

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
 */
export async function issueUploadTicket(raw: unknown): Promise<IssueTicketResult> {
  const parsed = issueTicketRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const { claimToken, mediaId } = parsed.data;
  const db = getDb();
  const memory = await db.memory.findUnique({ where: { claimTokenHash: hashClaimToken(claimToken) } });
  if (!memory || memory.deletedAt !== null) {
    return { ok: false, code: "not_found" };
  }
  const row = await db.media.findFirst({ where: { id: mediaId, memoryId: memory.id, deletedAt: null } });
  if (!row) {
    return { ok: false, code: "not_found" };
  }
  if (row.status !== "PENDING") {
    return { ok: false, code: "not_pending" };
  }
  tagIds({ memoryId: memory.id, mediaId: row.id });
  await renewUploadLease(db, memory);
  const ticket = mintUploadTicket({ mediaId: row.id, memoryId: memory.id, pathname: row.storageKey, mimeType: row.mimeType, maxBytes: row.maxBytes });
  log.info({ action: "ticket_issued", mediaId: row.id, memoryId: memory.id }, "upload ticket issued");
  return { ok: true, upload: { pathname: row.storageKey, ticket } };
}
