import type { EmailAttachment, MediaKind, MemoryConfirmationContent, MemoryMediaSummary } from "../types";
import {
  BODY_FONT,
  brandAttachments,
  buildMediaCards,
  cardHeading,
  cardHtml,
  cleanNote,
  cleanOptional,
  detailRow,
  DISPLAY_FONT,
  escapeHtml,
  headlineRow,
  HEART_ROW,
  JO_RED,
  JO_RED_DEEP,
  JO_RED_SHADOW,
  leadRow,
  NAME_MAX,
  noteToHtml,
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
 * The contributor's receipt: what they just sent, in the site's brand. Fixed
 * subject with no user text in it.
 *
 * Every interpolated field is HTML-entity-encoded in the HTML part (alt text
 * included) and stripped of control characters in the text part. The note
 * keeps its paragraphs (ruling R1, 2026-11-03: the full note is echoed).
 * Images are inline CID attachments only (rulings R2/R4): the HTML never
 * references a URL, so no token and no tracking request leaves the reader's
 * client. The shared chrome lives in `./shared`.
 *
 * Pure module (no server-only, no env): also used by `scripts/*` under tsx.
 */

export const MEMORY_CONFIRMATION_SUBJECT = "Thank you for sharing a memory";

/** The approved copy, shared with the send receipt (`./submission-confirmation`) so the two never drift. */
export const CONFIRMATION_COPY = {
  preheader: "Your memory of Jo is safe with the family. Here is what you sent.",
  headline: "Jo would have loved this.",
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
const LEAD_REST = CONFIRMATION_COPY.leadRest;
const BUTTON = CONFIRMATION_COPY.button;
const PRIVACY = CONFIRMATION_COPY.privacy;
const CLOSER = CONFIRMATION_COPY.closer;
const MADE_WITH_LOVE = CONFIRMATION_COPY.madeWithLove;
const QUESTIONS = CONFIRMATION_COPY.questions;

/** "your words and a photo", "2 videos", "a voice recording and a photo". */
export function describeReceived(media: MemoryMediaSummary[], hasWords: boolean): string {
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
  const name = cleanOptional(input.name, NAME_MAX);
  const relationship = cleanOptional(input.relationship, 120);
  const when = cleanOptional(input.approxDateText, 120);
  const where = cleanOptional(input.place, 200);
  const note = input.note ? cleanNote(input.note) : "";
  const hasWords = note.length > 0;
  const link = stripControl(input.claimLink);
  const { cards, attachments: previewAttachments, badges } = buildMediaCards(input.media);
  const received = describeReceived(input.media, hasWords);
  const greeting = name ? `Thank you, ${name}.` : "Thank you.";

  // ---- text part -----------------------------------------------------------
  const details: string[] = [];
  if (name) {
    details.push(`Your name: ${name}`);
  }
  if (relationship) {
    details.push(`How you knew Jo: ${relationship}`);
  }
  if (when) {
    details.push(`When: ${when}`);
  }
  if (where) {
    details.push(`Where: ${where}`);
  }
  const text = [
    HEADLINE,
    "",
    `${greeting} ${LEAD_REST}`,
    "",
    `What you sent: ${received}`,
    ...(details.length > 0 ? ["", ...details] : []),
    ...(hasWords ? ["", "Your memory of Jo:", note] : []),
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
  const detailRows = [
    name ? detailRow("Your name", name) : "",
    relationship ? detailRow("How you knew Jo", relationship) : "",
    when ? detailRow("When", when) : "",
    where ? detailRow("Where", where) : "",
  ].join("");

  const card = cardHtml(
    [
      cardHeading("What you sent"),
      `<tr><td style="padding:0 0 18px 0;font-family:${BODY_FONT};font-size:17px;line-height:1.4;color:${WALNUT_SOFT};">${escapeHtml(received.charAt(0).toUpperCase() + received.slice(1))}.</td></tr>`,
      detailRows,
      hasWords
        ? `<tr><td style="padding:4px 0 0 0;font-family:${BODY_FONT};">
<div style="padding:0 0 6px 0;font-size:17px;line-height:1.4;color:${WALNUT_SOFT};">Your memory of Jo</div>
<div style="font-size:20px;line-height:1.5;color:${WALNUT};white-space:pre-wrap;word-break:break-word;">${noteToHtml(note)}</div>
</td></tr>`
        : "",
      cards.map((c) => renderCardHtml(c, link)).join("\n"),
    ].join("\n")
  );

  const body = [
    HEART_ROW,
    "",
    headlineRow(HEADLINE),
    leadRow(`${escapeHtml(greeting)} ${escapeHtml(LEAD_REST)}`),
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
