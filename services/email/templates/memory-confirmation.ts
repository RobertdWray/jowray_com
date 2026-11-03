import { EMAIL_ASSETS, type EmailAsset } from "../../../lib/email-assets";
import type { EmailAttachment, MediaKind, MemoryConfirmationContent, MemoryMediaSummary } from "../types";

/**
 * The one transactional email of Phase 1: a receipt of what the contributor
 * just sent, in the site's brand. Fixed subject with no user text in it.
 *
 * Every interpolated field is HTML-entity-encoded in the HTML part (alt text
 * included) and stripped of control characters in the text part. The note
 * keeps its paragraphs (ruling R1, 2026-11-03: the full note is echoed).
 * Images are inline CID attachments only (rulings R2/R4): the HTML never
 * references a URL, so no token and no tracking request leaves the reader's
 * client. Table layout and inline styles for Outlook, Gmail, Apple Mail and
 * Yahoo (R6); no @font-face, no box-shadow, no CSS positioning.
 *
 * Pure module (no server-only, no env): also used by `scripts/*` under tsx,
 * which is why the imports are relative.
 */

export const MEMORY_CONFIRMATION_SUBJECT = "Thank you for sharing a memory";

const NAME_MAX = 60;
/** The form and the claim page cap the note here (lib/validations); the template bounds it again so the 100 KB size test is a property of this module. */
const NOTE_MAX = 10_000;
const MAX_PREVIEWS = 4;
/** D4: a preview larger than this is shown as a badge card instead; four of these plus the brand marks stay well under 1.5 MB. */
const PREVIEW_MAX_BYTES = 350 * 1024;
/** Previews are rendered into a 520 px wide slot (600 px card minus padding). */
const PREVIEW_SLOT_PX = 520;
const CONTENT_ID = /^[a-z0-9-]+$/;

// Brand tokens (design/tokens.css); email clients need literal values.
const MUSLIN = "#f6efe3";
const PAPER = "#fffdf8";
const WALNUT = "#2e2420";
const WALNUT_SOFT = "#5a4a3e";
const JO_RED = "#c8102e";
const JO_RED_DEEP = "#a50d26";
const JO_RED_SHADOW = "#7d0a1e";
const WOOD_LIGHT = "#e9d9c0";
const DISPLAY_FONT = "Georgia, 'Times New Roman', serif";
const BODY_FONT = "'Atkinson Hyperlegible', Arial, Helvetica, sans-serif";

const PREHEADER = "Your memory of Jo is safe with the family. Here is what you sent.";
const HEADLINE = "Jo would have loved this.";
const LEAD_REST = "Your memory is on its way to Richard, Rob and Tracy. We read every single one, usually more than once.";
const BUTTON = "See or add to your memory";
const PRIVACY = "Keep this link private: anyone who has it can edit this memory.";
const CLOSER = "Spelling, as promised, did not count.";
const MADE_WITH_LOVE = "Made with love by Richard, Rob, Tracy and Ava.";
const QUESTIONS = "Questions, or a memory that won't fit in a box? Email robwray@gmail.com.";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Single-line fields: remove control characters (including CR/LF) and collapse whitespace so a value cannot inject headers or lines. */
export function stripControl(value: string): string {
  return value.replaceAll(/\p{Cc}/gu, " ").replaceAll(/\s+/g, " ").trim();
}

/**
 * The note keeps its paragraphs: control characters other than newline become
 * spaces, CRLF/CR become LF, runs of three or more newlines become two, and
 * spaces are left exactly as typed.
 */
export function cleanNote(value: string): string {
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll(/[^\P{Cc}\n]/gu, " ")
    .replaceAll(/\n{3,}/g, "\n\n")
    .slice(0, NOTE_MAX)
    .trim();
}

function cleanOptional(value: string | null | undefined, max: number): string | null {
  if (!value) {
    return null;
  }
  const cleaned = stripControl(value).slice(0, max).trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function formatSeconds(total: number): string {
  const seconds = Math.max(0, Math.floor(total));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

const NOUN: Record<MediaKind, { one: string; many: string; title: string; alt: string; tap: string }> = {
  PHOTO: { one: "a photo", many: "photos", title: "Photo", alt: "Your photo", tap: "Tap to see it on your private page" },
  VIDEO: { one: "a video", many: "videos", title: "Video", alt: "Your video", tap: "Tap to play on your private page" },
  VOICE: { one: "a voice recording", many: "voice recordings", title: "Voice recording", alt: "Your voice recording", tap: "Tap to play on your private page" },
};

const RESERVED_CONTENT_IDS = new Set<string>(Object.values(EMAIL_ASSETS).map((asset) => asset.contentId));

/** Decoded size of a base64 string without allocating the bytes. */
function base64Bytes(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function usablePreview(preview: NonNullable<MemoryMediaSummary["preview"]>): boolean {
  return (
    Number.isFinite(preview.width) &&
    Number.isFinite(preview.height) &&
    preview.width > 0 &&
    preview.height > 0 &&
    base64Bytes(preview.contentBase64) <= PREVIEW_MAX_BYTES
  );
}

/** "your words and a photo", "2 videos", "a voice recording and a photo". */
function describeReceived(media: MemoryMediaSummary[], hasWords: boolean): string {
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

interface Card {
  kind: MediaKind;
  filename: string | null;
  duration: string | null;
  preview: { contentId: string; width: number; height: number; filename: string } | null;
}

function assetAttachment(asset: EmailAsset, filename: string): EmailAttachment {
  return { filename, contentType: "image/png", contentBase64: asset.contentBase64, contentId: asset.contentId };
}

function assetImg(asset: EmailAsset, displayPx: number, alt: string, extraStyle = ""): string {
  return `<img src="cid:${asset.contentId}" width="${displayPx}" height="${displayPx}" alt="${escapeHtml(alt)}" style="display:block;border:0;width:${displayPx}px;height:${displayPx}px;${extraStyle}">`;
}

function buildMediaCards(media: MemoryMediaSummary[]): { cards: Card[]; attachments: EmailAttachment[]; badges: Set<MediaKind> } {
  const cards: Card[] = [];
  const attachments: EmailAttachment[] = [];
  const badges = new Set<MediaKind>();
  const seen = new Set<string>();
  let previews = 0;
  media.forEach((item, index) => {
    const filename = cleanOptional(item.originalFilename, 255);
    const duration = item.durationSeconds !== null && Number.isFinite(item.durationSeconds) ? formatSeconds(item.durationSeconds) : null;
    if (item.preview) {
      // Ids come from server ids; a bad one is a programming error, not contributor input.
      if (!CONTENT_ID.test(item.preview.contentId)) {
        throw new Error(`preview content id is not cid-safe: ${JSON.stringify(item.preview.contentId)}`);
      }
      if (RESERVED_CONTENT_IDS.has(item.preview.contentId)) {
        throw new Error(`preview content id is reserved for a brand mark: ${item.preview.contentId}`);
      }
      if (seen.has(item.preview.contentId)) {
        throw new Error(`duplicate preview content id: ${item.preview.contentId}`);
      }
      seen.add(item.preview.contentId);
    }
    const usable = item.preview !== null && item.kind !== "VOICE" && previews < MAX_PREVIEWS && usablePreview(item.preview);
    if (usable && item.preview) {
      previews += 1;
      const previewFilename = `${item.kind === "VIDEO" ? "video" : "photo"}-${index + 1}.jpg`;
      attachments.push({ filename: previewFilename, contentType: "image/jpeg", contentBase64: item.preview.contentBase64, contentId: item.preview.contentId });
      cards.push({ kind: item.kind, filename, duration, preview: { contentId: item.preview.contentId, width: item.preview.width, height: item.preview.height, filename: previewFilename } });
    } else {
      badges.add(item.kind);
      cards.push({ kind: item.kind, filename, duration, preview: null });
    }
  });
  return { cards, attachments, badges };
}

function badgeFor(kind: MediaKind): EmailAsset {
  return kind === "VOICE" ? EMAIL_ASSETS.badgeAudio : kind === "VIDEO" ? EMAIL_ASSETS.badgeVideo : EMAIL_ASSETS.badgePhoto;
}

function cardTitle(card: Card): string {
  const base = NOUN[card.kind].title;
  const detail = card.duration ?? card.filename;
  return detail ? `${base} · ${detail}` : base;
}

function renderCardHtml(card: Card, link: string): string {
  const linkAttr = `href="${escapeHtml(link)}" style="text-decoration:none;color:${WALNUT};"`;
  if (card.preview) {
    const width = Math.min(card.preview.width, PREVIEW_SLOT_PX);
    return [
      `<tr><td style="padding:18px 0 0 0;">`,
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>`,
      `<td align="center">`,
      // The wood-light background shows only where the image is blocked (behind the alt text).
      `<a ${linkAttr}><img src="cid:${card.preview.contentId}" width="${width}" alt="${escapeHtml(NOUN[card.kind].alt)}" style="display:block;border:0;width:100%;max-width:${width}px;height:auto;border-radius:12px;background-color:${WOOD_LIGHT};color:${WALNUT_SOFT};font-family:${BODY_FONT};font-size:17px;"></a>`,
      `</td></tr></table>`,
      `</td></tr>`,
    ].join("");
  }
  const badge = badgeFor(card.kind);
  return [
    `<tr><td style="padding:18px 0 0 0;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:3px solid ${WOOD_LIGHT};border-radius:12px;"><tr>`,
    // The badge is decorative (alt=""), so it carries no link of its own: an image-only link would have no accessible name.
    `<td width="56" valign="middle" style="padding:14px 0 14px 14px;">${assetImg(badge, 56, "")}</td>`,
    `<td valign="middle" style="padding:14px;font-family:${BODY_FONT};color:${WALNUT};word-break:break-word;overflow-wrap:anywhere;">`,
    // Inline spans with one <br>: Outlook's Word engine ignores display:block, and a block span plus <br> doubles the gap elsewhere.
    `<a ${linkAttr}><span style="font-size:20px;line-height:26px;font-weight:700;mso-line-height-rule:exactly;">${escapeHtml(cardTitle(card))}</span><br>`,
    `<span style="font-size:17px;line-height:24px;color:${WALNUT_SOFT};mso-line-height-rule:exactly;">${escapeHtml(NOUN[card.kind].tap)}</span></a>`,
    `</td></tr></table>`,
    `</td></tr>`,
  ].join("");
}

function renderCardText(card: Card): string {
  const base = NOUN[card.kind].title;
  const duration = card.duration ? ` (${card.duration})` : "";
  const name = card.filename ? `: ${card.filename}` : "";
  return `- ${base}${duration}${name}`;
}

function detailRow(label: string, value: string): string {
  return [
    `<tr><td style="padding:0 0 12px 0;font-family:${BODY_FONT};">`,
    `<div style="font-size:17px;line-height:1.4;color:${WALNUT_SOFT};">${escapeHtml(label)}</div>`,
    `<div style="font-size:20px;line-height:1.5;color:${WALNUT};word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(value)}</div>`,
    `</td></tr>`,
  ].join("");
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
  // `<br>` only: the note cell is `white-space:pre-wrap`, so a literal newline would double every break.
  const noteHtml = escapeHtml(note).replaceAll("\n", "<br>");
  const detailRows = [
    name ? detailRow("Your name", name) : "",
    relationship ? detailRow("How you knew Jo", relationship) : "",
    when ? detailRow("When", when) : "",
    where ? detailRow("Where", where) : "",
  ].join("");

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(MEMORY_CONFIRMATION_SUBJECT)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style type="text/css">
:root{color-scheme:light}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}
img{-ms-interpolation-mode:bicubic}
@media only screen and (max-width:620px){
.jw-h1{font-size:30px!important;line-height:32px!important}
.jw-pad{padding-left:16px!important;padding-right:16px!important}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${MUSLIN};" bgcolor="${MUSLIN}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${MUSLIN};">${escapeHtml(PREHEADER)}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MUSLIN}" style="background-color:${MUSLIN};">
<tr><td align="center" class="jw-pad" style="padding:24px 12px 40px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;">

<tr><td style="padding:0 0 28px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding:0 12px 0 0;">${assetImg(EMAIL_ASSETS.heart, 44, "")}</td>
<td valign="middle" style="font-family:${DISPLAY_FONT};font-size:28px;line-height:31px;font-weight:700;letter-spacing:-0.01em;color:${WALNUT};mso-line-height-rule:exactly;">Jo Wray</td>
</tr></table>
</td></tr>

<tr><td class="jw-h1" style="padding:0 0 16px 0;font-family:${DISPLAY_FONT};font-size:36px;line-height:38px;font-weight:800;letter-spacing:-0.02em;color:${WALNUT};mso-line-height-rule:exactly;">${escapeHtml(HEADLINE)}</td></tr>
<tr><td style="padding:0 0 28px 0;font-family:${BODY_FONT};font-size:20px;line-height:1.5;color:${WALNUT};">${escapeHtml(greeting)} ${escapeHtml(LEAD_REST)}</td></tr>

<tr><td bgcolor="${WOOD_LIGHT}" style="background-color:${WOOD_LIGHT};border-radius:18px;padding:0 0 6px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="background-color:${PAPER};border:3px solid ${WOOD_LIGHT};border-radius:18px;">
<tr><td style="padding:24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:0 0 4px 0;font-family:${DISPLAY_FONT};font-size:24px;line-height:1.2;font-weight:700;color:${WALNUT};">What you sent</td></tr>
<tr><td style="padding:0 0 18px 0;font-family:${BODY_FONT};font-size:17px;line-height:1.4;color:${WALNUT_SOFT};">${escapeHtml(received.charAt(0).toUpperCase() + received.slice(1))}.</td></tr>
${detailRows}
${hasWords ? `<tr><td style="padding:4px 0 0 0;font-family:${BODY_FONT};">
<div style="padding:0 0 6px 0;font-size:17px;line-height:1.4;color:${WALNUT_SOFT};">Your memory of Jo</div>
<div style="font-size:20px;line-height:1.5;color:${WALNUT};white-space:pre-wrap;word-break:break-word;">${noteHtml}</div>
</td></tr>` : ""}
${cards.map((card) => renderCardHtml(card, link)).join("\n")}
</table>
</td></tr>
</table>
</td></tr>

<tr><td align="center" style="padding:32px 0 12px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
<td bgcolor="${JO_RED_SHADOW}" style="background-color:${JO_RED_SHADOW};border-radius:14px;padding:0 0 5px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td bgcolor="${JO_RED}" align="center" style="background-color:${JO_RED};border-radius:14px;">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeLink}" style="height:56px;v-text-anchor:middle;width:330px;" arcsize="25%" strokecolor="${JO_RED}" fillcolor="${JO_RED}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:bold;">${escapeHtml(BUTTON)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${safeLink}" style="display:inline-block;min-height:56px;line-height:56px;padding:0 30px;font-family:${BODY_FONT};font-size:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:14px;background-color:${JO_RED};mso-line-height-rule:exactly;">${escapeHtml(BUTTON)}</a><!--<![endif]-->
</td></tr></table>
</td></tr></table>
</td></tr>
<tr><td align="center" style="padding:0 0 24px 0;font-family:${BODY_FONT};font-size:15px;line-height:1.5;color:${WALNUT_SOFT};word-break:break-all;">Or copy this link: <a href="${safeLink}" style="color:${JO_RED_DEEP};text-decoration:underline;">${safeLink}</a></td></tr>

<tr><td align="center" style="padding:0 0 10px 0;font-family:${BODY_FONT};font-size:17px;line-height:1.5;color:${WALNUT_SOFT};">${escapeHtml(PRIVACY)}</td></tr>
<tr><td align="center" style="padding:0 0 36px 0;font-family:${DISPLAY_FONT};font-size:20px;line-height:1.5;font-style:italic;color:${WALNUT_SOFT};">${escapeHtml(CLOSER)}</td></tr>

<tr><td align="center" style="padding:0 0 12px 0;">${assetImg(EMAIL_ASSETS.heartStitched, 40, "", "margin:0 auto;")}</td></tr>
<tr><td align="center" style="padding:0 0 8px 0;font-family:${DISPLAY_FONT};font-size:20px;line-height:1.4;color:${WALNUT};">${escapeHtml(MADE_WITH_LOVE)}</td></tr>
<tr><td align="center" style="font-family:${BODY_FONT};font-size:17px;line-height:1.5;color:${WALNUT_SOFT};">Questions, or a memory that won&#39;t fit in a box? Email <a href="mailto:robwray@gmail.com" style="color:${JO_RED_DEEP};text-decoration:underline;">robwray@gmail.com</a>.</td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>
`;

  const attachments: EmailAttachment[] = [
    assetAttachment(EMAIL_ASSETS.heart, "heart.png"),
    assetAttachment(EMAIL_ASSETS.heartStitched, "heart-stitched.png"),
    ...[...badges].map((kind) => assetAttachment(badgeFor(kind), `${kind.toLowerCase()}-badge.png`)),
    ...previewAttachments,
  ];

  return { subject: MEMORY_CONFIRMATION_SUBJECT, text, html, attachments };
}
