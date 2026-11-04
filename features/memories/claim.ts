import "server-only";

import { z } from "zod";

import { lockMemory } from "@/features/memories/lock";
import { appendClaimRevision, hasWords, LIVE_MEDIA_ORDER, recomputeMemoryType, visibleMediaIds } from "@/features/memories/media-state";
import { hashClaimToken } from "@/lib/claim-token";
import { createLogger } from "@/lib/logger";
import { claimMediaRefSchema, mediaWordsRequestSchema } from "@/lib/validations/media";
import { getMemorialEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";

const log = createLogger({ category: "api" });
/** Neon computes can take a couple of seconds to wake; Prisma's defaults (2 s / 5 s) are too tight. */
const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

export const claimChangesSchema = z.object({
  name: optional(120),
  relationship: optional(120),
  approxDateText: optional(120),
  place: optional(200),
  note: z
    .string()
    .max(10_000)
    .transform((v) => (v.trim().length === 0 ? null : v))
    .nullable()
    .optional(),
  visibility: z.enum(["PUBLIC", "FAMILY", "PRIVATE"]).optional(),
  /** Press of "Share this memory" on a DRAFT: the act of sharing, which stamps consent. Ignored on any other status. */
  share: z.boolean().optional(),
  notifyWhenPosted: z.boolean().optional(),
  contactOptIn: z.boolean().optional(),
});
export type ClaimChanges = z.infer<typeof claimChangesSchema>;

export type MemoryStatus = "DRAFT" | "PENDING" | "APPROVED" | "HIDDEN";

export type MediaStatus = "PENDING" | "READY" | "FAILED";

/** State of a photo's sanitized web copy; non-photos are always `none`. */
export interface WebCopyState {
  status: "ready" | "pending" | "failed" | "none";
  mimeType: string | null;
}

export interface ClaimMediaView {
  id: string;
  status: MediaStatus;
  web: WebCopyState;
  mimeType: string;
  originalFilename: string | null;
  sortOrder: number;
  durationSeconds: number | null;
  /** The reservation's ceiling (the kind's maximum, or the declared size for a send): a "Try again" file must fit it. */
  maxBytes: number;
  /** The contributor's words for this file; the memory's note is the shared story. */
  caption: string | null;
  approxDateText: string | null;
  place: string | null;
  /** Set when this row is a pending replacement for another live file. */
  replacesMediaId: string | null;
}

export interface ClaimView {
  id: string;
  type: "VOICE" | "VIDEO" | "PHOTO" | "TEXT";
  /** DRAFT: saved by the family admin on this person's behalf; the page offers one button, Share. */
  status: MemoryStatus;
  approxDateText: string | null;
  place: string | null;
  contributorNote: string | null;
  visibility: "PUBLIC" | "FAMILY" | "PRIVATE";
  notifyWhenPosted: boolean;
  contributor: { name: string | null; relationship: string | null; email: string | null; contactOptIn: boolean } | null;
  /** Every live file (not removed), whatever its status, in display order. */
  media: ClaimMediaView[];
  /** Set when the memory was sent together with others (Task 15): its 1-based place and how many of them are still live. */
  submission: { position: number; count: number } | null;
}

function webCopyState(row: { status: "PENDING" | "READY" | "FAILED"; mimeType: string | null } | null): WebCopyState {
  if (!row) {
    return { status: "none", mimeType: null };
  }
  return { status: row.status === "READY" ? "ready" : row.status === "PENDING" ? "pending" : "failed", mimeType: row.mimeType };
}

/** The memory behind a claim token with its live media (any status), or null. */
export async function getMemoryForClaim(claimToken: string): Promise<ClaimView | null> {
  const memory = await getDb().memory.findUnique({
    where: { claimTokenHash: hashClaimToken(claimToken) },
    include: {
      contributor: { select: { name: true, relationship: true, email: true, contactOptIn: true } },
      media: {
        where: { deletedAt: null },
        select: {
          id: true,
          status: true,
          mimeType: true,
          originalFilename: true,
          sortOrder: true,
          replacesMediaId: true,
          durationSeconds: true,
          maxBytes: true,
          caption: true,
          approxDateText: true,
          place: true,
          derivatives: { where: { kind: "WEB_IMAGE" }, select: { status: true, mimeType: true } },
        },
        orderBy: [...LIVE_MEDIA_ORDER],
      },
    },
  });
  if (!memory || memory.deletedAt !== null) {
    return null;
  }
  const submission =
    memory.submissionId !== null
      ? { position: (memory.submissionIndex ?? 0) + 1, count: await getDb().memory.count({ where: { submissionId: memory.submissionId, deletedAt: null } }) }
      : null;
  return {
    id: memory.id,
    type: memory.type,
    status: memory.status,
    approxDateText: memory.approxDateText,
    place: memory.place,
    contributorNote: memory.contributorNote,
    visibility: memory.visibility,
    notifyWhenPosted: memory.notifyWhenPosted,
    contributor: memory.contributor,
    submission,
    media: memory.media.map(({ id, status, mimeType, originalFilename, sortOrder, replacesMediaId, durationSeconds, maxBytes, caption, approxDateText, place, derivatives }) => ({
      id,
      status,
      web: webCopyState(derivatives?.[0] ?? null),
      mimeType,
      originalFilename,
      sortOrder,
      replacesMediaId,
      durationSeconds,
      maxBytes,
      caption,
      approxDateText,
      place,
    })),
  };
}

export type ClaimUpdateResult = { ok: true; shared: boolean } | { ok: false; code: "invalid" | "not_found" | "last_words" };

/**
 * Apply an edit from the claim page and append a MemoryRevision with the
 * before/after snapshot (changedVia CLAIM_LINK). The first revision also
 * records the consent version in force. Soft-deleted memories are ignored.
 * The note cannot be cleared while no READY file remains (`last_words`).
 *
 * `share` on a DRAFT (a memory the family admin saved on this person's
 * behalf) is the act of sharing: the memory becomes PENDING and `consentedAt`
 * / `consentVersion` are stamped then, under the same lock. On any other
 * status `share` is ignored, so a repeated press never restamps consent. No
 * email is sent here (site-email.ts). `shared` in the result says whether
 * this call made the transition.
 */
export async function updateMemoryFromClaim({ claimToken, changes }: { claimToken: string; changes: unknown }): Promise<ClaimUpdateResult> {
  const parsed = claimChangesSchema.safeParse(changes);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const input = parsed.data;
  const claimTokenHash = hashClaimToken(claimToken);

  const result = await getDb().$transaction(async (tx) => {
    const memory = await tx.memory.findUnique({
      where: { claimTokenHash },
      include: { contributor: { select: { id: true, name: true, relationship: true } } },
    });
    if (!memory || memory.deletedAt !== null) {
      return "not_found" as const;
    }
    await lockMemory(tx, memory.id);
    // Re-read under the lock: the invariants below must see what a concurrent editor committed first.
    const fresh = await tx.memory.findUniqueOrThrow({
      where: { id: memory.id },
      select: {
        deletedAt: true,
        claimTokenHash: true,
        consentVersion: true,
        status: true,
        consentedAt: true,
        approxDateText: true,
        place: true,
        contributorNote: true,
        visibility: true,
        notifyWhenPosted: true,
        contributor: { select: { id: true, name: true, relationship: true, contactOptIn: true } },
      },
    });
    // A link rotated while this request waited for the lock (an admin reissue) must not act.
    if (fresh.deletedAt !== null || fresh.claimTokenHash !== claimTokenHash) {
      return "not_found" as const;
    }
    const sharing = fresh.status === "DRAFT" && input.share === true;
    // On a DRAFT the preferences are given by pressing Share, never by a plain edit.
    const preferencesEditable = sharing || fresh.status !== "DRAFT";
    const before = {
      name: fresh.contributor?.name ?? null,
      relationship: fresh.contributor?.relationship ?? null,
      approxDateText: fresh.approxDateText,
      place: fresh.place,
      contributorNote: fresh.contributorNote,
      visibility: fresh.visibility,
      notifyWhenPosted: fresh.notifyWhenPosted,
      contactOptIn: fresh.contributor?.contactOptIn ?? false,
      // Named only when they change (a Share), so ordinary edits keep their compact snapshots.
      ...(sharing && { status: fresh.status, consentedAt: fresh.consentedAt }),
    };
    const consent = sharing ? { consentedAt: new Date(), consentVersion: getMemorialEnv().CONSENT_VERSION } : null;
    const after = {
      name: input.name === undefined ? before.name : input.name,
      relationship: input.relationship === undefined ? before.relationship : input.relationship,
      approxDateText: input.approxDateText === undefined ? before.approxDateText : input.approxDateText,
      place: input.place === undefined ? before.place : input.place,
      contributorNote: input.note === undefined ? before.contributorNote : input.note,
      visibility: input.visibility ?? before.visibility,
      notifyWhenPosted: preferencesEditable ? (input.notifyWhenPosted ?? before.notifyWhenPosted) : before.notifyWhenPosted,
      contactOptIn: preferencesEditable ? (input.contactOptIn ?? before.contactOptIn) : before.contactOptIn,
      ...(consent && { status: "PENDING" as const, ...consent }),
    };
    if (hasWords(before.contributorNote) && !hasWords(after.contributorNote)) {
      const readyFiles = await tx.media.count({ where: { memoryId: memory.id, deletedAt: null, status: "READY" } });
      if (readyFiles === 0) {
        return "last_words" as const;
      }
    }
    await tx.memory.update({
      where: { id: memory.id },
      data: {
        approxDateText: after.approxDateText,
        place: after.place,
        contributorNote: after.contributorNote,
        visibility: after.visibility,
        notifyWhenPosted: after.notifyWhenPosted,
        ...(consent && { status: "PENDING", ...consent }),
      },
    });
    if (fresh.contributor && (after.name !== before.name || after.relationship !== before.relationship || after.contactOptIn !== before.contactOptIn)) {
      await tx.contributor.update({ where: { id: fresh.contributor.id }, data: { name: after.name, relationship: after.relationship, contactOptIn: after.contactOptIn } });
    }
    if (hasWords(before.contributorNote) !== hasWords(after.contributorNote)) {
      await recomputeMemoryType(tx, memory.id, after.contributorNote);
    }
    await appendClaimRevision(tx, { memoryId: memory.id, before, after, consentVersion: consent?.consentVersion ?? fresh.consentVersion });
    return sharing ? ("shared" as const) : ("ok" as const);
  }, TX_OPTIONS);

  if (result !== "ok" && result !== "shared") {
    return { ok: false, code: result };
  }
  if (result === "shared") {
    log.info({ action: "draft_shared" }, "drafted memory shared by its contributor");
  } else {
    log.info({ action: "claim_edit" }, "memory edited through its claim link");
  }
  return { ok: true, shared: result === "shared" };
}

export type ClaimMediaResult = { ok: true } | { ok: false; code: "invalid" | "not_found" | "last_file" };

/**
 * Soft-delete one of the memory's files from its claim page. READY files are
 * "removed"; PENDING/FAILED rows are "cancelled" reservations. Both run under
 * the memory lock, cancel any pending replacement of the target, recompute the
 * memory's type and append a revision whose before/after list the visible
 * media ids. The last READY file of a memory without words stays (`last_file`).
 */
async function retireMedia(raw: unknown, statuses: MediaStatus[], action: "remove" | "cancel"): Promise<ClaimMediaResult> {
  const parsed = claimMediaRefSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const { claimToken, mediaId } = parsed.data;
  const claimTokenHash = hashClaimToken(claimToken);

  const result = await getDb().$transaction(async (tx) => {
    const memory = await tx.memory.findUnique({ where: { claimTokenHash } });
    if (!memory || memory.deletedAt !== null) {
      return "not_found" as const;
    }
    await lockMemory(tx, memory.id);
    // Re-read under the lock: a note cleared by a concurrent editor must count here.
    const fresh = await tx.memory.findUniqueOrThrow({ where: { id: memory.id }, select: { deletedAt: true, claimTokenHash: true, contributorNote: true, type: true, consentVersion: true } });
    if (fresh.deletedAt !== null || fresh.claimTokenHash !== claimTokenHash) {
      return "not_found" as const;
    }
    const target = await tx.media.findFirst({ where: { id: mediaId, memoryId: memory.id, deletedAt: null, status: { in: statuses } } });
    if (!target) {
      return "not_found" as const;
    }
    if (target.status === "READY" && !hasWords(fresh.contributorNote)) {
      const readyFiles = await tx.media.count({ where: { memoryId: memory.id, deletedAt: null, status: "READY" } });
      if (readyFiles <= 1) {
        return "last_file" as const;
      }
    }
    const before = { mediaIds: await visibleMediaIds(tx, memory.id), type: fresh.type };
    const now = new Date();
    await tx.media.update({ where: { id: target.id }, data: { deletedAt: now } });
    await tx.media.updateMany({ where: { memoryId: memory.id, replacesMediaId: target.id, deletedAt: null, status: "PENDING" }, data: { deletedAt: now } });
    const type = (await recomputeMemoryType(tx, memory.id, fresh.contributorNote)) ?? fresh.type;
    const after = {
      mediaIds: await visibleMediaIds(tx, memory.id),
      type,
      // A cancelled replacement is invisible in mediaIds on both sides; name it so the revision is not a no-op.
      ...(target.replacesMediaId !== null && { cancelledReplacementOf: target.replacesMediaId }),
    };
    await appendClaimRevision(tx, { memoryId: memory.id, before, after, consentVersion: fresh.consentVersion });
    return { memoryId: memory.id };
  }, TX_OPTIONS);

  if (typeof result === "string") {
    return { ok: false, code: result };
  }
  log.info({ action: `media_${action}`, memoryId: result.memoryId, mediaId }, "file retired through the claim link");
  return { ok: true };
}

/** Remove a received file (soft delete; blobs are purged by the reconcile cron). */
export function removeMediaFromClaim(raw: unknown): Promise<ClaimMediaResult> {
  return retireMedia(raw, ["READY"], "remove");
}

/** Cancel a reservation that never arrived or was rejected, freeing its slot. */
export function cancelReservation(raw: unknown): Promise<ClaimMediaResult> {
  return retireMedia(raw, ["PENDING", "FAILED"], "cancel");
}

/**
 * Edit one file's own words (caption, rough date, place) from the claim page,
 * under the memory lock, with a CLAIM_LINK revision naming the file.
 */
export async function updateMediaFromClaim(raw: unknown): Promise<ClaimMediaResult> {
  const parsed = mediaWordsRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const { mediaId, changes: input } = parsed.data;
  const claimTokenHash = hashClaimToken(parsed.data.claimToken);
  const result = await getDb().$transaction(async (tx) => {
    const memory = await tx.memory.findUnique({ where: { claimTokenHash }, select: { id: true, deletedAt: true } });
    if (!memory || memory.deletedAt !== null) {
      return "not_found" as const;
    }
    await lockMemory(tx, memory.id);
    // Re-read under the lock: a link rotated while this request waited (an admin reissue) must not act.
    const fresh = await tx.memory.findUniqueOrThrow({ where: { id: memory.id }, select: { deletedAt: true, claimTokenHash: true, consentVersion: true } });
    if (fresh.deletedAt !== null || fresh.claimTokenHash !== claimTokenHash) {
      return "not_found" as const;
    }
    const target = await tx.media.findFirst({ where: { id: mediaId, memoryId: memory.id, deletedAt: null, status: "READY" } });
    if (!target) {
      return "not_found" as const;
    }
    const before = { mediaId: target.id, caption: target.caption, approxDateText: target.approxDateText, place: target.place };
    const after = {
      mediaId: target.id,
      caption: input.caption === undefined ? before.caption : input.caption,
      approxDateText: input.approxDateText === undefined ? before.approxDateText : input.approxDateText,
      place: input.place === undefined ? before.place : input.place,
    };
    const words = { caption: after.caption, approxDateText: after.approxDateText, place: after.place };
    await tx.media.update({ where: { id: target.id }, data: words });
    // A replacement still on its way copied the target's words when it was ticketed; keep it current so the swap cannot restore stale words.
    await tx.media.updateMany({ where: { memoryId: memory.id, replacesMediaId: target.id, status: "PENDING", deletedAt: null }, data: words });
    await appendClaimRevision(tx, { memoryId: memory.id, before, after, consentVersion: fresh.consentVersion });
    return "ok" as const;
  }, TX_OPTIONS);
  if (result !== "ok") {
    return { ok: false, code: result };
  }
  log.info({ action: "media_edit", mediaId }, "file words edited through the claim link");
  return { ok: true };
}
