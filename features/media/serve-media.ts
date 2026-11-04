import "server-only";

import { isStagingKey } from "@/lib/derived-keys";
import { attachmentDisposition, extensionFor, isAllowedMime, MAX_BYTES } from "@/lib/media-types";
import { getDb } from "@/server/db/client";
import { createStorageService } from "@/services/storage";

/** Inline views are redirected to a presigned URL served by the blob host (which supports Range). */
const PRESIGN_TTL_MS = 60_000;

/**
 * Downloads stream through the function only up to this size; the function
 * has 60 s, and Vercel advises against proxying large files. Larger media
 * (video, long audio) is redirected to the presigned URL like inline views.
 */
const MAX_PROXY_DOWNLOAD_BYTES = MAX_BYTES.PHOTO;

export const PROTECTIVE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
} as const;

export function mediaNotFound(): Response {
  return new Response("Not found", { status: 404, headers: PROTECTIVE_HEADERS });
}

export type MediaVariant = "web" | "thumb" | "original";

/** `v` from the query string: which copy to serve inline. Anything unknown is the web copy. */
export function mediaVariantFrom(value: string | null): MediaVariant {
  return value === "thumb" || value === "original" ? value : "web";
}

export interface ServeMediaOptions {
  id: string;
  variant: MediaVariant;
  download: boolean;
  /** The admin page shows a deleted memory's files (Restore is decided there); the claim page never does. */
  allowDeletedMemory: boolean;
  /** Decides whether the caller may see this memory's files; called only for a servable row. Must be constant-time when it compares secrets. */
  authorize: (memory: { claimTokenHash: string }) => boolean;
}

/**
 * Serve one READY file (docs/plans/2026-11-04-admin-page.md §3.7): shared by
 * `/api/media/[id]` (claim token) and `/admin/media/[id]` (admin cookie).
 * Photos are only ever shown inline from a server-made, metadata-stripped copy
 * (plan P17); `original` and `download=1` return the untouched file. Downloads
 * up to the proxy cap stream through; everything else is a 60-second presigned
 * redirect. Every refusal is the same 404 (no oracle). A soft-deleted media row
 * or one marked for purge (`purgedAt`, whatever its status) is never served.
 */
export async function serveMedia({ id, variant, download, allowDeletedMemory, authorize }: ServeMediaOptions): Promise<Response> {
  const media = await getDb().media.findUnique({
    where: { id },
    include: {
      memory: { select: { claimTokenHash: true, deletedAt: true } },
      derivatives: { where: { status: "READY" }, select: { kind: true, storageKey: true, mimeType: true } },
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

  const storage = createStorageService();
  if (download && (media.sizeBytes ?? 0) <= MAX_PROXY_DOWNLOAD_BYTES) {
    const file = await storage.get(media.storageKey);
    if (!file) {
      return mediaNotFound();
    }
    if (file.contentLength <= MAX_PROXY_DOWNLOAD_BYTES) {
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

  let pathname = media.storageKey;
  if (!download && variant !== "original" && media.mimeType.startsWith("image/")) {
    const copy = (kind: "WEB_IMAGE" | "THUMBNAIL") => media.derivatives.find((d) => d.kind === kind);
    const chosen = (variant === "thumb" ? copy("THUMBNAIL") : undefined) ?? copy("WEB_IMAGE");
    // No sanitized copy yet (or a row that points at a browser-staged key): not servable inline.
    if (!chosen || isStagingKey(chosen.storageKey)) {
      return mediaNotFound();
    }
    pathname = chosen.storageKey;
  }
  const { url } = await storage.presignGet({ pathname, validUntil: Date.now() + PRESIGN_TTL_MS });
  return new Response(null, { status: 302, headers: { ...PROTECTIVE_HEADERS, Location: url } });
}
