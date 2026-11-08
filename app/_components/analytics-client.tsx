"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { scrubUrl } from "@/lib/sentry/scrub";

// Any path with an `m` segment (any case, at any depth) can carry a claim token.
const CLAIM_SEGMENT = /\/m\//i;
// The claim page itself: lower-case `m`, one non-empty segment, no trailing slash.
const CLAIM_ROUTE = /^\/m\/[^/]+$/;
// Invite links follow the same rule; /share is an ordinary path.
const INVITE_SEGMENT = /\/s\//i;
const INVITE_ROUTE = /^\/s\/[^/]+$/;

/**
 * True when a path could carry a claim or invite token anywhere other than the
 * exact claim/invite page route. Checks the raw and the decoded path for `m` or
 * `s` segments, but accepts only an exact raw route, so encoded route segments
 * are unsafe. Throws `URIError` on malformed percent-encoding.
 */
function isUnsafePath(path: string): boolean {
  const decoded = decodeURIComponent(path);
  return ((CLAIM_SEGMENT.test(path) || CLAIM_SEGMENT.test(decoded)) && !CLAIM_ROUTE.test(path)) ||
    ((INVITE_SEGMENT.test(path) || INVITE_SEGMENT.test(decoded)) && !INVITE_ROUTE.test(path));
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
 * cannot rewrite. Each Next wrapper builds the route from `useParams()`: on the
 * claim/invite page it is `/m/[claimToken]` or `/s/[inviteToken]`, but on any
 * path no page matched (the root not-found page) it is the raw pathname, token
 * included.
 * - Web Analytics (script 0.1.3) sends the route as `dp` outside this hook; the
 *   URL is `o`.
 * - Speed Insights (script 0.1.3) passes `{ type: "vital", url, route }`, where
 *   `url` is `location.href` (query and fragment included), and copies back
 *   only the returned `url`. Its route can also lag behind a client navigation,
 *   so the route is checked on its own.
 * Either way, an unsafe path can only be kept out by dropping the whole event
 * (`null`). Encoded token characters are kept and scrubbed; encoded route
 * segments are dropped. An unparsable URL or malformed percent-encoding also
 * drops the event. A real page view never has a trailing slash (Next
 * 308-redirects it away), so dropping `/m/<token>/` or `/s/<token>/` loses nothing.
 *
 * Web Analytics sends a referrer only when it is another host, so a same-site
 * referrer never carries a token either.
 */
export function scrubVercelEvent<T extends { url: string; route?: string }>(event: T): T | null {
  try {
    if (isUnsafePath(new URL(event.url).pathname) || (event.route !== undefined && isUnsafePath(event.route))) {
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
