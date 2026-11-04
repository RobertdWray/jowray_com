import "server-only";

import { z } from "zod";

import { lockMemory } from "@/features/memories/lock";
import { appendClaimRevision, hasWords, LIVE_MEDIA_ORDER, recomputeMemoryType, visibleMediaIds } from "@/features/memories/media-state";
import { hashClaimToken } from "@/lib/claim-token";
import { createLogger } from "@/lib/logger";
import { claimMediaRefSchema, mediaWordsRequestSchema } from "@/lib/validations/media";
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
});
export type ClaimChanges = z.infer<typeof claimChangesSchema>;

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
  approxDateText: string | null;
  place: string | null;
  contributorNote: string | null;
  visibility: "PUBLIC" | "FAMILY" | "PRIVATE";
  contributor: { name: string | null; relationship: string | null; email: string | null } | null;
  /** Every live file (not removed), whatever its status, in display order. */
  media: ClaimMediaView[];
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
      contributor: { select: { name: true, relationship: true, email: true } },
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
  return {
    id: memory.id,
    type: memory.type,
    approxDateText: memory.approxDateText,
    place: memory.place,
    contributorNote: memory.contributorNote,
    visibility: memory.visibility,
    contributor: memory.contributor,
    media: memory.media.map(({ id, status, mimeType, originalFilename, sortOrder, replacesMediaId, durationSeconds, caption, approxDateText, place, derivatives }) => ({
      id,
      status,
      web: webCopyState(derivatives?.[0] ?? null),
      mimeType,
      originalFilename,
      sortOrder,
      replacesMediaId,
      durationSeconds,
      caption,
      approxDateText,
      place,
    })),
  };
}

export type ClaimUpdateResult = { ok: true } | { ok: false; code: "invalid" | "not_found" | "last_words" };

/**
 * Apply an edit from the claim page and append a MemoryRevision with the
 * before/after snapshot (changedVia CLAIM_LINK). The first revision also
 * records the consent version in force. Soft-deleted memories are ignored.
 * The note cannot be cleared while no READY file remains (`last_words`).
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
      select: { deletedAt: true, approxDateText: true, place: true, contributorNote: true, visibility: true, contributor: { select: { id: true, name: true, relationship: true } } },
    });
    if (fresh.deletedAt !== null) {
      return "not_found" as const;
    }
    const before = {
      name: fresh.contributor?.name ?? null,
      relationship: fresh.contributor?.relationship ?? null,
      approxDateText: fresh.approxDateText,
      place: fresh.place,
      contributorNote: fresh.contributorNote,
      visibility: fresh.visibility,
    };
    const after = {
      name: input.name === undefined ? before.name : input.name,
      relationship: input.relationship === undefined ? before.relationship : input.relationship,
      approxDateText: input.approxDateText === undefined ? before.approxDateText : input.approxDateText,
      place: input.place === undefined ? before.place : input.place,
      contributorNote: input.note === undefined ? before.contributorNote : input.note,
      visibility: input.visibility ?? before.visibility,
    };
    if (hasWords(before.contributorNote) && !hasWords(after.contributorNote)) {
      const readyFiles = await tx.media.count({ where: { memoryId: memory.id, deletedAt: null, status: "READY" } });
      if (readyFiles === 0) {
        return "last_words" as const;
      }
    }
    await tx.memory.update({
      where: { id: memory.id },
      data: { approxDateText: after.approxDateText, place: after.place, contributorNote: after.contributorNote, visibility: after.visibility },
    });
    if (fresh.contributor && (after.name !== before.name || after.relationship !== before.relationship)) {
      await tx.contributor.update({ where: { id: fresh.contributor.id }, data: { name: after.name, relationship: after.relationship } });
    }
    if (hasWords(before.contributorNote) !== hasWords(after.contributorNote)) {
      await recomputeMemoryType(tx, memory.id, after.contributorNote);
    }
    await appendClaimRevision(tx, { memoryId: memory.id, before, after, consentVersion: memory.consentVersion });
    return "ok" as const;
  }, TX_OPTIONS);

  if (result !== "ok") {
    return { ok: false, code: result };
  }
  log.info({ action: "claim_edit" }, "memory edited through its claim link");
  return { ok: true };
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
    const fresh = await tx.memory.findUniqueOrThrow({ where: { id: memory.id }, select: { deletedAt: true, contributorNote: true, type: true, consentVersion: true } });
    if (fresh.deletedAt !== null) {
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
    const memory = await tx.memory.findUnique({ where: { claimTokenHash }, select: { id: true, deletedAt: true, consentVersion: true } });
    if (!memory || memory.deletedAt !== null) {
      return "not_found" as const;
    }
    await lockMemory(tx, memory.id);
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
    await appendClaimRevision(tx, { memoryId: memory.id, before, after, consentVersion: memory.consentVersion });
    return "ok" as const;
  }, TX_OPTIONS);
  if (result !== "ok") {
    return { ok: false, code: result };
  }
  log.info({ action: "media_edit", mediaId }, "file words edited through the claim link");
  return { ok: true };
}
