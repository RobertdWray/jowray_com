import "server-only";

import { cookies } from "next/headers";

import { ADMIN_COOKIE, isAdminCookie } from "@/features/admin/session";

/**
 * The one reader of the admin cookie. Pages call it inside their Suspense child
 * (after `connection()`); every Server Function calls it first. Render-time
 * gating is not a security boundary, so the Server Functions never rely on
 * the page having checked.
 */
export async function hasAdminSession(): Promise<boolean> {
  return isAdminCookie((await cookies()).get(ADMIN_COOKIE)?.value);
}
