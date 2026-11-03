import type { NextRequest } from "next/server";

import { hashClaimToken, safeEqualHex } from "@/lib/claim-token";
import { extensionFor, isAllowedMime } from "@/lib/media-types";
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
  "Referrer-Policy": "same-origin",
} as const;

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: PROTECTIVE_HEADERS });
}

/** `attachment; filename="ascii"; filename*=UTF-8''percent-encoded` with no control characters. */
export function attachmentDisposition(filename: string): string {
  const clean = filename.replaceAll(/\p{Cc}/gu, "").trim();
  const ascii = clean.replaceAll(/[^A-Za-z0-9._-]/g, "_").replaceAll(/_+/g, "_") || "memory";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean || ascii)}`;
}

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
    media.memory.deletedAt !== null ||
    !isAllowedMime(media.mimeType) ||
    !safeEqualHex(hashClaimToken(token), media.memory.claimTokenHash)
  ) {
    return notFound();
  }

  const storage = createStorageService();
  if (download) {
    const file = await storage.get(media.storageKey);
    if (!file) {
      return notFound();
    }
    const filename = media.originalFilename ?? `memory.${extensionFor(media.mimeType)}`;
    return new Response(file.stream, {
      status: 200,
      headers: {
        ...PROTECTIVE_HEADERS,
        "Content-Type": media.mimeType,
        "Content-Length": String(file.contentLength),
        "Content-Disposition": attachmentDisposition(filename),
      },
    });
  }

  const { url } = await storage.presignGet({
    pathname: media.storageKey,
    validUntil: Date.now() + PRESIGN_TTL_MS,
  });
  return new Response(null, { status: 302, headers: { ...PROTECTIVE_HEADERS, Location: url } });
}
