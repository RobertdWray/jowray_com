import { EMAIL_ASSETS, type EmailAsset } from "../../../lib/email-assets";
import type { EmailAttachment, MediaKind, MemoryMediaSummary } from "../types";

/**
 * Pieces shared by the transactional email templates (the contributor
 * confirmation and the family-admin alert): brand tokens, escaping, the
 * media cards, detail rows and the document shell.
 *
 * Rules every template inherits (design/DESIGN.md § 11): table layout and
 * inline styles for Outlook, Gmail, Apple Mail and Yahoo; no @font-face, no
 * box-shadow, no CSS positioning; every image is an inline CID attachment,
 * so nothing is ever fetched from a URL.
 *
 * Pure module (no server-only, no env): also used by `scripts/*` under tsx,
 * which is why the imports are relative.
 */

export const NAME_MAX = 60;
/** The form and the claim page cap the note here (lib/validations); the templates bound it again so their size tests are a property of the template. */
export const NOTE_MAX = 10_000;
export const MAX_PREVIEWS = 4;
/** D4: a preview larger than this is shown as a badge card instead; four of these plus the brand marks stay well under 1.5 MB. */
export const PREVIEW_MAX_BYTES = 350 * 1024;
/** Previews are rendered into a 520 px wide slot (600 px card minus padding). */
export const PREVIEW_SLOT_PX = 520;
export const CONTENT_ID = /^[a-z0-9-]+$/;

// Brand tokens (design/tokens.css); email clients need literal values.
export const MUSLIN = "#f6efe3";
export const PAPER = "#fffdf8";
export const WALNUT = "#2e2420";
export const WALNUT_SOFT = "#5a4a3e";
export const JO_RED = "#c8102e";
export const JO_RED_DEEP = "#a50d26";
export const JO_RED_SHADOW = "#7d0a1e";
export const WOOD_LIGHT = "#e9d9c0";
export const DISPLAY_FONT = "Georgia, 'Times New Roman', serif";
export const BODY_FONT = "'Atkinson Hyperlegible', Arial, Helvetica, sans-serif";

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

export function cleanOptional(value: string | null | undefined, max: number): string | null {
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

/** `<br>` only: a pre-wrap cell would double every break if the newline were kept too. */
export function noteToHtml(note: string): string {
  return escapeHtml(note).replaceAll("\n", "<br>");
}

export const NOUN: Record<MediaKind, { one: string; many: string; title: string; alt: string; tap: string }> = {
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

export function usablePreview(preview: NonNullable<MemoryMediaSummary["preview"]>): boolean {
  return (
    Number.isFinite(preview.width) &&
    Number.isFinite(preview.height) &&
    preview.width > 0 &&
    preview.height > 0 &&
    base64Bytes(preview.contentBase64) <= PREVIEW_MAX_BYTES
  );
}

export interface Card {
  kind: MediaKind;
  filename: string | null;
  duration: string | null;
  preview: { contentId: string; width: number; height: number; filename: string } | null;
}

export function assetAttachment(asset: EmailAsset, filename: string): EmailAttachment {
  return { filename, contentType: "image/png", contentBase64: asset.contentBase64, contentId: asset.contentId };
}

export function assetImg(asset: EmailAsset, displayPx: number, alt: string, extraStyle = ""): string {
  return `<img src="cid:${asset.contentId}" width="${displayPx}" height="${displayPx}" alt="${escapeHtml(alt)}" style="display:block;border:0;width:${displayPx}px;height:${displayPx}px;${extraStyle}">`;
}

/**
 * Turn the READY files into cards: the first four usable previews become
 * inline images (`alt` text per kind), the rest badge cards. Preview content
 * ids come from server ids, so a bad, reserved or duplicate one is a
 * programming error and throws.
 */
export function buildMediaCards(media: MemoryMediaSummary[]): { cards: Card[]; attachments: EmailAttachment[]; badges: Set<MediaKind> } {
  const cards: Card[] = [];
  const attachments: EmailAttachment[] = [];
  const badges = new Set<MediaKind>();
  const seen = new Set<string>();
  let previews = 0;
  media.forEach((item, index) => {
    const filename = cleanOptional(item.originalFilename, 255);
    const duration = item.durationSeconds !== null && Number.isFinite(item.durationSeconds) ? formatSeconds(item.durationSeconds) : null;
    if (item.preview) {
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

export function badgeFor(kind: MediaKind): EmailAsset {
  return kind === "VOICE" ? EMAIL_ASSETS.badgeAudio : kind === "VIDEO" ? EMAIL_ASSETS.badgeVideo : EMAIL_ASSETS.badgePhoto;
}

export function cardTitle(card: Card): string {
  const base = NOUN[card.kind].title;
  const detail = card.duration ?? card.filename;
  return detail ? `${base} · ${detail}` : base;
}

/**
 * One media card. With a `link`, the image or the title/tap text is wrapped
 * in an anchor to the contributor's private page. With `null` (the admin
 * alert, which carries no links by ruling) the same card renders as plain
 * content and the "Tap to…" line is omitted.
 */
export function renderCardHtml(card: Card, link: string | null): string {
  const open = link === null ? "" : `<a href="${escapeHtml(link)}" style="text-decoration:none;color:${WALNUT};">`;
  const close = link === null ? "" : "</a>";
  if (card.preview) {
    const width = Math.min(card.preview.width, PREVIEW_SLOT_PX);
    return [
      `<tr><td style="padding:18px 0 0 0;">`,
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>`,
      `<td align="center">`,
      // The wood-light background shows only where the image is blocked (behind the alt text).
      `${open}<img src="cid:${card.preview.contentId}" width="${width}" alt="${escapeHtml(NOUN[card.kind].alt)}" style="display:block;border:0;width:100%;max-width:${width}px;height:auto;border-radius:12px;background-color:${WOOD_LIGHT};color:${WALNUT_SOFT};font-family:${BODY_FONT};font-size:17px;">${close}`,
      `</td></tr></table>`,
      `</td></tr>`,
    ].join("");
  }
  const badge = badgeFor(card.kind);
  const tap =
    link === null
      ? ""
      : `<br><span style="font-size:17px;line-height:24px;color:${WALNUT_SOFT};mso-line-height-rule:exactly;">${escapeHtml(NOUN[card.kind].tap)}</span>`;
  return [
    `<tr><td style="padding:18px 0 0 0;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:3px solid ${WOOD_LIGHT};border-radius:12px;"><tr>`,
    // The badge is decorative (alt=""), so it carries no link of its own: an image-only link would have no accessible name.
    `<td width="56" valign="middle" style="padding:14px 0 14px 14px;">${assetImg(badge, 56, "")}</td>`,
    `<td valign="middle" style="padding:14px;font-family:${BODY_FONT};color:${WALNUT};word-break:break-word;overflow-wrap:anywhere;">`,
    // Inline spans with one <br>: Outlook's Word engine ignores display:block, and a block span plus <br> doubles the gap elsewhere.
    `${open}<span style="font-size:20px;line-height:26px;font-weight:700;mso-line-height-rule:exactly;">${escapeHtml(cardTitle(card))}</span>${tap}${close}`,
    `</td></tr></table>`,
    `</td></tr>`,
  ].join("");
}

export function renderCardText(card: Card): string {
  const base = NOUN[card.kind].title;
  const duration = card.duration ? ` (${card.duration})` : "";
  const name = card.filename ? `: ${card.filename}` : "";
  return `- ${base}${duration}${name}`;
}

export function detailRow(label: string, value: string): string {
  return [
    `<tr><td style="padding:0 0 12px 0;font-family:${BODY_FONT};">`,
    `<div style="font-size:17px;line-height:1.4;color:${WALNUT_SOFT};">${escapeHtml(label)}</div>`,
    `<div style="font-size:20px;line-height:1.5;color:${WALNUT};word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(value)}</div>`,
    `</td></tr>`,
  ].join("");
}

/** The paper card with the flat "stitched-on" shadow, built from table cells; `rows` are `<tr>`s of its inner table. */
export function cardHtml(rows: string): string {
  return [
    `<tr><td bgcolor="${WOOD_LIGHT}" style="background-color:${WOOD_LIGHT};border-radius:18px;padding:0 0 6px 0;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="background-color:${PAPER};border:3px solid ${WOOD_LIGHT};border-radius:18px;">`,
    `<tr><td style="padding:24px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">`,
    rows,
    `</table>`,
    `</td></tr>`,
    `</table>`,
    `</td></tr>`,
  ].join("\n");
}

/** A card's heading row ("What you sent", "Who"). */
export function cardHeading(text: string, paddingBottomPx = 4): string {
  return `<tr><td style="padding:0 0 ${paddingBottomPx}px 0;font-family:${DISPLAY_FONT};font-size:24px;line-height:1.2;font-weight:700;color:${WALNUT};">${escapeHtml(text)}</td></tr>`;
}

/** The brand marks referenced by every template plus the badges a template used. */
export function brandAttachments(badges: Set<MediaKind>): EmailAttachment[] {
  return [
    assetAttachment(EMAIL_ASSETS.heart, "heart.png"),
    assetAttachment(EMAIL_ASSETS.heartStitched, "heart-stitched.png"),
    ...[...badges].map((kind) => assetAttachment(badgeFor(kind), `${kind.toLowerCase()}-badge.png`)),
  ];
}

export const HEART_ROW = `<tr><td style="padding:0 0 28px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding:0 12px 0 0;">${assetImg(EMAIL_ASSETS.heart, 44, "")}</td>
<td valign="middle" style="font-family:${DISPLAY_FONT};font-size:28px;line-height:31px;font-weight:700;letter-spacing:-0.01em;color:${WALNUT};mso-line-height-rule:exactly;">Jo Wray</td>
</tr></table>
</td></tr>`;

export const STITCHED_HEART_ROW = `<tr><td align="center" style="padding:0 0 12px 0;">${assetImg(EMAIL_ASSETS.heartStitched, 40, "", "margin:0 auto;")}</td></tr>`;

export function headlineRow(text: string): string {
  return `<tr><td class="jw-h1" style="padding:0 0 16px 0;font-family:${DISPLAY_FONT};font-size:36px;line-height:38px;font-weight:800;letter-spacing:-0.02em;color:${WALNUT};mso-line-height-rule:exactly;">${escapeHtml(text)}</td></tr>`;
}

export function leadRow(html: string): string {
  return `<tr><td style="padding:0 0 28px 0;font-family:${BODY_FONT};font-size:20px;line-height:1.5;color:${WALNUT};">${html}</td></tr>`;
}

/**
 * The document shell: XHTML doctype and Outlook namespaces, light colour
 * scheme, the one `<style>` block Gmail honours (a width media query), the
 * hidden preheader, the muslin ground and the 600 px hybrid wrapper.
 * `body` is the sequence of `<tr>`s inside that wrapper.
 */
export function renderDocument({ title, preheader, body }: { title: string; preheader: string; body: string }): string {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
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
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${MUSLIN};">${escapeHtml(preheader)}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MUSLIN}" style="background-color:${MUSLIN};">
<tr><td align="center" class="jw-pad" style="padding:24px 12px 40px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;">

${body}

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>
`;
}
