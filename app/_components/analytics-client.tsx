"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

import { scrubUrl } from "@/lib/sentry/scrub";

// Any path with an `m` segment (any case, at any depth) can carry a claim token.
const CLAIM_SEGMENT = /\/m\//i;
// The claim page itself: lower-case `m`, one non-empty segment, no trailing slash.
const CLAIM_ROUTE = /^\/m\/[^/]+$/;

/**
 * Vercel Web Analytics, with bearer secrets kept out of everything it sends.
 *
 * A claim link carries its token in the path (`/m/<token>`), and the admin
 * entry link carries its key in the fragment (`#key=`); `?t=` is removed too.
 * Project policy forbids those leaving the browser anywhere
 * (docs/code-layout.md, "Sentry").
 *
 * The script sends two copies of the path. `url` (`o`) passes through this
 * `beforeSend`, so it goes through the same `scrubUrl` the Sentry scrubber
 * uses. The route (`dp`) does not: the Next wrapper builds it from
 * `useParams()`, so on the claim page it is `/m/[claimToken]`, but on any path
 * no page matched (the root not-found page) it is the raw pathname, token
 * included. `beforeSend` cannot rewrite `dp`; it can only drop the whole event
 * by returning `null`. So any path with an `m` segment that is not exactly the
 * claim route is dropped, as is a URL that does not parse. A real claim page
 * view never has a trailing slash (Next 308-redirects it away), so dropping
 * `/m/<token>/` loses nothing.
 *
 * The script sends a referrer only when it is another host, so a same-site
 * referrer never carries a token either.
 */
export function scrubPageView(event: BeforeSendEvent): BeforeSendEvent | null {
  let pathname: string;
  try {
    pathname = new URL(event.url).pathname;
  } catch {
    return null;
  }
  if (CLAIM_SEGMENT.test(pathname) && !CLAIM_ROUTE.test(pathname)) {
    return null;
  }
  // Spread: the runtime event carries fields beyond its declared type (`payload`, `__cdp`) that the script reads back.
  return { ...event, url: scrubUrl(event.url) };
}

export function SiteAnalytics() {
  return <Analytics beforeSend={scrubPageView} />;
}
