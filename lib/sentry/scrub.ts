import type { Breadcrumb, Event } from "@sentry/nextjs";

/** The parts of a streamed span (`beforeSendSpan`, Sentry v11) that can carry a URL. */
export interface StreamedSpan {
  name?: string;
  description?: string;
  data?: object;
  attributes?: object;
}

/**
 * Claim tokens travel in the URL (`/m/<token>`, `?t=<token>`), and the admin
 * entry key in a fragment (`/admin/enter#key=<secret>`). Sentry events,
 * transactions, spans and breadcrumbs all carry URLs, so every one of them is
 * passed through here on the server and in the browser before it leaves the
 * process. Pure functions: no Sentry calls, safe in Client Components.
 */

// A claim path is `/m/` followed by a base64url token (16+ chars); the token
// may be followed by anything (slash, query, whitespace in a log message).
const CLAIM_PATH = /\/m\/[A-Za-z0-9_-]{16,}/g;
// Every `t=` (claim token) or `key=` (admin entry key) parameter in a full URL
// (`?t=…`, `&t=…`, `#key=…`) or a bare query string (`t=…`), stopping at `&`,
// `#` or whitespace; the delimiter is not consumed so consecutive parameters
// are all matched. `#` is a delimiter because the admin entry link carries its
// key in the fragment and the browser SDK records `location.href` with it.
const TOKEN_QUERY = /(^|[?&#])(t|key)=[^&#\s]*(?=[&#\s]|$)/g;

export function scrubUrl(url: string): string {
  const withoutPath = url.replace(CLAIM_PATH, "/m/[claimToken]");
  const withoutToken = withoutPath.replace(TOKEN_QUERY, "$1");
  if (withoutToken === withoutPath) {
    return withoutToken; // nothing removed: leave punctuation in ordinary text alone
  }
  return withoutToken
    .replace(/\?&+/g, "?")
    .replace(/#&+/g, "#")
    .replace(/&&+/g, "&")
    .replace(/[?&](?=[#\s]|$)/g, "")
    .replace(/#(?=\s|$)/g, "")
    .replace(/^&+/, "");
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

/** Shape of a Sentry Log item as handed to `beforeSendLog`. */
export interface ScrubbableLog {
  message?: string;
  attributes?: Record<string, unknown>;
}

/**
 * Sentry Logs (the Pino integration streams them) never pass through
 * `beforeSend`; this runs on each log item.
 */
export function scrubLog<L extends ScrubbableLog>(log: L): L {
  if (typeof log.message === "string") {
    log.message = scrubUrl(log.message);
  }
  if (log.attributes) {
    log.attributes = scrubUnknown(log.attributes) as L["attributes"];
  }
  return log;
}
