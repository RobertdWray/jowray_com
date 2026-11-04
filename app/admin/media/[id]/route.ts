import type { NextRequest } from "next/server";

import { ADMIN_COOKIE, isAdminCookie } from "@/features/admin/session";
import { mediaNotFound, mediaVariantFrom, serveMedia } from "@/features/media/serve-media";

// Same budget as /api/media/[id]: a download may stream through the function.
export const maxDuration = 60;

/**
 * A memory's file for the family admin page (docs/plans/2026-11-04-admin-page.md §3.7).
 * `<img>`, `<audio>` and `<video>` cannot send a bearer, and the claim-token
 * route is authorised by a token the admin does not hold, so this route lives
 * under `/admin` (the cookie's path) and checks the session cookie. A missing
 * or bad cookie answers the same 404 as a wrong token: no oracle. A deleted
 * memory's files still render here, because Restore is decided on this page.
 */
export async function GET(request: NextRequest, context: RouteContext<"/admin/media/[id]">): Promise<Response> {
  // Request-time reads first (Cache Components rule), then env and data.
  const cookie = request.cookies.get(ADMIN_COOKIE)?.value;
  const download = request.nextUrl.searchParams.get("download") === "1";
  const variant = mediaVariantFrom(request.nextUrl.searchParams.get("v"));
  const { id } = await context.params;
  if (!isAdminCookie(cookie)) {
    return mediaNotFound();
  }
  return serveMedia({ id, variant, download, allowDeletedMemory: true, authorize: () => true });
}
