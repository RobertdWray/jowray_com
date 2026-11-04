import "server-only";

import { createHmac } from "node:crypto";

import { safeEqualHex } from "@/lib/claim-token";
import { getSiteUrl } from "@/lib/site-url";
import { getAdminPageEnv } from "@/server/config/env";

/**
 * The family admin session (docs/plans/2026-11-04-admin-page.md §3.2). Pure:
 * no `next/headers`, so the page and route code read and write the cookie and
 * this module only mints and checks values. The cookie never carries the raw
 * secret: it is `issuedAtMs.HMAC-SHA256(secret, "v1:" + issuedAtMs)`, so a new
 * secret invalidates every cookie and the 30-day limit is enforced here, not
 * only by the browser.
 */

export const ADMIN_COOKIE = "jowray_admin";
export const ADMIN_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function sign(secret: string, issuedAtMs: number): string {
  return createHmac("sha256", secret).update(`v1:${issuedAtMs}`).digest("hex");
}

export function mintAdminCookie(now: number = Date.now()): string {
  const secret = getAdminPageEnv().ADMIN_PAGE_SECRET;
  if (!secret) {
    throw new Error("ADMIN_PAGE_SECRET is not set");
  }
  return `${now}.${sign(secret, now)}`;
}

/** The entry link's key against the configured secret, constant-time; false when the secret is unset. */
export function isAdminKey(key: string | null): boolean {
  const secret = getAdminPageEnv().ADMIN_PAGE_SECRET;
  if (!secret) {
    return false;
  }
  return safeEqualHex(key ?? "", secret);
}

/** A cookie value against the current secret and the session window; false on anything malformed. */
export function isAdminCookie(value: string | undefined, now: number = Date.now()): boolean {
  const secret = getAdminPageEnv().ADMIN_PAGE_SECRET;
  if (!secret || !value) {
    return false;
  }
  const [issuedAtText, hmac, ...rest] = value.split(".");
  if (rest.length > 0 || !issuedAtText || !hmac || !/^\d{1,16}$/.test(issuedAtText)) {
    return false;
  }
  const issuedAt = Number(issuedAtText);
  if (!safeEqualHex(hmac, sign(secret, issuedAt))) {
    return false;
  }
  const age = now - issuedAt;
  return age >= 0 && age <= ADMIN_SESSION_MS;
}

/** Cookie attributes for `cookies().set`: scoped to /admin, secure whenever the site URL is https (not by NODE_ENV, so `next start` over http still works). */
export function adminCookieOptions(): { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/admin"; maxAge: number } {
  return { httpOnly: true, secure: getSiteUrl().startsWith("https://"), sameSite: "lax", path: "/admin", maxAge: ADMIN_SESSION_MS / 1000 };
}
