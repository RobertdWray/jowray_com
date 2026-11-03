/**
 * Remembers name, email and "how you knew Jo" in the browser so a contributor
 * who shares more than one memory does not retype them (Rob, 2026-11-03).
 *
 * Stored in localStorage, not a cookie: it stays on the device and never
 * travels with requests. Storage may be unavailable (private browsing, blocked
 * site data); every access treats that as "nothing remembered".
 */

const STORAGE_KEY = "jowray.contributor";
const FIELDS = ["name", "email", "relationship"] as const;
const MAX_LENGTH = 254; // the longest of the three inputs (email)

type Field = (typeof FIELDS)[number];

export type RememberedContributor = Partial<Record<Field, string>>;

function cleanField(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_LENGTH ? trimmed : null;
}

/** JSON for storage, or null when none of the fields has a value worth keeping. */
export function serializeRemembered(values: Record<Field, string>): string | null {
  const kept: RememberedContributor = {};
  for (const field of FIELDS) {
    const clean = cleanField(values[field]);
    if (clean !== null) {
      kept[field] = clean;
    }
  }
  return Object.keys(kept).length > 0 ? JSON.stringify(kept) : null;
}

/** The remembered fields from a stored string; null for nothing, garbage or a wrong shape. */
export function parseRemembered(raw: string | null): RememberedContributor | null {
  if (raw === null) {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const kept: RememberedContributor = {};
  for (const field of FIELDS) {
    const clean = cleanField((data as Record<string, unknown>)[field]);
    if (clean !== null) {
      kept[field] = clean;
    }
  }
  return Object.keys(kept).length > 0 ? kept : null;
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage blocked: behave as if nothing were remembered
  }
}

let cachedRaw: string | null | undefined;
let cachedValue: RememberedContributor | null = null;

/** Snapshot for useSyncExternalStore: stable while the stored string is unchanged. */
export function getRememberedSnapshot(): RememberedContributor | null {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parseRemembered(raw);
  }
  return cachedValue;
}

export function getRememberedServerSnapshot(): RememberedContributor | null {
  return null;
}

/** Other tabs' writes arrive as `storage` events; this tab's own writes are read on the next render. */
export function subscribeRemembered(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function rememberContributor(values: Record<Field, string>): void {
  const raw = serializeRemembered(values);
  try {
    if (raw === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, raw);
    }
  } catch {
    // storage blocked or full: the memory was saved; only the convenience is lost
  }
}
