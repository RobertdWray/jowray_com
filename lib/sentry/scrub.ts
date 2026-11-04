import type { Breadcrumb, Event } from "@sentry/nextjs";

import { SECRET_FIELD_KEYS, SECRET_HEADER_KEYS, SECRET_KEY_FRAGMENTS } from "@/lib/sentry/secrets";

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
 *
 * Scrubber v2 (plan 2026-11-04 §7.3) adds key-based filtering: with the alpha
 * data policy (lib/sentry/data-collection.ts) request bodies, contexts, stack
 * locals and Server Function inputs/outputs now leave the process, and the
 * bearer secrets named in lib/sentry/secrets.ts are removed from all of them
 * whatever their shape: object, array, or serialized JSON text.
 */

// A claim path is `/m/` followed by a base64url token (16+ chars); the token
// may be followed by anything (slash, query, whitespace in a log message).
const CLAIM_PATH = /\/m\/[A-Za-z0-9_-]{16,}/g;
// Every `t=` parameter in a full URL (`?t=…`, `&t=…`) or a bare query string
// (`t=…`), stopping at `&`, `#` or whitespace; the delimiter is not consumed
// so consecutive `t=` parameters are all matched.
const TOKEN_QUERY = /(^|[?&])t=[^&#\s]*(?=[&#\s]|$)/g;

export function scrubUrl(url: string): string {
  const withoutPath = url.replace(CLAIM_PATH, "/m/[claimToken]");
  const withoutToken = withoutPath.replace(TOKEN_QUERY, "$1");
  if (withoutToken === withoutPath) {
    return withoutToken; // nothing removed: leave punctuation in ordinary text alone
  }
  return withoutToken
    .replace(/\?&+/g, "?")
    .replace(/&&+/g, "&")
    .replace(/[?&](?=[#\s]|$)/g, "")
    .replace(/^&+/, "");
}

const FILTERED = "[Filtered]";
// Same cap as `redactPii` in lib/logger: deep enough for any payload here, finite for cycles.
const MAX_DEPTH = 20;

const SECRET_FIELD_SET = new Set<string>(SECRET_FIELD_KEYS.map((key) => key.toLowerCase()));

/** A key is a secret when it is one of the field keys or contains a fragment (case-insensitive). */
export function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_FIELD_SET.has(lower) || SECRET_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

// Server Function inputs and results reach Sentry as serialized text too
// (`request.data`, recorded responses, replay network bodies), sometimes
// double-encoded (the Blob client's `clientPayload` is a JSON string inside
// JSON). Text that parses as JSON is scrubbed as a value, which handles any
// nesting and any encoding depth; text that does not parse (truncated bodies,
// `key=value` fragments) goes through this regex, which matches a JSON member
// whose key is a secret, quotes escaped or not, and replaces its value up to
// the next unescaped quote, bracket or brace, or the end of the text.
const JSON_SECRET_KEY = `(?:${SECRET_FIELD_KEYS.join("|")}|[^"\\\\]*(?:${SECRET_KEY_FRAGMENTS.join("|")})[^"\\\\]*)`;
const JSON_SECRET_MEMBER = new RegExp(
  `\\\\?"(${JSON_SECRET_KEY})\\\\?"\\s*:\\s*(?:\\\\?"(?:[^"\\\\]|\\\\.)*"?|\\[[^\\]]*\\]?|\\{[^}]*\\}?|[^,}\\]\\s]*)`,
  "gi"
);

function scrubText(text: string, depth: number): string {
  if (text.length > 1 && (text[0] === "{" || text[0] === "[") && depth <= MAX_DEPTH) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = undefined; // not JSON (or cut off): the regex below is the fallback
    }
    if (parsed !== undefined && typeof parsed === "object" && parsed !== null) {
      return JSON.stringify(scrubValue(parsed, depth + 1));
    }
  }
  return scrubUrl(text.replace(JSON_SECRET_MEMBER, `"$1":"${FILTERED}"`));
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return scrubText(value, depth);
  }
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) ? FILTERED : scrubValue(entry, depth + 1);
  }
  return out;
}

/**
 * Recursive over objects and arrays: a secret key's value becomes
 * `"[Filtered]"` whatever its type; every string loses claim URLs and any
 * serialized JSON member with a secret key.
 */
export function scrubSecrets(value: unknown): unknown {
  return scrubValue(value, 0);
}

const SECRET_HEADER_SET = new Set<string>(SECRET_HEADER_KEYS);

/** Drops the bearer headers (case-insensitive) and keeps the rest. */
export function scrubHeaders<H extends Record<string, unknown>>(headers: H): H {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!SECRET_HEADER_SET.has(key.toLowerCase())) {
      out[key] = value;
    }
  }
  return out as H;
}

/**
 * Error and message events. `event.user` is deliberately untouched: the
 * contributor's email and name are wanted (plan §3 ruling 1).
 */
export function scrubEvent<E extends Event>(event: E): E {
  if (event.transaction) {
    event.transaction = scrubUrl(event.transaction);
  }
  if (event.request) {
    if (event.request.url) {
      event.request.url = scrubUrl(event.request.url);
    }
    delete event.request.query_string;
    if (event.request.data !== undefined) {
      event.request.data = scrubSecrets(event.request.data);
    }
    if (event.request.headers) {
      event.request.headers = scrubHeaders(event.request.headers);
    }
  }
  if (event.contexts) {
    event.contexts = scrubSecrets(event.contexts) as E["contexts"];
  }
  if (event.extra) {
    event.extra = scrubSecrets(event.extra) as E["extra"];
  }
  for (const exception of event.exception?.values ?? []) {
    for (const frame of exception.stacktrace?.frames ?? []) {
      if (frame.vars) {
        frame.vars = scrubSecrets(frame.vars) as typeof frame.vars;
      }
    }
  }
  if (event.spans) {
    for (const span of event.spans) {
      if (span.data) {
        span.data = scrubSecrets(span.data) as typeof span.data;
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
    breadcrumb.data = scrubSecrets(breadcrumb.data) as typeof breadcrumb.data;
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
    span.data = scrubSecrets(span.data) as S["data"];
  }
  if (span.attributes) {
    span.attributes = scrubSecrets(span.attributes) as S["attributes"];
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
    log.attributes = scrubSecrets(log.attributes) as L["attributes"];
  }
  return log;
}

/** Any browser event; the replay metadata event (`replay_event`) also carries the page URLs visited during the segment. */
type AnyBrowserEvent = Event & { urls?: string[] };

/**
 * Global event processor for the browser. `beforeSend` runs only for error
 * and message events: replay metadata (`replay_event`) and feedback
 * (`feedback`) events skip it, yet both carry `request.url` (the page URL,
 * `/m/<token>` on a claim page) and feedback carries `contexts.feedback.url`.
 * So every event goes through `scrubEvent` here (idempotent, so the
 * `beforeSend` pass is harmless) and a replay event's `urls` list as well.
 * Events are always returned (returning nothing would drop them).
 */
export function scrubReplayEvent<E extends AnyBrowserEvent>(event: E): E {
  scrubEvent(event);
  if (event.urls) {
    event.urls = event.urls.map(scrubUrl);
  }
  return event;
}

/** A replay custom event (`beforeAddRecordingEvent`): network bodies, console args, breadcrumbs. */
export interface RecordingEventLike {
  type: number;
  timestamp: number;
  data: { tag: string; payload: unknown };
}

/**
 * `beforeAddRecordingEvent` sees only custom events (network details, console,
 * breadcrumbs), never DOM snapshots; the payload is scrubbed as a whole.
 */
export function scrubRecordingEvent<R extends RecordingEventLike>(event: R): R {
  event.data.payload = scrubSecrets(event.data.payload);
  return event;
}
