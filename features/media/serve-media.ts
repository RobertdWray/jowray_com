import "server-only";

import { GLOBAL_EGRESS_SCOPE, mediaEgressScope, recordEgress, releaseEgress, reserveEgress, secondsUntilNextUtcDay, utcDay } from "@/features/media/egress";
import { isStagingKey } from "@/lib/derived-keys";
import { attachmentDisposition, extensionFor, isAllowedMime } from "@/lib/media-types";
import { createLogger } from "@/lib/logger";
import { getMediaServingEnv, type MediaServingEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { createStorageService } from "@/services/storage";

const log = createLogger({ category: "media" });

/** Inline views are redirected to a presigned URL served by the blob host (which supports Range). */
const PRESIGN_TTL_MS = 60_000;

export const PROTECTIVE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
} as const;

export function mediaNotFound(): Response {
  return new Response("Not found", { status: 404, headers: PROTECTIVE_HEADERS });
}

/** Over the day's allowance (issue #45). Only ever sent after the token proved valid, so it says nothing about other tokens. */
export function mediaOverAllowance(now: Date = new Date()): Response {
  return new Response("This file's download allowance for today is used up. Please try again tomorrow.", {
    status: 429,
    headers: { ...PROTECTIVE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(secondsUntilNextUtcDay(now)) },
  });
}

export type MediaVariant = "web" | "thumb" | "original";

/** `v` from the query string: which copy to serve inline. Anything unknown is the web copy. */
export function mediaVariantFrom(value: string | null): MediaVariant {
  return value === "thumb" || value === "original" ? value : "web";
}

/** Who is asking: the holder of the memory's claim token, or the family admin (cookie). Decides the allowance, never the authorization. */
export type MediaCaller = "claim" | "admin";

export interface ServeMediaOptions {
  id: string;
  variant: MediaVariant;
  download: boolean;
  caller: MediaCaller;
  /** The admin page shows a deleted memory's files (Restore is decided there); the claim page never does. */
  allowDeletedMemory: boolean;
  /** Decides whether the caller may see this memory's files; called only for a servable row. Must be constant-time when it compares secrets. */
  authorize: (memory: { claimTokenHash: string }) => boolean;
  /** Test seam for the day boundary. */
  now?: () => Date;
}

/**
 * Serve one READY file (docs/plans/2026-11-04-admin-page.md §3.7): shared by
 * `/api/media/[id]` (claim token) and `/admin/media/[id]` (admin cookie).
 * Photos are only ever shown inline from a server-made, metadata-stripped copy
 * (plan P17); `original` and `download=1` return the untouched file. Downloads
 * up to the proxy cap stream through; everything else is a 60-second presigned
 * redirect. Every authorization refusal is the same 404 (no oracle). A
 * soft-deleted media row or one marked for purge (`purgedAt`, whatever its
 * status) is never served.
 *
 * Allowance (issue #45): every response is charged with the size of the copy
 * it serves against two daily counters, the file's own (a multiple of its size,
 * larger once the memory is APPROVED) and the site's. A claim-link holder over
 * either gets 429 with `Retry-After`; the admin is counted and never refused.
 */
export async function serveMedia({ id, variant, download, caller, allowDeletedMemory, authorize, now = () => new Date() }: ServeMediaOptions): Promise<Response> {
  const db = getDb();
  const media = await db.media.findUnique({
    where: { id },
    include: {
      memory: { select: { claimTokenHash: true, deletedAt: true, status: true } },
      derivatives: { where: { status: "READY" }, select: { kind: true, storageKey: true, mimeType: true, sizeBytes: true } },
    },
  });
  if (
    !media ||
    media.status !== "READY" ||
    // Marked for purge by the cron (the bytes are gone or going): never served again, whatever the status says.
    media.purgedAt !== null ||
    media.deletedAt !== null ||
    (!allowDeletedMemory && media.memory.deletedAt !== null) ||
    !isAllowedMime(media.mimeType) ||
    !authorize(media.memory)
  ) {
    return mediaNotFound();
  }

  const env = getMediaServingEnv();
  const originalBytes = media.sizeBytes ?? media.maxBytes;

  // Which copy, and what it costs.
  let pathname = media.storageKey;
  let cost = originalBytes;
  if (!download && variant !== "original" && media.mimeType.startsWith("image/")) {
    const copy = (kind: "WEB_IMAGE" | "THUMBNAIL") => media.derivatives.find((d) => d.kind === kind);
    const chosen = (variant === "thumb" ? copy("THUMBNAIL") : undefined) ?? copy("WEB_IMAGE");
    // No sanitized copy yet (or a row that points at a browser-staged key): not servable inline.
    if (!chosen || isStagingKey(chosen.storageKey)) {
      return mediaNotFound();
    }
    pathname = chosen.storageKey;
    cost = chosen.sizeBytes ?? originalBytes;
  }

  const allowed = await withinAllowance(db, { caller, mediaId: media.id, approved: media.memory.status === "APPROVED", originalBytes, cost, env, day: utcDay(now()) });
  if (!allowed) {
    log.info({ action: "over_allowance", mediaId: media.id, cost }, "media refused: daily allowance reached");
    return mediaOverAllowance(now());
  }

  const storage = createStorageService();
  if (download && originalBytes <= env.MEDIA_PROXY_DOWNLOAD_MAX_BYTES) {
    // Streaming through the function is billed on both legs (Blob transfer in, Fast Data Transfer out);
    // only small files keep the sanitized attachment filename this way. The cap is env-driven.
    const file = await storage.get(media.storageKey);
    if (!file) {
      return mediaNotFound();
    }
    if (file.contentLength <= env.MEDIA_PROXY_DOWNLOAD_MAX_BYTES) {
      const extension = extensionFor(media.mimeType);
      const filename = media.originalFilename ?? `memory.${extension}`;
      return new Response(file.stream, {
        status: 200,
        headers: {
          ...PROTECTIVE_HEADERS,
          "Content-Type": media.mimeType,
          "Content-Length": String(file.contentLength),
          "Content-Disposition": attachmentDisposition(filename, extension),
        },
      });
    }
    await file.stream.cancel();
  }

  const { url } = await storage.presignGet({ pathname, validUntil: Date.now() + PRESIGN_TTL_MS });
  return new Response(null, { status: 302, headers: { ...PROTECTIVE_HEADERS, Location: url } });
}

/**
 * Charge `cost` to the file's counter, then the site's. The file's ceiling is
 * a multiple of the original's size (so a short clip and a long video get
 * proportionate room); the site's is an absolute number of bytes per day.
 * A refusal by the second counter gives the first its reservation back.
 */
async function withinAllowance(
  db: ReturnType<typeof getDb>,
  { caller, mediaId, approved, originalBytes, cost, env, day }: { caller: MediaCaller; mediaId: string; approved: boolean; originalBytes: number; cost: number; env: MediaServingEnv; day: string }
): Promise<boolean> {
  if (caller === "admin") {
    await recordEgress(db, { scope: GLOBAL_EGRESS_SCOPE, day, bytes: cost });
    return true;
  }
  const multiple = approved ? env.MEDIA_FILE_DAILY_MULTIPLE : env.MEDIA_FILE_DAILY_MULTIPLE_UNAPPROVED;
  const fileScope = mediaEgressScope(mediaId);
  if (!(await reserveEgress(db, { scope: fileScope, day, bytes: cost, limit: multiple * originalBytes }))) {
    return false;
  }
  if (!(await reserveEgress(db, { scope: GLOBAL_EGRESS_SCOPE, day, bytes: cost, limit: env.MEDIA_DAILY_EGRESS_BYTES }))) {
    await releaseEgress(db, { scope: fileScope, day, bytes: cost });
    return false;
  }
  return true;
}
