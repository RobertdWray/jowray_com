"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

import { scrubUrl } from "@/lib/sentry/scrub";

/**
 * Vercel Web Analytics, with bearer secrets removed from every URL it sends.
 *
 * A claim link carries its token in the path (`/m/<token>`) or query (`?t=`),
 * and the admin entry link carries its key in the fragment (`#key=`). Project
 * policy forbids those leaving the browser anywhere (docs/code-layout.md,
 * "Sentry"), so each page view and custom event goes through the same
 * `scrubUrl` the Sentry scrubber uses. The analytics script sends a referrer
 * only when it is another host, so a same-site referrer never carries one.
 */
export function scrubPageView(event: BeforeSendEvent): BeforeSendEvent {
  return { ...event, url: scrubUrl(event.url) };
}

export function SiteAnalytics() {
  return <Analytics beforeSend={scrubPageView} />;
}
