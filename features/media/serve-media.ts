import "server-only";

import {
  countRequest,
  GLOBAL_EGRESS_SCOPE,
  mediaEgressScope,
  mediaViewerScope,
  recordEgress,
  releaseEgress,
  reserveEgress,
  secondsUntilNextUtcDay,
  utcDay,
} from "@/features/media/egress";
import { isStagingKey } from "@/lib/derived-keys";
import { attachmentDisposition, extensionFor, isAllowedMime } from "@/lib/media-types";
import { createLogger, logError } from "@/lib/logger";
import { originalPlayablePublicly } from "@/lib/memories/playability";
import { getMediaServingEnv, type MediaServingEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { createStorageService } from "@/services/storage";

export { viewerKeyFrom } from "@/features/media/egress";

const log = createLogger({ category: "media" });

/** Inline views are redirected to a presigned URL served by the blob host (which supports Range). */
const PRESIGN_TTL_MS = 60_000;
/**
 * The browser alone may reuse a redirect for a little less than the URL's
 * life. Not every engine does for ranged requests (WebKit does not), which
 * is why the allowance is per viewer and day rather than per request; this
 * only saves round trips where it works. Streams and refusals stay `no-store`.
 */
const REDIRECT_CACHE_CONTROL = `private, max-age=${PRESIGN_TTL_MS / 1000 - 5}`;

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

/**
 * Who is asking: the holder of the memory's claim token, the family admin (cookie), or any visitor of See memories
 * (plan 2026-11-08 D6). Decides the allowance; for `public` it also adds its own refusals (below), whatever
 * `authorize` says.
 */
export type MediaCaller = "claim" | "admin" | "public";

/** What `authorize` sees of the file's memory. */
export interface ServableMemory {
  claimTokenHash: string;
  status: "DRAFT" | "PENDING" | "APPROVED" | "HIDDEN";
  visibility: "PUBLIC" | "FAMILY" | "PRIVATE";
}

/** Counter scopes of public visitors start with this, so they never share a row with the claim-link or admin counters (D18). */
export const PUBLIC_SCOPE_PREFIX = "public:";

export interface ServeMediaOptions {
  id: string;
  variant: MediaVariant;
  download: boolean;
  caller: MediaCaller;
  /** The requesting client as `viewerKeyFrom(request.headers)` reports it; the allowance is per viewer and day. */
  viewerKey?: string;
  /** The admin page shows a deleted memory's files (Restore is decided there); the claim page never does. */
  allowDeletedMemory: boolean;
  /** Decides whether the caller may see this memory's files; called only for a servable row. Must be constant-time when it compares secrets. */
  authorize: (memory: ServableMemory) => boolean;
  /** Test seam for the day boundary. */
  now?: () => Date;
}

/**
 * Serve one READY file (docs/plans/2026-11-04-admin-page.md §3.7): shared by
 * `/api/media/[id]` (claim token) and `/admin/media/[id]` (admin cookie).
 * Photos are only ever shown inline from a server-made, metadata-stripped copy
 * (plan P17); `original` and `download=1` return the untouched file. Downloads
 * up to the proxy cap stream through with the sanitized attachment filename;
 * everything else is a 60-second presigned redirect (downloads carry the blob
 * host's download switch). Every authorization refusal is the same 404 (no
 * oracle). A soft-deleted media row or one marked for purge (`purgedAt`,
 * whatever its status) is never served.
 *
 * Allowance (issue #45): the first request a viewer makes for a copy of a
 * file on a given day charges that copy's size to the file's daily counter
 * (a multiple of the original's size, larger once the memory is APPROVED)
 * and to the site's; the viewer's later requests that day are free up to a
 * request cap. A claim-link holder over any of the three gets 429 with
 * `Retry-After`; the admin is counted and never refused. A counter that
 * cannot be reached fails open: the file is served and the error reported.
 *
 * The `public` caller (plan 2026-11-08, `/api/public-media`) is refused, with
 * the same 404, unless the memory is APPROVED, PUBLIC and not deleted (D1,
 * checked here as well as by the route's `authorize`, and regardless of
 * `allowDeletedMemory`). It never gets an original photo or a download: `original` becomes the web
 * copy and `download` is ignored. A recording or video plays only when its
 * original cannot carry a location or its scan found none (D16). Its
 * allowance is counted in `public:` scopes against the `MEDIA_PUBLIC_*`
 * limits (D18).
 */
export async function serveMedia({ id, variant: askedVariant, download: askedDownload, caller, viewerKey = "unknown", allowDeletedMemory, authorize, now = () => new Date() }: ServeMediaOptions): Promise<Response> {
  const isPublic = caller === "public";
  const variant: MediaVariant = isPublic && askedVariant === "original" ? "web" : askedVariant;
  const download = isPublic ? false : askedDownload;
  const db = getDb();
  const media = await db.media.findUnique({
    where: { id },
    include: {
      memory: { select: { claimTokenHash: true, deletedAt: true, status: true, visibility: true } },
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
  if (isPublic && !isPublicFile(media)) {
    return mediaNotFound();
  }

  const env = getMediaServingEnv();
  const originalBytes = media.sizeBytes ?? media.maxBytes;

  // Which copy, and what it costs.
  let pathname = media.storageKey;
  let cost = originalBytes;
  let copy: "original" | "web" | "thumb" = "original";
  if (!download && variant !== "original" && media.mimeType.startsWith("image/")) {
    const find = (kind: "WEB_IMAGE" | "THUMBNAIL") => media.derivatives.find((d) => d.kind === kind);
    const thumbnail = variant === "thumb" ? find("THUMBNAIL") : undefined;
    const chosen = thumbnail ?? find("WEB_IMAGE");
    // No sanitized copy yet (or a row that points at a browser-staged key): not servable inline.
    if (!chosen || isStagingKey(chosen.storageKey)) {
      return mediaNotFound();
    }
    pathname = chosen.storageKey;
    cost = chosen.sizeBytes ?? originalBytes;
    copy = thumbnail ? "thumb" : "web";
  }

  // One reading of the clock for the counters' day and the Retry-After it may produce.
  const at = now();
  const allowed = await withinAllowance(db, { caller, mediaId: media.id, copy, viewerKey, approved: media.memory.status === "APPROVED", originalBytes, cost, env, day: utcDay(at) });
  if (!allowed) {
    log.info({ action: "over_allowance", mediaId: media.id, copy, cost }, "media refused: daily allowance reached");
    return mediaOverAllowance(at);
  }

  const storage = createStorageService();
  if (download && originalBytes <= env.MEDIA_PROXY_DOWNLOAD_MAX_BYTES) {
    // Streaming through the function is billed on both legs (Blob transfer in, Fast Data Transfer out); the
    // allowance bounds it. It is what gives "Download" a sanitized filename, so photo-sized files take it.
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
  return new Response(null, { status: 302, headers: { ...PROTECTIVE_HEADERS, "Cache-Control": REDIRECT_CACHE_CONTROL, Location: download ? withDownloadSwitch(url) : url } });
}

/**
 * The public caller's own gate (D1, D16): the memory is APPROVED, PUBLIC and not deleted, and a non-photo original
 * cannot carry a location or was scanned clean. Photos are judged by the derived-copy branch, which never serves
 * their original.
 */
function isPublicFile(media: { mimeType: string; gpsCheckedAt: Date | null; latitude: number | null; longitude: number | null; memory: { status: string; visibility: string; deletedAt: Date | null } }): boolean {
  if (media.memory.status !== "APPROVED" || media.memory.visibility !== "PUBLIC" || media.memory.deletedAt !== null) {
    return false;
  }
  return media.mimeType.startsWith("image/") || originalPlayablePublicly(media);
}

/**
 * The blob host's own "save, don't display" switch, the same one the SDK's
 * `getDownloadUrl` adds. It is outside the signed part of a presigned URL
 * (like `cache`), so it rides along without disturbing the signature.
 */
function withDownloadSwitch(presignedUrl: string): string {
  const url = new URL(presignedUrl);
  url.searchParams.set("download", "1");
  return url.toString();
}

/**
 * Charge the first request of a viewer's day for this copy to the file's
 * counter, then the site's; count every request against the viewer's cap.
 * A refusal further down gives every earlier reservation back, so the next
 * try is judged afresh. Fails open on a counter error: the family's files
 * are served and the error is reported.
 */
async function withinAllowance(
  db: ReturnType<typeof getDb>,
  { caller, mediaId, copy, viewerKey, approved, originalBytes, cost, env, day }: { caller: MediaCaller; mediaId: string; copy: string; viewerKey: string; approved: boolean; originalBytes: number; cost: number; env: MediaServingEnv; day: string }
): Promise<boolean> {
  try {
    if (caller === "admin") {
      await recordEgress(db, { scope: GLOBAL_EGRESS_SCOPE, day, bytes: cost });
      return true;
    }
    const isPublic = caller === "public";
    const scoped = (scope: string) => (isPublic ? `${PUBLIC_SCOPE_PREFIX}${scope}` : scope);
    const globalScope = scoped(GLOBAL_EGRESS_SCOPE);
    const viewerScope = scoped(mediaViewerScope(mediaId, copy, viewerKey));
    const nth = await countRequest(db, { scope: viewerScope, day, limit: isPublic ? env.MEDIA_PUBLIC_VIEWER_DAILY_REQUESTS : env.MEDIA_VIEWER_DAILY_REQUESTS });
    if (nth === null) {
      return false;
    }
    if (nth > 1) {
      return true;
    }
    const fileScope = scoped(mediaEgressScope(mediaId));
    const multiple = isPublic ? env.MEDIA_PUBLIC_FILE_DAILY_MULTIPLE : approved ? env.MEDIA_FILE_DAILY_MULTIPLE : env.MEDIA_FILE_DAILY_MULTIPLE_UNAPPROVED;
    if (!(await reserveEgress(db, { scope: fileScope, day, bytes: cost, limit: multiple * originalBytes }))) {
      await releaseEgress(db, { scope: viewerScope, day, bytes: 1 });
      return false;
    }
    if (!(await reserveEgress(db, { scope: globalScope, day, bytes: cost, limit: isPublic ? env.MEDIA_PUBLIC_DAILY_EGRESS_BYTES : env.MEDIA_DAILY_EGRESS_BYTES }))) {
      await releaseEgress(db, { scope: fileScope, day, bytes: cost });
      await releaseEgress(db, { scope: viewerScope, day, bytes: 1 });
      return false;
    }
    return true;
  } catch (error) {
    logError("media allowance could not be checked; serving", error, { category: "media", mediaId });
    return true;
  }
}
