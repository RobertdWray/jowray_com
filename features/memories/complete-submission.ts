import "server-only";

import { ADMIN_PREVIEW_WAIT_MS } from "@/features/memories/admin-previews";
import { notifyAdminsQuietly, recordMedia } from "@/features/memories/ingest-upload";
import { mediaKindOf } from "@/features/memories/media-summary";
import { LIVE_MEDIA_ORDER } from "@/features/memories/media-state";
import { hashClaimToken, newClaimToken } from "@/lib/claim-token";
import { createLogger, logErrorAndFlush } from "@/lib/logger";
import { afterWithFlush } from "@/lib/sentry/after-flush";
import { confirmationSent } from "@/lib/sentry/metrics";
import { identifyContributor, tagIds } from "@/lib/sentry/user";
import { getSiteUrl } from "@/lib/site-url";
import { completeSubmissionSchema } from "@/lib/validations/memory";
import { getDb } from "@/server/db/client";
import { type ClaimRotation, type ReceiptMediaSummary, type SendResult, sendSubmissionConfirmation, skipDelivery, type SubmissionMemoryContent } from "@/services/email";

const log = createLogger({ category: "email" });

/**
 * How long the anchor's lease is left live once completion starts: long enough
 * for the send to finish under a live request, short enough that the cron
 * takes over soon after a request that died here. Never clear the lease
 * outright: a slow send older than the cron's 30-minute age would otherwise
 * have its tokens rotated by (e3) while the browser still holds the raw ones
 * and its page says they are the only copy.
 */
export const COMPLETION_GRACE_MS = 2 * 60_000;

export type SubmissionConfirmResult =
  | SendResult
  | { sent: false; skipped: "not_found" | "no_email" | "leased" | "nothing_to_send" };

export type CompleteSubmissionResult = { ok: true; emailed: boolean } | { ok: false; code: "invalid" | "not_found" };

interface LoadedMedia {
  id: string;
  status: "PENDING" | "READY" | "FAILED";
  mimeType: string;
  durationSeconds: number | null;
}

/** Only what the receipt and the identity need: no contributor-written text is selected (issue #46, D1 and review #5). */
interface LoadedMemory {
  id: string;
  submissionIndex: number | null;
  deletedAt: Date | null;
  contributorNote: string | null;
  claimTokenHash: string;
  contributor: { name: string | null; email: string | null } | null;
  media: LoadedMedia[];
}

/** Every memory of the send in index order, with live media in display order. */
async function loadSubmission(submissionId: string): Promise<LoadedMemory[]> {
  return getDb().memory.findMany({
    where: { submissionId },
    orderBy: { submissionIndex: "asc" },
    select: {
      id: true,
      submissionIndex: true,
      deletedAt: true,
      contributorNote: true,
      claimTokenHash: true,
      contributor: { select: { name: true, email: true } },
      media: {
        where: { deletedAt: null },
        orderBy: [...LIVE_MEDIA_ORDER],
        select: { id: true, status: true, mimeType: true, durationSeconds: true },
      },
    },
  });
}

/**
 * The email's view of one send: READY files per memory by kind and length, a
 * count of files that are not READY, and one entry per live memory even when
 * it has nothing yet, because its link is how the contributor recovers. Fixed
 * content (issue #46, D1; review #6): no note, date, place, filename or
 * uploaded picture leaves here; `hasWords` only drives the "what you sent"
 * line. Nothing is read from storage.
 */
function buildMemories(live: LoadedMemory[], links: Map<string, string>): SubmissionMemoryContent[] {
  return live.map((memory) => {
    const media: ReceiptMediaSummary[] = [];
    let missing = 0;
    for (const row of memory.media) {
      if (row.status !== "READY") {
        missing += 1;
        continue;
      }
      media.push({ kind: mediaKindOf(row.mimeType), durationSeconds: row.durationSeconds });
    }
    return {
      position: (memory.submissionIndex ?? 0) + 1,
      hasWords: (memory.contributorNote ?? "").trim().length > 0,
      media,
      claimLink: `${getSiteUrl()}/m/${links.get(memory.id)}`,
      missingFiles: missing,
    };
  });
}

/**
 * Send the one receipt for a send of memories, listing every live memory
 * with its private link.
 *
 * Request path (`claimTokens` given, from `completeSubmission`): the links
 * carry the raw tokens the browser already holds; nothing rotates.
 *
 * Cron path (`claimTokens` omitted): returns `leased` while the anchor's
 * upload lease is live. After it expires, any PENDING file is re-checked
 * against the store (the browser may have gone away between upload and
 * finalize); files still not READY are counted as missing. Every live memory's
 * token is rotated, anchor first then ascending index, committed by the email
 * service together with SENT (C22, C25). A soft-deleted memory gets no link
 * and no rotation; a send with no live memory writes a terminal SKIPPED row.
 */
export async function confirmSubmission(input: { anchorId: string; claimTokens?: string[] }): Promise<SubmissionConfirmResult> {
  const result = await confirmSubmissionInner(input);
  // One metric per attempt: `sent`, or why it was skipped (plan 2026-11-04 §8.7).
  confirmationSent(result.sent ? "sent" : result.skipped);
  return result;
}

async function confirmSubmissionInner({ anchorId, claimTokens }: { anchorId: string; claimTokens?: string[] }): Promise<SubmissionConfirmResult> {
  const db = getDb();
  const anchor = await db.memory.findUnique({ where: { id: anchorId } });
  if (!anchor || anchor.submissionId === null || anchor.submissionIndex !== 0) {
    return { sent: false, skipped: "not_found" };
  }
  // A receipt that already went out needs no re-check: answer before any of that work.
  const existing = await db.emailLog.findUnique({ where: { memoryId_emailType: { memoryId: anchor.id, emailType: "SUBMISSION_CONFIRMATION" } } });
  if (existing?.status === "SENT") {
    return { sent: false, skipped: "already_sent" };
  }
  const rotating = claimTokens === undefined;
  if (rotating && anchor.uploadLeaseUntil !== null && anchor.uploadLeaseUntil.getTime() > Date.now()) {
    return { sent: false, skipped: "leased" };
  }

  let rows = await loadSubmission(anchor.submissionId);
  // The contributor row is loaded with the send (ruling 6): identity for everything that follows, cron path included.
  identifyContributor({ email: rows[0]?.contributor?.email, name: rows[0]?.contributor?.name });
  // Anything still PENDING is checked against the store once more: on the cron path the lease has
  // run out and the file either landed without a finalize or never will; on the request path a
  // file whose finalize saw the blob a moment too early must not be told "didn't arrive".
  const pending = rows.flatMap((m) => (m.deletedAt === null ? m.media.filter((row) => row.status === "PENDING") : []));
  for (const row of pending) {
    await recordMedia({ mediaId: row.id });
  }
  if (pending.length > 0) {
    rows = await loadSubmission(anchor.submissionId);
  }

  const live = rows.filter((m) => m.deletedAt === null);
  if (live.length === 0) {
    return skipDelivery({ memoryId: anchor.id, emailType: "SUBMISSION_CONFIRMATION", reason: "nothing_to_send" });
  }
  const email = live[0]?.contributor?.email ?? rows.find((m) => m.contributor?.email)?.contributor?.email;
  if (!email) {
    return { sent: false, skipped: "no_email" };
  }

  const links = new Map<string, string>();
  const rotations: ClaimRotation[] = [];
  if (rotating) {
    for (const memory of live) {
      const token = newClaimToken();
      links.set(memory.id, token);
      rotations.push({ memoryId: memory.id, claimTokenHash: hashClaimToken(token) });
    }
  } else {
    const byHash = new Map(claimTokens.map((token) => [hashClaimToken(token), token] as const));
    for (const memory of live) {
      const token = byHash.get(memory.claimTokenHash);
      if (!token) {
        return { sent: false, skipped: "not_found" };
      }
      links.set(memory.id, token);
    }
  }

  // Fixed-content receipt (issue #46, D1): the address and the links; no name or relationship.
  const result = await sendSubmissionConfirmation({
    anchorMemoryId: anchor.id,
    to: email,
    memories: buildMemories(live, links),
    ...(rotating && { rotations }),
  });
  if (rotating && result.sent) {
    log.info({ action: "tokens_rotated", memoryId: anchor.id, memories: live.length }, "claim tokens rotated for an emailed send receipt");
  }
  return result;
}

/**
 * The browser calls this once, in a `finally`, after its uploads: it holds
 * every raw token of the send, so the receipt can carry every link without
 * rotating anything. The tokens must cover every live memory of exactly one
 * send (C2). The anchor's lease is shortened to a brief grace in its own
 * statement (so the cron takes over soon if this request dies, and never while
 * it is still running), then the receipt is sent outside any transaction. The
 * receipt carries no uploaded picture (issue #46, review #6), so nothing waits
 * for thumbnails (the D16 wait is gone with them). Email problems are reported
 * and never hide the links; `already_sent` and `in_progress` count as emailed.
 * The admin alerts, one per live memory, run after the response (D18) and
 * share one wait for their pictures (T14); the receipt never waits.
 */
export async function completeSubmission(raw: unknown): Promise<CompleteSubmissionResult> {
  const parsed = completeSubmissionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const { claimTokens } = parsed.data;
  const db = getDb();
  const hashes = claimTokens.map(hashClaimToken);
  const matched = await db.memory.findMany({ where: { claimTokenHash: { in: hashes } }, select: { id: true, submissionId: true, deletedAt: true } });
  const submissionId = matched[0]?.submissionId ?? null;
  if (matched.length !== claimTokens.length || submissionId === null || matched.some((m) => m.submissionId !== submissionId)) {
    return { ok: false, code: "not_found" };
  }
  const liveOfSend = await db.memory.findMany({ where: { submissionId, deletedAt: null }, select: { id: true } });
  const matchedIds = new Set(matched.filter((m) => m.deletedAt === null).map((m) => m.id));
  if (liveOfSend.length !== matchedIds.size || liveOfSend.some((m) => !matchedIds.has(m.id))) {
    return { ok: false, code: "not_found" };
  }
  const anchorId = (await db.memory.findMany({ where: { submissionId, submissionIndex: 0 }, select: { id: true } }))[0]?.id;
  if (!anchorId) {
    return { ok: false, code: "not_found" };
  }
  tagIds({ submissionId, memoryId: anchorId });

  // Its own statement, committed before anything slow: the lease shrinks to a short grace, so the cron
  // finishes the send a couple of minutes after a request that dies here, and never during a live one.
  await db.memory.updateMany({ where: { submissionId, submissionIndex: 0 }, data: { uploadLeaseUntil: new Date(Date.now() + COMPLETION_GRACE_MS) } });

  let emailed = false;
  try {
    const result = await confirmSubmission({ anchorId, claimTokens });
    emailed = result.sent || (!result.sent && (result.skipped === "already_sent" || result.skipped === "in_progress"));
  } catch (error) {
    await logErrorAndFlush("send receipt failed after completion", error, { category: "email", memoryId: anchorId });
  }

  const liveIds = liveOfSend.map((m) => m.id);
  afterWithFlush("completion.admin_alerts", async () => {
    // One preview deadline for the whole send (T14, C22): N alerts wait at most ADMIN_PREVIEW_WAIT_MS in all, not each.
    const previewsUntil = Date.now() + ADMIN_PREVIEW_WAIT_MS;
    for (const memoryId of liveIds) {
      // The send is settled: alert with what arrived, whatever is still marked in flight.
      await notifyAdminsQuietly(memoryId, { settleNow: true, previewsUntil });
    }
  });
  log.info({ action: "submission_completed", memoryId: anchorId, memories: liveIds.length, emailed }, "submission completed");
  return { ok: true, emailed };
}
