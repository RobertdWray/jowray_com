import type { NextRequest } from "next/server";

import { mediaNotFound, mediaVariantFrom, serveMedia } from "@/features/media/serve-media";
import { hashClaimToken, safeEqualHex } from "@/lib/claim-token";

// Streaming a download must finish within this; inline views are redirected
// to a 60-second presigned URL served by the blob host (which supports Range).
export const maxDuration = 60;

/** A memory's file for the holder of its claim token (`?t=`). The body lives in features/media/serve-media.ts, shared with the admin route. */
export async function GET(request: NextRequest, context: RouteContext<"/api/media/[id]">): Promise<Response> {
  // Request-time reads first (Cache Components), then data.
  const token = request.nextUrl.searchParams.get("t");
  const download = request.nextUrl.searchParams.get("download") === "1";
  const variant = mediaVariantFrom(request.nextUrl.searchParams.get("v"));
  const { id } = await context.params;
  if (!token) {
    return mediaNotFound();
  }
  const tokenHash = hashClaimToken(token);
  return serveMedia({ id, variant, download, caller: "claim", allowDeletedMemory: false, authorize: (memory) => safeEqualHex(tokenHash, memory.claimTokenHash) });
}
