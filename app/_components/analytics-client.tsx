"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { scrubUrl } from "@/lib/sentry/scrub";

// Any path with an `m` segment (any case, at any depth) can carry a claim token.
const CLAIM_SEGMENT = /\/m\//i;
// The claim page URL that is kept (scrubUrl replaces its token): lower-case `m`, one
// non-empty segment, no trailing slash, no percent-encoding (see scrubVercelEvent).
const CLAIM_PAGE_PATH = /^\/m\/[^/%]+$/;
// The only claim route the Next wrappers build without the token (app/m/[claimToken]).
const CLAIM_PAGE_ROUTE = /^\/m\/\[claimToken\]$/;
// Invite links follow the same rules; /share is an ordinary path.
const INVITE_SEGMENT = /\/s\//i;
const INVITE_PAGE_PATH = /^\/s\/[^/%]+$/;
const INVITE_PAGE_ROUTE = /^\/s\/\[inviteToken\]$/;

/**
 * True when `path`, raw or decoded, has an `m` or `s` segment and is not the
 * claim or invite page as `claimPage` and `invitePage` describe it. Throws
 * `URIError` on malformed percent-encoding.
 */
function hasUnsafeSegment(path: string, claimPage: RegExp, invitePage: RegExp): boolean {
  const decoded = decodeURIComponent(path);
  return ((CLAIM_SEGMENT.test(path) || CLAIM_SEGMENT.test(decoded)) && !claimPage.test(path)) ||
    ((INVITE_SEGMENT.test(path) || INVITE_SEGMENT.test(decoded)) && !invitePage.test(path));
}

/** URL paths: the claim/invite page is kept only with an unencoded token, which `scrubUrl` replaces. */
function isUnsafePath(path: string): boolean {
  return hasUnsafeSegment(path, CLAIM_PAGE_PATH, INVITE_PAGE_PATH);
}

/** Wrapper routes are sent as built: the claim/invite page is kept only as its exact placeholder. */
function isUnsafeRoute(route: string): boolean {
  return hasUnsafeSegment(route, CLAIM_PAGE_ROUTE, INVITE_PAGE_ROUTE);
}

/**
 * The `beforeSend` for both Vercel scripts (Web Analytics and Speed Insights),
 * keeping bearer secrets out of everything they send.
 *
 * Claim and invite links carry tokens in the path (`/m/<token>`, `/s/<token>`).
 * The admin entry link carries its key in the fragment (`#key=`); `?t=` is removed too.
 * Project policy forbids those leaving the browser anywhere
 * (docs/code-layout.md, "Sentry").
 *
 * Both scripts send the path twice: the URL, which passes through this hook and
 * so through the same `scrubUrl` the Sentry scrubber uses, and a route the hook
 * cannot rewrite. Each Next wrapper builds the route by replacing `useParams()`
 * values in `usePathname()`: on the claim/invite page that gives `/m/[claimToken]`
 * or `/s/[inviteToken]`. It gives the raw pathname, token included, on any path
 * no page matched (the root not-found page), and on a claim/invite link with any
 * percent-encoded token character, because the pathname keeps the encoding while
 * the params are decoded (reproduced on 2026-11-08 for both scripts).
 * - Web Analytics (script 0.1.3) sends the route as `dp` outside this hook; the
 *   URL is `o`.
 * - Speed Insights (script 0.1.3) passes `{ type: "vital", url, route }`, where
 *   `url` is `location.href` (query and fragment included), and copies back
 *   only the returned `url`. Its route can also lag behind a client navigation,
 *   so the route is checked on its own and must be exactly a placeholder.
 * Either way, an unsafe path can only be kept out by dropping the whole event
 * (`null`). So any `%` in a claim or invite segment drops the event: Web Analytics
 * never shows its route to this hook. Claim tokens (lib/claim-token.ts) and invite
 * tokens (lib/invite-token.ts) are base64url, so a real link never contains `%`.
 * An unparsable URL or malformed percent-encoding also drops the event. A real
 * page view never has a trailing slash (Next 308-redirects it away), so dropping
 * `/m/<token>/` or `/s/<token>/` loses nothing.
 *
 * Web Analytics sends a referrer only when it is another host, so a same-site
 * referrer never carries a token either.
 */
export function scrubVercelEvent<T extends { url: string; route?: string }>(event: T): T | null {
  try {
    if (isUnsafePath(new URL(event.url).pathname) || (event.route !== undefined && isUnsafeRoute(event.route))) {
      return null;
    }
  } catch {
    return null;
  }
  // Spread: the runtime event carries fields beyond its declared type (`payload`, `__cdp`) that the script reads back.
  return { ...event, url: scrubUrl(event.url) };
}

export function SiteAnalytics() {
  return <Analytics beforeSend={scrubVercelEvent} />;
}

/** Core Web Vitals for Vercel Speed Insights; every event goes through the same guard. */
export function SiteSpeedInsights() {
  return <SpeedInsights beforeSend={scrubVercelEvent} />;
}
