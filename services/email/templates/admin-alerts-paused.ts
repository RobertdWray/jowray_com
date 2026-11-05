import type { EmailAttachment } from "../types";
import { BODY_FONT, brandAttachments, cardHeading, cardHtml, DISPLAY_FONT, escapeHtml, headlineRow, HEART_ROW, leadRow, renderDocument, STITCHED_HEART_ROW, WALNUT, WALNUT_SOFT } from "./shared";

/**
 * The one notice the family admins get when more memories arrive in an hour
 * than `ADMIN_ALERT_HOURLY_CAP` (issue #46, D4). It goes in place of the
 * alert that crossed the cap; the alerts after it that hour are skipped, and
 * the memories wait on the admin page. Fixed content, nothing contributor-
 * written, and, like every admin email, **no links** (ruling R2).
 *
 * Pure module (no server-only, no env).
 */

export const ADMIN_ALERTS_PAUSED_SUBJECT = "Memories are arriving quickly";
const HEADLINE = "Memories are arriving quickly.";
const FOOTER_LINE = "Admin alert from jowray.com. This email carries no links on purpose.";

export interface AdminAlertsPausedContent {
  /** The hourly cap that was reached. */
  cap: number;
}

export interface RenderedAdminAlertsPaused {
  subject: string;
  text: string;
  html: string;
  attachments: EmailAttachment[];
}

function lead(cap: number): string {
  return `More than ${cap} new memories arrived in the last hour, so the one-email-per-memory alerts are paused until the hour has passed. Nothing is lost: every memory is waiting on the admin page, and the alerts start again by themselves.`;
}

export function buildAdminAlertsPaused(input: AdminAlertsPausedContent): RenderedAdminAlertsPaused {
  const cap = Math.max(1, Math.floor(input.cap));
  const text = [HEADLINE, "", lead(cap), "", FOOTER_LINE].join("\n");
  const card = cardHtml(
    [
      cardHeading("What to do", 14),
      `<tr><td style="padding:0;font-family:${BODY_FONT};font-size:20px;line-height:1.5;color:${WALNUT};">Open the admin page when you have a moment. If the pace looks wrong rather than wonderful, that is the place to look first.</td></tr>`,
    ].join("\n")
  );
  const body = [
    HEART_ROW,
    "",
    headlineRow(HEADLINE),
    leadRow(escapeHtml(lead(cap))),
    "",
    card,
    `<tr><td style="height:20px;line-height:20px;font-size:0;">&nbsp;</td></tr>`,
    STITCHED_HEART_ROW,
    `<tr><td align="center" style="padding:0 0 8px 0;font-family:${DISPLAY_FONT};font-size:17px;line-height:1.4;color:${WALNUT_SOFT};">${escapeHtml(FOOTER_LINE)}</td></tr>`,
  ].join("\n");
  const html = renderDocument({ title: ADMIN_ALERTS_PAUSED_SUBJECT, preheader: lead(cap).slice(0, 110), body });
  return { subject: ADMIN_ALERTS_PAUSED_SUBJECT, text, html, attachments: brandAttachments(new Set()) };
}
