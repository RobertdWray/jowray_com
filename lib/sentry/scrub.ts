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
// (`request.data`, recorded responses, replay network bodies, log messages),
// sometimes double-encoded (the Blob client's `clientPayload` is a JSON string
// inside JSON) and sometimes as React Flight lines (`1:{...}`), which are not
// standalone JSON. Text that parses as JSON is scrubbed as a value, which
// handles any nesting and any encoding depth. Everything else goes through a
// scanner: every JSON member whose key is a secret (quotes escaped or not) has
// its whole value replaced, however deeply nested, and a value cut off by
// truncation is replaced to the end of the text (fail closed).
const JSON_SECRET_KEY = `(?:${SECRET_FIELD_KEYS.join("|")}|[^"\\\\]*(?:${SECRET_KEY_FRAGMENTS.join("|")})[^"\\\\]*)`;
const SECRET_MEMBER_KEY = new RegExp(`(\\\\?")(${JSON_SECRET_KEY})(\\\\?")\\s*:\\s*`, "gi");

/** Index just past a JSON string starting at `i` (after its opening quote). `escaped`: the string lives inside an outer JSON string, so its quotes are `\"`. */
function stringEnd(text: string, i: number, escaped: boolean): number {
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      if (!escaped) {
        i += 2; // `\x` is one plain escape
        continue;
      }
      if (text[i + 1] === '"') {
        return i + 2; // `\"` closes an escaped string
      }
      // Inside an escaped string an inner escape is `\\` + one char: `\\\\` (a backslash) and `\\\"` (a quote)
      // are four characters, anything else (`\\n`, `\\t`) is three.
      const third = text[i + 2];
      i += text[i + 1] === "\\" && (third === "\\" || third === '"') ? 4 : 3;
      continue;
    }
    if (c === '"' && !escaped) {
      return i + 1;
    }
    i += 1;
  }
  return text.length;
}

/** Index just past the JSON value starting at `i`, or `text.length` when the value is cut off. */
function valueEnd(text: string, i: number, escaped: boolean): number {
  const opensString = (at: number): number => (text[at] === '"' ? 1 : escaped && text[at] === "\\" && text[at + 1] === '"' ? 2 : 0);
  const quote = opensString(i);
  if (quote > 0) {
    return stringEnd(text, i + quote, escaped);
  }
  if (text[i] === "[" || text[i] === "{") {
    let depth = 0;
    let at = i;
    while (at < text.length) {
      const c = text[at];
      const q = opensString(at);
      if (q > 0) {
        at = stringEnd(text, at + q, escaped);
        continue;
      }
      if (c === "[" || c === "{") {
        depth += 1;
      } else if (c === "]" || c === "}") {
        depth -= 1;
        if (depth === 0) {
          return at + 1;
        }
      }
      at += 1;
    }
    return text.length;
  }
  const scalar = /[^,}\]\s]*/y;
  scalar.lastIndex = i;
  return i + (scalar.exec(text)?.[0].length ?? 0);
}

function scrubMembers(text: string): string {
  let out = "";
  let last = 0;
  SECRET_MEMBER_KEY.lastIndex = 0;
  for (let match = SECRET_MEMBER_KEY.exec(text); match !== null; match = SECRET_MEMBER_KEY.exec(text)) {
    if (match.index < last) {
      continue; // inside a value already replaced
    }
    const [whole, open, key, close] = match;
    const escaped = open === '\\"';
    const end = valueEnd(text, match.index + whole.length, escaped);
    // The marker is written in the member's own quoting, so a double-encoded string stays well formed (and a second pass is a no-op).
    const quote = escaped ? '\\"' : '"';
    out += `${text.slice(last, match.index)}${open}${key}${close}:${quote}${FILTERED}${quote}`;
    last = end;
    SECRET_MEMBER_KEY.lastIndex = end;
  }
  return out + text.slice(last);
}

function scrubText(text: string, depth: number): string {
  if (text.length > 1 && (text[0] === "{" || text[0] === "[") && depth <= MAX_DEPTH) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = undefined; // not JSON (or cut off): the scanner below is the fallback
    }
    if (parsed !== undefined && typeof parsed === "object" && parsed !== null) {
      return JSON.stringify(scrubValue(parsed, depth + 1));
    }
  }
  return scrubUrl(scrubMembers(text));
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return scrubText(value, depth);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth > MAX_DEPTH) {
    return FILTERED; // never let an uninspected subtree through (cycles end here too)
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

/** One string (a message, a description, a header value): claim URLs and serialized secret members removed. */
export function scrubString(text: string): string {
  return scrubText(text, 0);
}

const SECRET_HEADER_SET = new Set<string>(SECRET_HEADER_KEYS);

/** Drops the bearer and routing headers (case-insensitive); the kept values lose claim URLs (`next-url`, `referer`). */
export function scrubHeaders<H extends Record<string, unknown>>(headers: H): H {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!SECRET_HEADER_SET.has(key.toLowerCase())) {
      out[key] = typeof value === "string" ? scrubString(value) : value;
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
    breadcrumb.message = scrubString(breadcrumb.message);
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
    span.description = scrubString(span.description);
  }
  if (typeof span.name === "string") {
    span.name = scrubString(span.name);
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
    log.message = scrubString(log.message);
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
