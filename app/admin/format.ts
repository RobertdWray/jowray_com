/**
 * Display helpers for the admin pages. Vercel renders in UTC, so every date is
 * shown in the family's zone. Pure; used by Server Components only.
 */

const DATE_TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium" });

export function formatDateTime(value: Date | null | undefined): string {
  return value ? DATE_TIME.format(value) : "—";
}

export function formatDate(value: Date | null | undefined): string {
  return value ? DATE.format(value) : "—";
}

export const STATUS_LABEL = { DRAFT: "Draft", PENDING: "Pending", APPROVED: "Approved", HIDDEN: "Hidden" } as const;

export const SOURCE_LABEL = { WEB_UPLOAD: "Sent from the site", EMAIL: "From an email", SMS: "From a text", OTHER: "Pasted by the family", PHONE_CALL: "Phone call" } as const;

export const CHANGED_VIA_LABEL = { WEB: "Site", SMS: "Text", CLAIM_LINK: "Their link", ADMIN: "Family admin" } as const;

/** A JSON value from a revision snapshot, in one readable line. */
export function describeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "(empty)";
  }
  if (typeof value === "string") {
    return value.length === 0 ? "(empty)" : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "(none)" : value.map(describeValue).join(", ");
  }
  return JSON.stringify(value);
}

/** The keys a revision touched: everything in `before` or `after`, in a stable order. */
export function changedKeys(before: unknown, after: unknown): string[] {
  const keys = new Set<string>();
  for (const side of [before, after]) {
    if (side && typeof side === "object" && !Array.isArray(side)) {
      for (const key of Object.keys(side)) {
        keys.add(key);
      }
    }
  }
  return [...keys];
}

export function valueOf(snapshot: unknown, key: string): unknown {
  return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? (snapshot as Record<string, unknown>)[key] : undefined;
}
