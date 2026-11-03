import type { NextRequest } from "next/server";

import { hashClaimToken, safeEqualHex } from "@/lib/claim-token";
import { attachmentDisposition, extensionFor, isAllowedMime, MAX_BYTES } from "@/lib/media-types";
import { getDb } from "@/server/db/client";
import { createStorageService } from "@/services/storage";

// Streaming a download must finish within this; inline views are redirected
// to a 60-second presigned URL served by the blob host (which supports Range).
export const maxDuration = 60;

const PRESIGN_TTL_MS = 60_000;

const PROTECTIVE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
} as const;

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: PROTECTIVE_HEADERS });
}

/**
 * Downloads stream through this function only up to this size; the function
 * has 60 s, and Vercel advises against proxying large files. Larger media
 * (video, long audio) is redirected to the presigned URL like inline views.
 */
const MAX_PROXY_DOWNLOAD_BYTES = MAX_BYTES.PHOTO;

export async function GET(request: NextRequest, context: RouteContext<"/api/media/[id]">): Promise<Response> {
  // Request-time reads first (Cache Components), then data.
  const token = request.nextUrl.searchParams.get("t");
  const download = request.nextUrl.searchParams.get("download") === "1";
  const { id } = await context.params;
  if (!token) {
    return notFound();
  }

  const media = await getDb().media.findUnique({
    where: { id },
    include: { memory: { select: { claimTokenHash: true, deletedAt: true } } },
  });
  if (
    !media ||
    media.status !== "READY" ||
    media.deletedAt !== null ||
    media.memory.deletedAt !== null ||
    !isAllowedMime(media.mimeType) ||
    !safeEqualHex(hashClaimToken(token), media.memory.claimTokenHash)
  ) {
    return notFound();
  }

  const storage = createStorageService();
  if (download && (media.sizeBytes ?? 0) <= MAX_PROXY_DOWNLOAD_BYTES) {
    const file = await storage.get(media.storageKey);
    if (!file) {
      return notFound();
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

  const { url } = await storage.presignGet({
    pathname: media.storageKey,
    validUntil: Date.now() + PRESIGN_TTL_MS,
  });
  return new Response(null, { status: 302, headers: { ...PROTECTIVE_HEADERS, Location: url } });
}
