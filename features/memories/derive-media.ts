import "server-only";

import { lockMemory, type Tx } from "@/features/memories/lock";
import { derivedKeyFor } from "@/lib/derived-keys";
import { isImageDeriveError } from "@/lib/image-derive-error";
import { createLogger, logError } from "@/lib/logger";
import { storagePrefix } from "@/lib/site-url";
import { getDb } from "@/server/db/client";
import { createImageService, DERIVE_DEFAULTS, type Encoded, webExtensionFor } from "@/services/images";
import { createStorageService } from "@/services/storage";

const log = createLogger({ category: "upload" });
/** Neon computes can take a couple of seconds to wake; Prisma's defaults (2 s / 5 s) are too tight. */
const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

export const DERIVED_KINDS = ["WEB_IMAGE", "THUMBNAIL"] as const;
export type DerivedKind = (typeof DERIVED_KINDS)[number];
export type DeriveOutcome = "derived" | "failed" | "not_eligible" | "claimed_elsewhere";
export type DeriveResult = Record<DerivedKind, DeriveOutcome>;

/** A PENDING claim older than this is presumed abandoned (crashed or killed function) and may be taken over. */
export const STALE_CLAIM_MS = 10 * 60_000;
/** Attempts a row may consume (fresh claims and reclaims alike) before it is left FAILED for good. */
export const MAX_DECODE_ATTEMPTS = 3;
export const MAX_PIXELS = DERIVE_DEFAULTS.maxPixels;

interface ExistingRow {
  id: string;
  status: "PENDING" | "READY" | "FAILED";
  storageKey: string;
  error: string | null;
  attempts: number;
  claimedAt: Date | null;
}

interface Claim {
  kind: DerivedKind;
  id: string;
  storageKey: string;
  /** The attempt number this claim holds; publishing and failing are conditional on it. */
  attempts: number;
}

function isPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

/**
 * The one eligibility rule, shared with cron step (g): no row, a stale claim
 * with attempts left, a retryable failure with attempts left, or a pixel
 * refusal made under a ceiling other than today's (one retry converges the row).
 * A stale claim that has used up its attempts is `exhausted` and is retired.
 * READY rows and terminal failures are never touched.
 */
export function isEligible(row: ExistingRow | null, now: Date): "eligible" | "exhausted" | "claimed_elsewhere" | "not_eligible" {
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
      return Number.isFinite(limit) && limit !== MAX_PIXELS ? "eligible" : "not_eligible";
    }
  }
  return "not_eligible";
}

async function streamToBuffer(stream: ReadableStream): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

/** Delete a blob without ever throwing (del is idempotent; a miss is logged and forgotten). */
async function quietDel(storageKey: string, mediaId: string): Promise<void> {
  try {
    await createStorageService().del(storageKey);
  } catch (error) {
    logError("derived blob could not be deleted", error, { category: "upload", mediaId });
  }
}

/**
 * Make the web copy and the email thumbnail of one READY image original.
 *
 * Protocol (plan P4/P18): every kind is CLAIMED first, as a PENDING row that
 * already carries its candidate blob pathname, so a crash or a lost race can
 * never leave an untracked blob. The original is then read and decoded once,
 * each copy is written to its candidate key, and each row is PUBLISHED under
 * the memory lock with a conditional update that only the holder of this
 * claim can satisfy. Blob deletes never run while the lock is held. Every
 * failure is recorded on the rows it owns; this function never throws.
 */
export async function deriveMedia({ mediaId, deadlineMs, now = new Date() }: { mediaId: string; deadlineMs: number; now?: Date }): Promise<DeriveResult> {
  const db = getDb();
  const storage = createStorageService();
  const result: DeriveResult = { WEB_IMAGE: "not_eligible", THUMBNAIL: "not_eligible" };
  const claims: Claim[] = [];

  /** Mark every claim this run holds FAILED (conditionally) and delete only the candidates it still owns. */
  const failClaims = async (error: string): Promise<void> => {
    for (const claim of claims) {
      try {
        const failed = await db.derivedMedia.updateMany({
          where: { id: claim.id, status: "PENDING", claimedAt: now, attempts: claim.attempts },
          data: { status: "FAILED", error },
        });
        if (failed.count === 1) {
          await quietDel(claim.storageKey, mediaId);
        }
      } catch (cleanupError) {
        logError("derived claim could not be failed", cleanupError, { category: "upload", mediaId });
      }
      result[claim.kind] = "failed";
    }
  };

  try {
    const media = await db.media.findUnique({
      where: { id: mediaId },
      include: { memory: { select: { deletedAt: true } }, derivatives: { where: { kind: { in: [...DERIVED_KINDS] } } } },
    });
    if (
      !media ||
      media.status !== "READY" ||
      media.deletedAt !== null ||
      media.memory.deletedAt !== null ||
      !media.mimeType.startsWith("image/") ||
      !media.storageKey.startsWith(storagePrefix())
    ) {
      return result;
    }

    // 1. Claim.
    for (const kind of DERIVED_KINDS) {
      const extension = kind === "THUMBNAIL" ? "jpg" : webExtensionFor(media.mimeType);
      let existing: ExistingRow | null = media.derivatives.find((d) => d.kind === kind) ?? null;
      if (existing === null) {
        const storageKey = derivedKeyFor(media.storageKey, extension);
        try {
          const created = await db.derivedMedia.create({ data: { mediaId, kind, status: "PENDING", storageKey, claimedAt: now, attempts: 1 } });
          claims.push({ kind, id: created.id, storageKey, attempts: 1 });
          continue;
        } catch (error) {
          if (!isPrismaCode(error, "P2002")) {
            throw error;
          }
          existing = await db.derivedMedia.findFirst({ where: { mediaId, kind } });
        }
      }
      if (existing === null) {
        result[kind] = "claimed_elsewhere";
        continue;
      }
      const verdict = isEligible(existing, now);
      if (verdict === "not_eligible" || verdict === "claimed_elsewhere") {
        result[kind] = verdict;
        continue;
      }
      if (verdict === "exhausted") {
        // Retired for good; its candidate goes with it. Conditional, so a worker that just published wins.
        const retired = await db.derivedMedia.updateMany({
          where: { id: existing.id, status: existing.status, claimedAt: existing.claimedAt, attempts: existing.attempts },
          data: { status: "FAILED", error: "abandoned" },
        });
        if (retired.count === 1) {
          await quietDel(existing.storageKey, mediaId);
          result[kind] = "failed";
        } else {
          result[kind] = "claimed_elsewhere";
        }
        continue;
      }
      // Reclaim: take the row with a new key FIRST; only then is the previous candidate ours to delete.
      const previousKey = existing.storageKey;
      const storageKey = derivedKeyFor(media.storageKey, extension);
      const nextAttempts = existing.attempts + 1;
      const taken = await db.derivedMedia.updateMany({
        where: { id: existing.id, status: existing.status, claimedAt: existing.claimedAt, attempts: existing.attempts },
        data: { status: "PENDING", claimedAt: now, attempts: { increment: 1 }, error: null, storageKey },
      });
      if (taken.count === 1) {
        claims.push({ kind, id: existing.id, storageKey, attempts: nextAttempts });
        await quietDel(previousKey, mediaId);
      } else {
        result[kind] = "claimed_elsewhere";
      }
    }
    if (claims.length === 0) {
      return result;
    }

    // 2. Read and decode once.
    const file = await storage.get(media.storageKey);
    if (!file) {
      await failClaims("decode_failed");
      log.warn({ action: "derive_missing_original", mediaId }, "original blob not found");
      return result;
    }
    const input = await streamToBuffer(file.stream);
    const derived = await createImageService().derive(input, { ...DERIVE_DEFAULTS, sourceMime: media.mimeType, deadlineMs });

    // 3. Write each copy to its claimed key.
    const encodedByKind = new Map<DerivedKind, Encoded | { failed: "too_large" }>([
      ["WEB_IMAGE", derived.web],
      ["THUMBNAIL", derived.thumb],
    ]);
    for (const claim of claims) {
      const encoded = encodedByKind.get(claim.kind);
      if (encoded && !("failed" in encoded)) {
        await storage.put(claim.storageKey, encoded.data, encoded.mimeType);
      }
    }

    // 4. Publish under the memory lock; only the holder of this exact claim can. No network inside the lock.
    const keysToDelete: string[] = [];
    await db.$transaction(async (tx: Tx) => {
      await lockMemory(tx, media.memoryId);
      const live = await tx.media.findFirst({ where: { id: mediaId, deletedAt: null, status: "READY" }, select: { id: true, width: true, height: true, memory: { select: { deletedAt: true } } } });
      if (!live || live.memory.deletedAt !== null) {
        // The original went away while we worked: drop our claims so nothing waits ten minutes for them.
        await tx.derivedMedia.deleteMany({ where: { id: { in: claims.map((c) => c.id) }, status: "PENDING", claimedAt: now } });
        for (const claim of claims) {
          keysToDelete.push(claim.storageKey);
          result[claim.kind] = "claimed_elsewhere";
        }
        return;
      }
      for (const claim of claims) {
        const encoded = encodedByKind.get(claim.kind);
        const where = { id: claim.id, status: "PENDING" as const, claimedAt: now, attempts: claim.attempts };
        if (!encoded || "failed" in encoded) {
          const marked = await tx.derivedMedia.updateMany({ where, data: { status: "FAILED", error: "too_large" } });
          result[claim.kind] = marked.count === 1 ? "failed" : "claimed_elsewhere";
          continue;
        }
        const published = await tx.derivedMedia.updateMany({
          where,
          data: { status: "READY", mimeType: encoded.mimeType, sizeBytes: encoded.data.byteLength, width: encoded.width, height: encoded.height, error: null },
        });
        if (published.count === 1) {
          result[claim.kind] = "derived";
        } else {
          keysToDelete.push(claim.storageKey);
          result[claim.kind] = "claimed_elsewhere";
        }
      }
      if (live.width === null || live.height === null) {
        await tx.media.update({ where: { id: mediaId }, data: { width: derived.sourceWidth, height: derived.sourceHeight } });
      }
    }, TX_OPTIONS);
    for (const key of keysToDelete) {
      await quietDel(key, mediaId);
    }
    log.info({ action: "derived", mediaId, memoryId: media.memoryId, ...result }, "derived copies recorded");
    return result;
  } catch (error) {
    if (isImageDeriveError(error)) {
      const code = error.code === "too_many_pixels" ? `too_many_pixels:${error.limit ?? MAX_PIXELS}` : error.code;
      await failClaims(code);
      log.warn({ action: "derive_refused", mediaId, code }, "original could not be converted");
      return result;
    }
    await failClaims("decode_failed");
    logError("derive failed", error, { category: "upload", mediaId });
    return result;
  }
}
