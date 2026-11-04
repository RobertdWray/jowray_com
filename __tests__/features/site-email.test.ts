import { describe, expect, it } from "vitest";

import { ADMIN_ALERT_WHERE, SITE_EMAIL_WHERE, siteAlertsAdmins, siteEmailsConfirmation } from "@/features/memories/site-email";

const STATUSES = ["DRAFT", "PENDING", "APPROVED", "HIDDEN"] as const;
const SOURCES = ["PHONE_CALL", "SMS", "WEB_UPLOAD", "EMAIL", "OTHER"] as const;

/** The subset of Prisma `where` the fragments use: equality and `{ not }` on scalars. */
function matches(row: Record<string, string>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const actual = row[key];
    if (cond !== null && typeof cond === "object" && "not" in cond) {
      return actual !== (cond as { not: unknown }).not;
    }
    return actual === cond;
  });
}

describe("site-email predicates agree with their Prisma where fragments", () => {
  it("for every status × source, so the cron never selects a row the sender then skips", () => {
    for (const status of STATUSES) {
      for (const source of SOURCES) {
        const row = { status, source };
        expect(siteEmailsConfirmation(row), `confirmation ${status}/${source}`).toBe(matches(row, SITE_EMAIL_WHERE));
        expect(siteAlertsAdmins(row), `admin alert ${status}/${source}`).toBe(matches(row, ADMIN_ALERT_WHERE));
      }
    }
  });
});
