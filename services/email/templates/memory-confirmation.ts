import type { EmailAttachment, MediaKind, MemoryConfirmationContent, ReceiptMediaSummary } from "../types";
import {
  BODY_FONT,
  brandAttachments,
  buildMediaCards,
  cardHeading,
  cardHtml,
  DISPLAY_FONT,
  escapeHtml,
  headlineRow,
  HEART_ROW,
  JO_RED,
  JO_RED_DEEP,
  JO_RED_SHADOW,
  leadRow,
  NOUN,
  renderCardHtml,
  renderCardText,
  renderDocument,
  STITCHED_HEART_ROW,
  stripControl,
  WALNUT,
  WALNUT_SOFT,
} from "./shared";

export { cleanNote, escapeHtml, formatSeconds, stripControl } from "./shared";

/**
 * The contributor's receipt, in the site's brand. Fixed content: the subject,
 * the copy, a "what you sent" line built from counts, the media cards (kind,
 * length, derived preview) and the private link. Nothing the visitor typed
 * (name, relationship, date, place, note, filenames) is echoed.
 *
 * Ruling (issue #46, D1 default, 2026-11-05): the receipt carries no
 * contributor-written text, because an anonymous `/share` send could otherwise
 * put a visitor's words, URLs included, into a jowray.com-signed email to any
 * address they chose. This replaces ruling R1 (2026-11-03, "the full note is
 * echoed"); the words are still on the private page the link opens.
 *
 * Images are inline CID attachments only (rulings R2/R4): the HTML never
 * references a URL, so no token and no tracking request leaves the reader's
 * client. The shared chrome lives in `./shared`.
 *
 * Pure module (no server-only, no env): also used by `scripts/*` under tsx.
 */

export const MEMORY_CONFIRMATION_SUBJECT = "Thank you for sharing a memory";

/** The approved copy, shared with the send receipt (`./submission-confirmation`) so the two never drift. */
export const CONFIRMATION_COPY = {
  preheader: "Your memory of Jo is safe with the family. Here is your private link.",
  headline: "Jo would have loved this.",
  greeting: "Thank you.",
  leadRest: "Your memory is on its way to Richard, Rob and Tracy. We read every single one, usually more than once.",
  button: "See or add to your memory",
  privacy: "Keep this link private: anyone who has it can edit this memory.",
  closer: "Spelling, as promised, did not count.",
  madeWithLove: "Made with love by Richard, Rob, Tracy and Ava.",
  questions: "Questions, or a memory that won't fit in a box? Email robwray@gmail.com.",
  questionsHtml: (bodyFont: string, linkColor: string) =>
    `<tr><td align="center" style="font-family:${bodyFont};font-size:17px;line-height:1.5;color:${WALNUT_SOFT};">Questions, or a memory that won&#39;t fit in a box? Email <a href="mailto:robwray@gmail.com" style="color:${linkColor};text-decoration:underline;">robwray@gmail.com</a>.</td></tr>`,
} as const;

const PREHEADER = CONFIRMATION_COPY.preheader;
const HEADLINE = CONFIRMATION_COPY.headline;
const GREETING = CONFIRMATION_COPY.greeting;
const LEAD_REST = CONFIRMATION_COPY.leadRest;
const BUTTON = CONFIRMATION_COPY.button;
const PRIVACY = CONFIRMATION_COPY.privacy;
const CLOSER = CONFIRMATION_COPY.closer;
const MADE_WITH_LOVE = CONFIRMATION_COPY.madeWithLove;
const QUESTIONS = CONFIRMATION_COPY.questions;

/** "your words and a photo", "2 videos", "a voice recording and a photo". Built from counts only. */
export function describeReceived(media: ReceiptMediaSummary[], hasWords: boolean): string {
  const counts = new Map<MediaKind, number>();
  for (const item of media) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  const parts: string[] = hasWords ? ["your words"] : [];
  for (const kind of ["PHOTO", "VIDEO", "VOICE"] as const) {
    const n = counts.get(kind) ?? 0;
    if (n === 1) {
      parts.push(NOUN[kind].one);
    } else if (n > 1) {
      parts.push(`${n} ${NOUN[kind].many}`);
    }
  }
  if (parts.length === 0) {
    return "your memory";
  }
  if (parts.length === 1) {
    return parts[0]!;
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

export interface RenderedMemoryConfirmation {
  subject: string;
  text: string;
  html: string;
  attachments: EmailAttachment[];
}

export function buildMemoryConfirmation(input: MemoryConfirmationContent): RenderedMemoryConfirmation {
  const link = stripControl(input.claimLink);
  const { cards, attachments: previewAttachments, badges } = buildMediaCards(input.media, { filenames: false });
  const received = describeReceived(input.media, input.hasWords);

  // ---- text part -----------------------------------------------------------
  const text = [
    HEADLINE,
    "",
    `${GREETING} ${LEAD_REST}`,
    "",
    `What you sent: ${received}`,
    ...(cards.length > 0 ? ["", "Files:", ...cards.map(renderCardText)] : []),
    "",
    `${BUTTON}:`,
    link,
    "",
    CLOSER,
    "",
    MADE_WITH_LOVE,
    QUESTIONS,
    "",
    PRIVACY,
  ].join("\n");

  // ---- html part -----------------------------------------------------------
  const safeLink = escapeHtml(link);

  const card = cardHtml(
    [
      cardHeading("What you sent"),
      `<tr><td style="padding:0 0 18px 0;font-family:${BODY_FONT};font-size:17px;line-height:1.4;color:${WALNUT_SOFT};">${escapeHtml(received.charAt(0).toUpperCase() + received.slice(1))}.</td></tr>`,
      `<tr><td style="padding:0;font-family:${BODY_FONT};font-size:17px;line-height:1.5;color:${WALNUT};">Your words and details are on your private page, exactly as you sent them.</td></tr>`,
      cards.map((c) => renderCardHtml(c, link)).join("\n"),
    ].join("\n")
  );

  const body = [
    HEART_ROW,
    "",
    headlineRow(HEADLINE),
    leadRow(`${escapeHtml(GREETING)} ${escapeHtml(LEAD_REST)}`),
    "",
    card,
    "",
    `<tr><td align="center" style="padding:32px 0 12px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
<td bgcolor="${JO_RED_SHADOW}" style="background-color:${JO_RED_SHADOW};border-radius:14px;padding:0 0 5px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td bgcolor="${JO_RED}" align="center" style="background-color:${JO_RED};border-radius:14px;">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeLink}" style="height:56px;v-text-anchor:middle;width:330px;" arcsize="25%" strokecolor="${JO_RED}" fillcolor="${JO_RED}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;">${escapeHtml(BUTTON)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${safeLink}" style="display:inline-block;min-height:56px;line-height:56px;padding:0 30px;font-family:${BODY_FONT};font-size:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:14px;background-color:${JO_RED};mso-line-height-rule:exactly;">${escapeHtml(BUTTON)}</a><!--<![endif]-->
</td></tr></table>
</td></tr></table>
</td></tr>
<tr><td align="center" style="padding:0 0 24px 0;font-family:${BODY_FONT};font-size:15px;line-height:1.5;color:${WALNUT_SOFT};word-break:break-all;">Or copy this link: <a href="${safeLink}" style="color:${JO_RED_DEEP};text-decoration:underline;">${safeLink}</a></td></tr>`,
    "",
    `<tr><td align="center" style="padding:0 0 10px 0;font-family:${BODY_FONT};font-size:17px;line-height:1.5;color:${WALNUT_SOFT};">${escapeHtml(PRIVACY)}</td></tr>`,
    `<tr><td align="center" style="padding:0 0 36px 0;font-family:${DISPLAY_FONT};font-size:20px;line-height:1.5;font-style:italic;color:${WALNUT_SOFT};">${escapeHtml(CLOSER)}</td></tr>`,
    "",
    STITCHED_HEART_ROW,
    `<tr><td align="center" style="padding:0 0 8px 0;font-family:${DISPLAY_FONT};font-size:20px;line-height:1.4;color:${WALNUT};">${escapeHtml(MADE_WITH_LOVE)}</td></tr>`,
    CONFIRMATION_COPY.questionsHtml(BODY_FONT, JO_RED_DEEP),
  ].join("\n");

  const html = renderDocument({ title: MEMORY_CONFIRMATION_SUBJECT, preheader: PREHEADER, body });

  const attachments: EmailAttachment[] = [...brandAttachments(badges), ...previewAttachments];

  return { subject: MEMORY_CONFIRMATION_SUBJECT, text, html, attachments };
}
