import "server-only";

import { claimKind, type ClaimEncoded, type DerivedClaim, failClaims, MAX_PIXELS, publishClaims } from "@/features/memories/derived-claims";
import { ImageDeriveError, isImageDeriveError } from "@/lib/image-derive-error";
import { createLogger, logError } from "@/lib/logger";
import { detectMediaType, SIGNATURE_PREFIX_BYTES } from "@/lib/media-types";
import { storagePrefix } from "@/lib/site-url";
import { getDb } from "@/server/db/client";
import { createImageService, DERIVE_DEFAULTS, type DeriveSlot, webExtensionFor } from "@/services/images";
import { createStorageService } from "@/services/storage";

const log = createLogger({ category: "upload" });

export const DERIVED_KINDS = ["WEB_IMAGE", "THUMBNAIL"] as const;
export type DerivedKind = (typeof DERIVED_KINDS)[number];
/** `deferred`: the decode slot's waiting line was full; nothing was claimed, read or decoded, and cron step (g) will come back to it. */
export type DeriveOutcome = "derived" | "failed" | "not_eligible" | "claimed_elsewhere" | "deferred";
export type DeriveResult = Record<DerivedKind, DeriveOutcome>;

/** The claim rules and their limits live with the shared protocol; cron step (g) reads them from here. */
export { isEligible, MAX_DECODE_ATTEMPTS, MAX_PIXELS, STALE_CLAIM_MS } from "@/features/memories/derived-claims";

async function streamToBuffer(stream: ReadableStream): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

/**
 * Make the web copy and the email thumbnail of one READY image original.
 *
 * Protocol (plan P4/P18; the claim and publish steps live in
 * `derived-claims.ts`): the decode slot is taken first (issue #45: a full
 * waiting line means `deferred`, nothing claimed, the cron comes back), then
 * every kind is CLAIMED as a PENDING row that already carries its candidate
 * blob pathname, so a crash or a lost race can never leave an untracked blob.
 * The original is then read, within what is left of one deadline that
 * started at entry, and decoded once; each copy is written to its candidate
 * key, and each row is PUBLISHED under the memory lock with a conditional
 * update that only the holder of this claim can satisfy. Blob deletes never
 * run while the lock is held. Every failure is recorded on the rows it owns;
 * this function never throws. An original is never deleted here: a decoder
 * verdict is about the copies, not the file (rows from before the byte
 * check may be mislabelled real photos, which are relabelled from their
 * bytes and decoded as what they are).
 */
export async function deriveMedia({ mediaId, deadlineMs, now = new Date() }: { mediaId: string; deadlineMs: number; now?: Date }): Promise<DeriveResult> {
  const deadlineAt = Date.now() + deadlineMs;
  const remainingMs = () => deadlineAt - Date.now();
  const db = getDb();
  const storage = createStorageService();
  const result: DeriveResult = { WEB_IMAGE: "not_eligible", THUMBNAIL: "not_eligible" };
  const claims: DerivedClaim<DerivedKind>[] = [];
  let slot: DeriveSlot | null = null;

  /** Mark every claim this run holds FAILED (conditionally) and delete only the candidates it still owns. */
  const failHeldClaims = async (error: string): Promise<void> => {
    await failClaims(claims, { mediaId, now, error });
    for (const claim of claims) {
      result[claim.kind] = "failed";
    }
  };

  try {
    const row = await db.media.findUnique({
      where: { id: mediaId },
      include: { memory: { select: { deletedAt: true } }, derivatives: { where: { kind: { in: [...DERIVED_KINDS] } } } },
    });
    if (
      !row ||
      row.status !== "READY" ||
      row.deletedAt !== null ||
      row.memory.deletedAt !== null ||
      !row.mimeType.startsWith("image/") ||
      !row.storageKey.startsWith(storagePrefix())
    ) {
      return result;
    }

    // 1. The slot, before a single byte is downloaded. A full line (or a wait that runs out the
    //    deadline) defers the photo to cron step (g) without claiming anything: no attempt is spent.
    try {
      slot = await createImageService().acquire(remainingMs());
    } catch (error) {
      if (isImageDeriveError(error) && (error.code === "busy" || error.code === "timeout")) {
        log.info({ action: "derive_deferred", mediaId, code: error.code }, "decode slot not available; left to the cron");
        return { WEB_IMAGE: "deferred", THUMBNAIL: "deferred" };
      }
      throw error;
    }
    if (remainingMs() <= 0) {
      // The slot came too late to do anything with: claim nothing, spend no attempt.
      log.info({ action: "derive_deferred", mediaId, code: "timeout" }, "decode slot arrived after the deadline; left to the cron");
      return { WEB_IMAGE: "deferred", THUMBNAIL: "deferred" };
    }

    // 2. Claim.
    for (const kind of DERIVED_KINDS) {
      const extension = kind === "THUMBNAIL" ? "jpg" : webExtensionFor(row.mimeType);
      const existing = row.derivatives.find((d) => d.kind === kind) ?? null;
      const claimed = await claimKind({ mediaId, kind, existing, originalKey: row.storageKey, extension, now });
      if ("claim" in claimed) {
        claims.push(claimed.claim);
      } else {
        result[kind] = claimed.outcome;
      }
    }
    if (claims.length === 0) {
      return result;
    }

    // 3. Read the original within what is left of the deadline; a stalled download is aborted, not waited for.
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), Math.max(0, remainingMs()));
    let input: Buffer;
    try {
      const file = await storage.get(row.storageKey, { signal: controller.signal });
      if (!file) {
        await failHeldClaims("decode_failed");
        log.warn({ action: "derive_missing_original", mediaId }, "original blob not found");
        return result;
      }
      input = await streamToBuffer(file.stream);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ImageDeriveError("timeout", { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(abortTimer);
    }
    if (remainingMs() <= 0) {
      throw new ImageDeriveError("timeout");
    }

    // 4. What the bytes are. A row from before the byte check may carry the label the browser gave
    //    it; the file is decoded as what it is and the row relabelled. Bytes of no allowed photo
    //    type are a terminal refusal of the copies, never a deletion of the original.
    const sourceMime = detectMediaType(row.mimeType, input.subarray(0, SIGNATURE_PREFIX_BYTES));
    if (sourceMime === null) {
      throw new ImageDeriveError("unsupported_type");
    }
    if (sourceMime !== row.mimeType) {
      await db.media.update({ where: { id: mediaId }, data: { mimeType: sourceMime } });
      log.info({ action: "relabel", mediaId, memoryId: row.memoryId, declared: row.mimeType, actual: sourceMime }, "original relabelled from its bytes");
    }

    // 5. Decode once, then free the slot: publishing is database work only.
    const derived = await slot.derive(input, { ...DERIVE_DEFAULTS, sourceMime, deadlineMs: remainingMs() });
    slot.release();
    slot = null;

    // 6. Write each copy to its claimed key.
    const encodedByKind = new Map<DerivedKind, ClaimEncoded>([
      ["WEB_IMAGE", derived.web],
      ["THUMBNAIL", derived.thumb],
    ]);
    for (const claim of claims) {
      const encoded = encodedByKind.get(claim.kind);
      if (encoded && !("failed" in encoded)) {
        await storage.put(claim.storageKey, encoded.data, encoded.mimeType);
      }
    }

    // 7. Publish under the memory lock; only the holder of this exact claim can. No network inside the lock.
    //    While it is held, the original's dimensions are filled from the decode if it has none.
    const published = await publishClaims({
      mediaId,
      memoryId: row.memoryId,
      claims,
      now,
      encodedFor: (kind) => encodedByKind.get(kind),
      whileLocked: async (tx, live) => {
        if (live.width === null || live.height === null) {
          await tx.media.update({ where: { id: mediaId }, data: { width: derived.sourceWidth, height: derived.sourceHeight } });
        }
      },
    });
    Object.assign(result, published);
    log.info({ action: "derived", mediaId, memoryId: row.memoryId, ...result }, "derived copies recorded");
    return result;
  } catch (error) {
    if (isImageDeriveError(error)) {
      const code = error.code === "too_many_pixels" ? `too_many_pixels:${error.limit ?? MAX_PIXELS}` : error.code;
      await failHeldClaims(code);
      log.warn({ action: "derive_refused", mediaId, code }, "original could not be converted");
      return result;
    }
    await failHeldClaims("decode_failed");
    logError("derive failed", error, { category: "upload", mediaId });
    return result;
  } finally {
    slot?.release();
  }
}
