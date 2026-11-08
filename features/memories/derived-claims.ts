import "server-only";

import { lockMemory, type Tx } from "@/features/memories/lock";
import type { DerivedKind as AnyDerivedKind } from "@/generated/prisma/client";
import { derivedKeyFor } from "@/lib/derived-keys";
import { logError } from "@/lib/logger";
import { getDb } from "@/server/db/client";
import { DERIVE_DEFAULTS, type Encoded } from "@/services/images";
import { createStorageService } from "@/services/storage";

/**
 * The claim/publish protocol every server-made copy of an original goes through (plan P4/P18; video-posters
 * plan T5 [C35]), kind-generic so the photo copies (`derive-media.ts`) and the video poster share one
 * implementation:
 *
 * 1. CLAIM (`claimKind`): a PENDING row that already carries its candidate blob pathname, so a crash or a lost
 *    race can never leave an untracked blob. A stale or retryable row is reclaimed by a conditional update first;
 *    only then is its previous candidate ours to delete.
 * 2. The caller does its work and writes each copy to its claimed key.
 * 3. PUBLISH (`publishClaims`): under the memory lock, a conditional update that only the holder of this exact
 *    claim can satisfy. Blob deletes never run while the lock is held.
 * 4. On any failure the caller hands its claims to `failClaims`, which never throws.
 */

/** Neon computes can take a couple of seconds to wake; Prisma's defaults (2 s / 5 s) are too tight. */
const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

/** A PENDING claim older than this is presumed abandoned (crashed or killed function) and may be taken over. */
export const STALE_CLAIM_MS = 10 * 60_000;
/** Attempts a row may consume (fresh claims and reclaims alike) before it is left FAILED for good. */
export const MAX_DECODE_ATTEMPTS = 3;
/** The photo decoder's pixel ceiling, and the default one `too_many_pixels:<limit>` refusals are judged against. */
export const MAX_PIXELS = DERIVE_DEFAULTS.maxPixels;

/** Every kind of server-made copy: the schema's `DerivedKind` (WEB_IMAGE, THUMBNAIL and POSTER). */
export type ClaimKind = AnyDerivedKind;

/** The fields of a DerivedMedia row the claim rules read. */
export interface ExistingDerivedRow {
  id: string;
  status: "PENDING" | "READY" | "FAILED";
  storageKey: string;
  error: string | null;
  attempts: number;
  claimedAt: Date | null;
}

/** A row this run holds. */
export interface DerivedClaim<K extends ClaimKind> {
  kind: K;
  id: string;
  storageKey: string;
  /** The attempt number this claim holds; publishing and failing are conditional on it. */
  attempts: number;
}

/**
 * What one kind's claim came to when it did not produce a claim: the row is READY or failed for good
 * (`not_eligible`), another worker holds or just won it (`claimed_elsewhere`), or a stale claim that had used up its
 * attempts was retired as `abandoned` (`failed`).
 */
export type ClaimResult<K extends ClaimKind> = { claim: DerivedClaim<K> } | { outcome: "not_eligible" | "claimed_elsewhere" | "failed" };

/** What publishing one claim came to. */
export type PublishOutcome = "derived" | "failed" | "claimed_elsewhere";

/** The encoded copy for a claim, or the thumbnail encoder's verdict that even the fallback quality is over budget. */
export type ClaimEncoded = Encoded | { failed: "too_large" };

/** The original as re-read under the memory lock; handed to `whileLocked`. */
export interface LiveOriginal {
  id: string;
  width: number | null;
  height: number | null;
}

function isPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

/**
 * The one eligibility rule, shared with cron step (g): no row, a stale claim
 * with attempts left, a retryable failure with attempts left, or a pixel
 * refusal made under a ceiling other than today's (one retry converges the row).
 * A stale claim that has used up its attempts is `exhausted` and is retired.
 * READY rows and terminal failures are never touched. `maxPixels` is the
 * caller's ceiling; photos use the decoder's (`MAX_PIXELS`).
 */
export function isEligible(row: ExistingDerivedRow | null, now: Date, maxPixels: number = MAX_PIXELS): "eligible" | "exhausted" | "claimed_elsewhere" | "not_eligible" {
  if (row === null) {
    return "eligible";
  }
  if (row.status === "PENDING") {
    // Every claim sets claimedAt; a null is a hand-edited row and is treated as stale.
    const stale = row.claimedAt === null || row.claimedAt.getTime() < now.getTime() - STALE_CLAIM_MS;
    if (!stale) {
      return "claimed_elsewhere";
    }
    return row.attempts >= MAX_DECODE_ATTEMPTS ? "exhausted" : "eligible";
  }
  if (row.status === "FAILED") {
    if ((row.error === "decode_failed" || row.error === "timeout") && row.attempts < MAX_DECODE_ATTEMPTS) {
      return "eligible";
    }
    if (row.error?.startsWith("too_many_pixels:")) {
      const limit = Number(row.error.slice("too_many_pixels:".length));
      return Number.isFinite(limit) && limit !== maxPixels ? "eligible" : "not_eligible";
    }
  }
  return "not_eligible";
}

/** Delete a blob without ever throwing (del is idempotent; a miss is logged and forgotten). */
export async function quietDel(storageKey: string, mediaId: string): Promise<void> {
  try {
    await createStorageService().del(storageKey);
  } catch (error) {
    logError("derived blob could not be deleted", error, { category: "upload", mediaId });
  }
}

/**
 * Claim one kind of copy of the original at `originalKey`. `existing` is that kind's row as the caller last read it
 * (or null): no row → create it PENDING with a fresh candidate key (a unique-constraint loss re-reads the row and
 * judges it); an exhausted stale claim → retired FAILED `abandoned`, its candidate deleted; an eligible row →
 * reclaimed with a new key by a conditional update, and only then is the previous candidate deleted.
 * Anything other than a unique-constraint loss is thrown for the caller to fail the claims it already holds.
 */
export async function claimKind<K extends ClaimKind>({
  mediaId,
  kind,
  existing: current,
  originalKey,
  extension,
  now,
  maxPixels,
}: {
  mediaId: string;
  kind: K;
  existing: ExistingDerivedRow | null;
  originalKey: string;
  extension: string;
  now: Date;
  maxPixels?: number;
}): Promise<ClaimResult<K>> {
  const db = getDb();
  let existing = current;
  if (existing === null) {
    const storageKey = derivedKeyFor(originalKey, extension);
    try {
      const created = await db.derivedMedia.create({ data: { mediaId, kind, status: "PENDING", storageKey, claimedAt: now, attempts: 1 } });
      return { claim: { kind, id: created.id, storageKey, attempts: 1 } };
    } catch (error) {
      if (!isPrismaCode(error, "P2002")) {
        throw error;
      }
      existing = await db.derivedMedia.findFirst({ where: { mediaId, kind } });
    }
  }
  if (existing === null) {
    return { outcome: "claimed_elsewhere" };
  }
  const verdict = isEligible(existing, now, maxPixels);
  if (verdict === "not_eligible" || verdict === "claimed_elsewhere") {
    return { outcome: verdict };
  }
  if (verdict === "exhausted") {
    // Retired for good; its candidate goes with it. Conditional, so a worker that just published wins.
    const retired = await db.derivedMedia.updateMany({
      where: { id: existing.id, status: existing.status, claimedAt: existing.claimedAt, attempts: existing.attempts },
      data: { status: "FAILED", error: "abandoned" },
    });
    if (retired.count === 1) {
      await quietDel(existing.storageKey, mediaId);
      return { outcome: "failed" };
    }
    return { outcome: "claimed_elsewhere" };
  }
  // Reclaim: take the row with a new key FIRST; only then is the previous candidate ours to delete.
  const previousKey = existing.storageKey;
  const storageKey = derivedKeyFor(originalKey, extension);
  const nextAttempts = existing.attempts + 1;
  const taken = await db.derivedMedia.updateMany({
    where: { id: existing.id, status: existing.status, claimedAt: existing.claimedAt, attempts: existing.attempts },
    data: { status: "PENDING", claimedAt: now, attempts: { increment: 1 }, error: null, storageKey },
  });
  if (taken.count === 1) {
    await quietDel(previousKey, mediaId);
    return { claim: { kind, id: existing.id, storageKey, attempts: nextAttempts } };
  }
  return { outcome: "claimed_elsewhere" };
}

/**
 * Mark every claim FAILED with `error` (conditionally: only a row still PENDING under this exact claim) and delete
 * only the candidates still ours. Never throws: a row that cannot be failed is logged and lapses as a stale claim.
 */
export async function failClaims<K extends ClaimKind>(claims: readonly DerivedClaim<K>[], { mediaId, now, error }: { mediaId: string; now: Date; error: string }): Promise<void> {
  for (const claim of claims) {
    try {
      const failed = await getDb().derivedMedia.updateMany({
        where: { id: claim.id, status: "PENDING", claimedAt: now, attempts: claim.attempts },
        data: { status: "FAILED", error },
      });
      if (failed.count === 1) {
        await quietDel(claim.storageKey, mediaId);
      }
    } catch (cleanupError) {
      logError("derived claim could not be failed", cleanupError, { category: "upload", mediaId });
    }
  }
}

/**
 * Publish the claims under the memory lock; only the holder of each exact claim can. A claim whose copy is missing
 * or `too_large` is recorded FAILED `too_large`. If the original went away meanwhile, every claim is dropped and its
 * candidate deleted. `whileLocked` runs last inside the same transaction, only while the original is live (the photo
 * path fills the original's dimensions there; a poster passes none, D6). Candidates are deleted after the commit,
 * never while the lock is held. A failed transaction throws, with no blob deleted, for the caller to `failClaims`.
 */
export async function publishClaims<K extends ClaimKind>({
  mediaId,
  memoryId,
  claims,
  now,
  encodedFor,
  whileLocked,
}: {
  mediaId: string;
  memoryId: string;
  claims: readonly DerivedClaim<K>[];
  now: Date;
  encodedFor: (kind: K) => ClaimEncoded | undefined;
  whileLocked?: (tx: Tx, live: LiveOriginal) => Promise<void>;
}): Promise<Partial<Record<K, PublishOutcome>>> {
  const { outcomes, keysToDelete } = await getDb().$transaction(async (tx: Tx) => {
    const outcomes: Partial<Record<K, PublishOutcome>> = {};
    const keysToDelete: string[] = [];
    await lockMemory(tx, memoryId);
    const live = await tx.media.findFirst({ where: { id: mediaId, deletedAt: null, status: "READY" }, select: { id: true, width: true, height: true, memory: { select: { deletedAt: true } } } });
    if (!live || live.memory.deletedAt !== null) {
      // The original went away while we worked: drop our claims so nothing waits ten minutes for them.
      await tx.derivedMedia.deleteMany({ where: { id: { in: claims.map((c) => c.id) }, status: "PENDING", claimedAt: now } });
      for (const claim of claims) {
        keysToDelete.push(claim.storageKey);
        outcomes[claim.kind] = "claimed_elsewhere";
      }
      return { outcomes, keysToDelete };
    }
    for (const claim of claims) {
      const encoded = encodedFor(claim.kind);
      const where = { id: claim.id, status: "PENDING" as const, claimedAt: now, attempts: claim.attempts };
      if (!encoded || "failed" in encoded) {
        const marked = await tx.derivedMedia.updateMany({ where, data: { status: "FAILED", error: "too_large" } });
        outcomes[claim.kind] = marked.count === 1 ? "failed" : "claimed_elsewhere";
        continue;
      }
      const published = await tx.derivedMedia.updateMany({
        where,
        data: { status: "READY", mimeType: encoded.mimeType, sizeBytes: encoded.data.byteLength, width: encoded.width, height: encoded.height, error: null },
      });
      if (published.count === 1) {
        outcomes[claim.kind] = "derived";
      } else {
        keysToDelete.push(claim.storageKey);
        outcomes[claim.kind] = "claimed_elsewhere";
      }
    }
    if (whileLocked) {
      await whileLocked(tx, live);
    }
    return { outcomes, keysToDelete };
  }, TX_OPTIONS);
  for (const key of keysToDelete) {
    await quietDel(key, mediaId);
  }
  return outcomes;
}
