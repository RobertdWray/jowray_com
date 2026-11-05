import { describe, expect, it } from "vitest";

import { EMAIL_ASSETS } from "@/lib/email-assets";
import { ADMIN_ALERTS_PAUSED_SUBJECT, buildAdminAlertsPaused } from "@/services/email/templates/admin-alerts-paused";

describe("buildAdminAlertsPaused (issue #46, D4)", () => {
  it("is fixed content with the cap, and like every admin email carries no link of any kind", () => {
    const { subject, text, html, attachments } = buildAdminAlertsPaused({ cap: 20 });
    expect(subject).toBe(ADMIN_ALERTS_PAUSED_SUBJECT);
    expect(text).toContain("More than 20 new memories arrived in the last hour");
    expect(text).toContain("paused until the hour has passed");
    expect(html).toContain("More than 20 new memories arrived in the last hour");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("/m/");
    expect(html).not.toMatch(/src="https?:/);
    expect(new Set(attachments.map((a) => a.contentId))).toEqual(new Set([EMAIL_ASSETS.heart.contentId, EMAIL_ASSETS.heartStitched.contentId]));
  });

  it("never shows a cap below one", () => {
    expect(buildAdminAlertsPaused({ cap: 0 }).text).toContain("More than 1 new memories");
  });
});
