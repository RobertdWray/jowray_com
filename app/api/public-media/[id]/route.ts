import type { NextRequest } from "next/server";

import { mediaNotFound, mediaVariantFrom, serveMedia, viewerKeyFrom } from "@/features/media/serve-media";
import { getPublicMemoriesEnv } from "@/server/config/env";

// Inline views are 60-second presigned redirects; nothing streams through this function, but keep the media routes' budget.
export const maxDuration = 60;

/**
 * A file of a memory on See memories (plan docs/plans/2026-11-08-see-memories.md, D6, D15, D16, D18), for anyone,
 * without a token. The body lives in features/media/serve-media.ts with caller `public`: APPROVED + PUBLIC memories
 * only, photos only from their server-made copies, recordings and videos only when they cannot carry a location or
 * were scanned clean, and its own allowance. `download` is never honoured and `v=original` is the web copy. While the
 * launch flag is off every request is the same 404, before the database is touched.
 */
export async function GET(request: NextRequest, context: RouteContext<"/api/public-media/[id]">): Promise<Response> {
  // Request-time reads first (Cache Components), then env and data.
  const variant = mediaVariantFrom(request.nextUrl.searchParams.get("v"));
  const viewerKey = viewerKeyFrom(request.headers);
  if (!getPublicMemoriesEnv().PUBLIC_MEMORIES_ENABLED) {
    return mediaNotFound();
  }
  const { id } = await context.params;
  return serveMedia({
    id,
    variant: variant === "original" ? "web" : variant,
    download: false,
    caller: "public",
    viewerKey,
    allowDeletedMemory: false,
    authorize: (memory) => memory.status === "APPROVED" && memory.visibility === "PUBLIC",
  });
}
