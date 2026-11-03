import type { Breadcrumb, Event } from "@sentry/nextjs";

/** The parts of a streamed span (`beforeSendSpan`, Sentry v11) that can carry a URL. */
export interface StreamedSpan {
  name?: string;
  description?: string;
  data?: object;
  attributes?: object;
}

/**
 * Claim tokens travel in the URL (`/m/<token>`, `?t=<token>`). Sentry events,
 * transactions, spans and breadcrumbs all carry URLs, so every one of them is
 * passed through here on the server and in the browser before it leaves the
 * process. Pure functions: no Sentry calls, safe in Client Components.
 */

const CLAIM_PATH = /\/m\/[A-Za-z0-9_-]{16,}(?=\/|\?|#|$)/g;
// Matches `t=` in a full URL (`?t=…`, `&t=…`) and in a bare query string (`t=…`).
const TOKEN_QUERY = /(^|[?&])t=[^&#]*(&?)/g;

export function scrubUrl(url: string): string {
  return url
    .replace(CLAIM_PATH, "/m/[claimToken]")
    .replace(TOKEN_QUERY, (_match, sep: string, next: string) => (next ? sep : ""))
    .replace(/\?$/, "");
}

function scrubUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return scrubUrl(value);
  }
  if (Array.isArray(value)) {
    return value.map(scrubUnknown);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = scrubUnknown(entry);
    }
    return out;
  }
  return value;
}

export function scrubEvent<E extends Event>(event: E): E {
  if (event.transaction) {
    event.transaction = scrubUrl(event.transaction);
  }
  if (event.request) {
    if (event.request.url) {
      event.request.url = scrubUrl(event.request.url);
    }
    delete event.request.query_string;
  }
  if (event.spans) {
    for (const span of event.spans) {
      if (span.data) {
        span.data = scrubUnknown(span.data) as typeof span.data;
      }
    }
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  }
  return event;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.message) {
    breadcrumb.message = scrubUrl(breadcrumb.message);
  }
  if (breadcrumb.data) {
    breadcrumb.data = scrubUnknown(breadcrumb.data) as typeof breadcrumb.data;
  }
  return breadcrumb;
}

/**
 * Streamed spans (`traceLifecycle: "stream"`, the v11 default) never pass
 * through `beforeSendTransaction`; this runs on each one. The HTTP server
 * span's `url.path`/`url.full` otherwise carry `/m/<token>`.
 */
export function scrubSpan<S extends StreamedSpan>(span: S): S {
  if (typeof span.description === "string") {
    span.description = scrubUrl(span.description);
  }
  if (typeof span.name === "string") {
    span.name = scrubUrl(span.name);
  }
  if (span.data) {
    span.data = scrubUnknown(span.data) as S["data"];
  }
  if (span.attributes) {
    span.attributes = scrubUnknown(span.attributes) as S["attributes"];
  }
  return span;
}
