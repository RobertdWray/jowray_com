/**
 * TEST FIXTURE, NOT PRODUCTION CODE. The regex-based secret scanner exactly as
 * it was on `main` at 73609cf (file `lib/sentry/scrub.ts`, lines 27–203),
 * kept so `__tests__/lib/sentry-scrub-differential.test.ts` can prove that the
 * linear scanner never scrubs less than this one did (PR #47 regression
 * review). It is quadratic on adversarial text, which is why it was replaced;
 * the differential test keeps its inputs small. Do not import it from app code.
 */
import { SECRET_FIELD_KEYS, SECRET_KEY_FRAGMENTS } from "@/lib/sentry/secrets";

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
