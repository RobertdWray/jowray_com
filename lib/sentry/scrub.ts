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
 * Claim and invite tokens travel in URLs (`/m/<token>`, `/s/<token>`, `?t=<token>`), and the admin
 * entry key in a fragment (`/admin/enter#key=<secret>`). Sentry events,
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
// Invite tokens are 12 base64url characters; also scrub longer values and upper-case paths.
const INVITE_PATH = /\/s\/[A-Za-z0-9_-]{12,}/gi;
// Every `t=` (claim token), `key=` (admin entry key), or Blob presign credential
// (`vercel-blob-signature`, `vercel-blob-delegation`) parameter in a full URL
// (`?t=…`, `&t=…`, `#key=…`) or a bare query string (`t=…`), stopping at `&`,
// `#` or whitespace; the delimiter is not consumed so consecutive parameters
// are all matched. `#` is a delimiter because the admin entry link carries its
// key in the fragment and the browser SDK records `location.href` with it.
const TOKEN_QUERY = /(^|[?&#])(t|key|vercel-blob-signature|vercel-blob-delegation)=[^&#\s]*(?=[&#\s]|$)/g;

export function scrubUrl(url: string): string {
  const withoutPath = url.replace(CLAIM_PATH, "/m/[claimToken]").replace(INVITE_PATH, "/s/[inviteToken]");
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
//
// The scanner is hand-written and linear (public-repo audit, issue #43 T3).
// Its predecessor was a backtracking regex, `(\\?")(…|[^"\\]*(?:token|ticket)[^"\\]*)(\\?")\s*:\s*`,
// whose two unbounded runs around the alternation made it quadratic on text
// like `"tokentoken…`: 9 ms at 10,001 characters, 1,908 ms at 160,001
// (2026-11-05). `scrubSecrets` runs on the raw input of every public Server
// Function before validation, so that was a one-request CPU exhaustion.

/**
 * Longest single string the scrubber inspects; a longer one is replaced whole
 * by `OVERSIZED` (fail closed: an uninspected string never leaves). The cap sits
 * above everything legitimate: a 10,000-character note (lib/validations/memory.ts),
 * a whole 10 × 10,000-character submission body (about 100 KB of JSON), and the
 * 150,000-character cap Sentry Replay puts on captured network bodies.
 */
export const MAX_SCRUB_TEXT_LENGTH = 256 * 1024;
export const OVERSIZED = "[Filtered: oversized]";

// Sticky, so each `exec` reads one run forward from `lastIndex` and never backtracks.
const KEY_RUN = /[^"\\]*/y; // a key has no quote and no backslash in it
const MEMBER_COLON = /\s*:\s*/y; // what separates a member's key from its value

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

/**
 * One left-to-right pass. Every `"` is a candidate opening quote (`\"` when a
 * backslash precedes it: the member lives inside an outer JSON string). The key
 * is the run up to the next quote or backslash, the close is `"` or `\"`, then
 * `\s*:\s*`. A candidate that fails is abandoned at the point it failed and the
 * search resumes at the next quote, so each character is read a bounded number
 * of times whatever the text looks like. The matching rule is the same as the
 * old regex: a whole field key or any key containing a fragment, case-insensitive.
 */
function scrubMembers(text: string): string {
  let out = "";
  let last = 0; // start of the text not yet copied to `out`
  let i = text.indexOf('"');
  while (i !== -1) {
    // A backslash before the quote, and not part of a value already replaced, makes this an escaped member.
    const escaped = i > last && text[i - 1] === "\\";
    const openStart = escaped ? i - 1 : i;
    const keyStart = i + 1;
    KEY_RUN.lastIndex = keyStart;
    const key = KEY_RUN.exec(text)?.[0] ?? "";
    const keyEnd = keyStart + key.length;
    const closeLength = text[keyEnd] === '"' ? 1 : text[keyEnd] === "\\" && text[keyEnd + 1] === '"' ? 2 : 0;
    if (closeLength === 0 || !isSecretKey(key)) {
      i = text.indexOf('"', keyEnd); // the closing quote (if any) is the next candidate
      continue;
    }
    MEMBER_COLON.lastIndex = keyEnd + closeLength;
    const separator = MEMBER_COLON.exec(text)?.[0];
    if (separator === undefined) {
      i = text.indexOf('"', keyEnd);
      continue;
    }
    // The key's quoting decides how far the value runs, exactly as the regex scanner did. In malformed text the
    // key's quoting and the value's can disagree (`\"token":"x"`, `"token\":\"x y\"`); do not try to be cleverer
    // here. Reading the value another way moves where the scan resumes, and both directions have been shown to
    // swallow the opening quote of the *next* member and hide it (PR #47 regression review: an escaped key before
    // a plain `"` hid `"claimToken"`; a plain key before `\"` hid `"ticket\"`). `__tests__/lib/sentry-scrub-differential.test.ts`
    // pins byte-for-byte equality with the regex scanner over a seeded corpus of such text.
    const end = valueEnd(text, keyEnd + closeLength + separator.length, escaped);
    // The marker is written in the member's own quoting, so a double-encoded string stays well formed (and a second pass is a no-op).
    const quote = escaped ? '\\"' : '"';
    out += `${text.slice(last, openStart)}${quote}${key}${text.slice(keyEnd, keyEnd + closeLength)}:${quote}${FILTERED}${quote}`;
    last = end;
    i = text.indexOf('"', end);
  }
  return out + text.slice(last);
}

const ROUTE_TOKEN_KEYS = ["inviteToken", "claimToken"];
const WHITESPACE = /\s*/y;

function skipTupleWhitespace(text: string, at: number): number {
  while (at < text.length) {
    WHITESPACE.lastIndex = at;
    at += WHITESPACE.exec(text)?.[0].length ?? 0;
    // An outer JSON string encodes the tuple's newline/tab/carriage return.
    if (text[at] === "\\" && (text[at + 1] === "n" || text[at + 1] === "r" || text[at + 1] === "t")) {
      at += 2;
    } else {
      break;
    }
  }
  return at;
}

/**
 * D21: Flight/router state also carries bare ["inviteToken", "value", "d"]
 * tuples, including escaped quotes inside serialized JSON strings. Scan from
 * each `[` forward, retaining the original quoting/whitespace around the value.
 * Failed candidates resume where they failed; matched string values are consumed
 * once (including truncation to EOF). No suffix is repeatedly scanned, so this
 * pass stays linear even on repeated tuple starts or unterminated values.
 */
function scrubTuples(text: string): string {
  let out = "";
  let last = 0;
  let start = text.indexOf("[");
  while (start !== -1) {
    let at = skipTupleWhitespace(text, start + 1);
    const quote = text.startsWith('\\"', at) ? '\\"' : text[at] === '"' ? '"' : undefined;
    if (quote === undefined) {
      start = text.indexOf("[", at);
      continue;
    }
    at += quote.length;
    const key = ROUTE_TOKEN_KEYS.find((name) => text.startsWith(name + quote, at));
    if (key === undefined) {
      start = text.indexOf("[", at);
      continue;
    }
    at = skipTupleWhitespace(text, at + key.length + quote.length);
    if (text[at] !== ",") {
      start = text.indexOf("[", at);
      continue;
    }
    at = skipTupleWhitespace(text, at + 1);
    if (!text.startsWith(quote, at)) {
      start = text.indexOf("[", at);
      continue;
    }
    const end = stringEnd(text, at + quote.length, quote.length === 2);
    out += `${text.slice(last, at)}${quote}${FILTERED}${quote}`;
    last = end;
    start = text.indexOf("[", end);
  }
  return out + text.slice(last);
}

/** Skip only the adjacent whitespace before an anchor, including escaped JSON whitespace. */
function skipWhitespaceBack(text: string, at: number): number {
  while (at > 0) {
    if (/\s/.test(text[at - 1])) {
      at -= 1;
    } else if (at > 1 && text[at - 2] === "\\" && (text[at - 1] === "n" || text[at - 1] === "r" || text[at - 1] === "t")) {
      at -= 2;
    } else {
      break;
    }
  }
  return at;
}

/**
 * Find parameter names without relying on quote pairing in earlier Flight text.
 * Each literal has its own cached indexOf cursor; searching for an absent name
 * never repeatedly scans the suffix when the other name occurs many times.
 * Backward checks touch only adjacent whitespace and the fixed `"n":` prefix.
 * Whitespace runs cannot overlap between anchors, so their total cost is linear.
 */
function* transportSegmentAnchors(text: string, quote: string): Generator<{ start: number; end: number }> {
  const candidates = ROUTE_TOKEN_KEYS.map((name) => {
    const literal = `${quote}${name}${quote}`;
    return { literal, at: text.indexOf(literal) };
  });
  const member = `${quote}n${quote}`;
  while (true) {
    let candidate: (typeof candidates)[number] | undefined;
    for (const current of candidates) {
      if (current.at !== -1 && (!candidate || current.at < candidate.at)) {
        candidate = current;
      }
    }
    if (!candidate) {
      return;
    }
    const nameStart = candidate.at;
    const end = nameStart + candidate.literal.length;
    candidate.at = text.indexOf(candidate.literal, end);
    const colon = skipWhitespaceBack(text, nameStart) - 1;
    if (text[colon] !== ":") {
      continue;
    }
    const start = skipWhitespaceBack(text, colon) - member.length;
    if (start >= 0 && text.startsWith(member, start)) {
      yield { start, end };
    }
  }
}

/**
 * Next's RSC response segments use {n: paramName, t: type, k: value, s: siblings}.
 * Start at each verified `n` anchor, so an unmatched quote in a raw Flight T row
 * or log prefix cannot hide a later segment. From there, track object/array
 * nesting and consume strings to reach the same object's `k` (or its closing
 * brace). Strings cannot consume a later anchor unless replaced as a secret.
 *
 * Overlapping/nested anchors share one forward walk and a stack of pending
 * objects rather than walking the same suffix again for each `n`. The cached
 * anchor cursors also move only forward. Each character is visited a bounded
 * number of times, even for repeated `n` members without a `k` or closing brace.
 * Plain and escaped quoting each get one pass; surrounding text is preserved.
 */
function scrubTransportSegments(text: string, escaped = false): string {
  const quote = escaped ? '\\"' : '"';
  const anchors = transportSegmentAnchors(text, quote);
  const nextAnchor = () => {
    const next = anchors.next();
    return next.done ? undefined : next.value;
  };
  let anchor = nextAnchor();
  const containers: Array<{ object: boolean; tokenParam: boolean }> = [];
  let out = "";
  let last = 0;
  let at = 0;
  while (at < text.length) {
    if (containers.length === 0) {
      if (!anchor) {
        break;
      }
      at = anchor.start;
      containers.push({ object: true, tokenParam: false });
    }
    if (anchor && at === anchor.start) {
      const container = containers.at(-1);
      if (container?.object) {
        container.tokenParam = true;
      } else {
        // Resync even when malformed text before this anchor hid its opening brace.
        containers.push({ object: true, tokenParam: true });
      }
      at = anchor.end;
      anchor = nextAnchor();
      continue;
    }
    const c = text[at];
    if (c === "{" || c === "[") {
      containers.push({ object: c === "{", tokenParam: false });
      at += 1;
      continue;
    }
    if (c === "}" || c === "]") {
      containers.pop();
      at += 1;
      continue;
    }
    if (!escaped && text.startsWith('\\"', at)) {
      at += 2; // leave escaped strings for the second pass
      continue;
    }
    if (!text.startsWith(quote, at)) {
      at += 1;
      continue;
    }
    const end = stringEnd(text, at + quote.length, escaped);
    if (anchor && end > anchor.start) {
      at = anchor.start; // discard poisoned quote pairing and resync at this name
      continue;
    }
    const key = text.slice(at + quote.length, end - quote.length);
    const colon = skipTupleWhitespace(text, end);
    at = colon;
    if (text[colon] !== ":") {
      continue;
    }
    at = skipTupleWhitespace(text, colon + 1);
    const container = containers.at(-1);
    if (!container?.object) {
      continue;
    }
    if (key === "n") {
      container.tokenParam = false; // a non-token name; matching names are handled as anchors above
    } else if (key === "k" && container.tokenParam) {
      container.tokenParam = false;
      if (text.startsWith(quote, at)) {
        const valueEnd = stringEnd(text, at + quote.length, escaped);
        out += `${text.slice(last, at)}${quote}${FILTERED}${quote}`;
        last = valueEnd;
        at = valueEnd;
        while (anchor && anchor.start < at) {
          anchor = nextAnchor(); // already removed as part of this secret value
        }
      }
    }
  }
  const scrubbed = out + text.slice(last);
  return escaped ? scrubbed : scrubTransportSegments(scrubbed, true);
}

function scrubText(text: string, depth: number): string {
  if (text.length > MAX_SCRUB_TEXT_LENGTH) {
    return OVERSIZED; // bounded before any parse or scan; nothing uninspected leaves
  }
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
  return scrubUrl(scrubMembers(scrubTransportSegments(scrubTuples(text))));
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
    const isTokenTuple = ROUTE_TOKEN_KEYS.includes(value[0]) && typeof value[1] === "string";
    return value.map((entry, index) => isTokenTuple && index === 1 ? FILTERED : scrubValue(entry, depth + 1));
  }
  const out: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;
  const isTokenSegment = typeof record.n === "string" && ROUTE_TOKEN_KEYS.includes(record.n) && typeof record.k === "string";
  for (const [key, entry] of Object.entries(record)) {
    out[key] = isSecretKey(key) || (isTokenSegment && key === "k") ? FILTERED : scrubValue(entry, depth + 1);
  }
  return out;
}

/**
 * Recursive over objects and arrays: a secret key's value becomes
 * `"[Filtered]"` whatever its type; every string loses claim/invite URLs and
 * serialized secret members. Router tuples lose their second element's value;
 * RSC response segments lose their `k` value when `n` names a bearer parameter.
 */
export function scrubSecrets(value: unknown): unknown {
  return scrubValue(value, 0);
}

/** One string (a message, a description, a header value): bearer URLs, secret members and router tuple values removed. */
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
