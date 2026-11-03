import type { AdminNewMemoryContent, EmailAttachment, MemoryVisibility } from "../types";
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
  leadRow,
  NAME_MAX,
  noteToHtml,
  renderCardHtml,
  renderCardText,
  renderDocument,
  STITCHED_HEART_ROW,
  stripControl,
  WALNUT,
  WALNUT_SOFT,
} from "./shared";

/**
 * The family-admin alert: "a new memory landed", showing who sent it, when,
 * their words, their files and the details an admin acts on. Sent to the
 * `ADMIN_ALERT_EMAILS` list, one message they all see.
 *
 * Deliberately **no links** (ruling R2, Rob 2026-11-03): the admins are
 * notified, not handed the contributor's edit capability. No `href`, no
 * `mailto:`, no claim token anywhere; media cards render unlinked. The
 * contributor's own prose is kept verbatim even when it contains a URL.
 *
 * Pure module (no server-only, no env): also used by `scripts/*` under tsx.
 */

/** The family's zone; Vercel functions run in UTC, so the stamp must be explicit. */
export const ADMIN_TIME_ZONE = "America/New_York";

const SUBJECT_BASE = "New memory";
const HEADLINE = "A new memory landed.";
const FOOTER_LINE = "Admin alert from jowray.com. This email carries no links on purpose: the edit link belongs to the contributor.";
const NOT_GIVEN = "Not given";
const NO_NOTE = "No written note.";
const NO_FILES = "No files.";
const PREHEADER_NOTE_CHARS = 90;

const VISIBILITY_LABEL: Record<MemoryVisibility, string> = {
  PUBLIC: "Everyone who visits the memorial",
  FAMILY: "Family only",
  PRIVATE: "Private",
};

// Component options rather than dateStyle/timeStyle: the two cannot be mixed,
// and the zone abbreviation ("EST") is what tells a reader which clock it is.
const SUBMITTED_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
  timeZone: ADMIN_TIME_ZONE,
});

export function adminNewMemorySubject(name: string | null | undefined): string {
  const cleaned = cleanOptional(name, NAME_MAX);
  return cleaned ? `${SUBJECT_BASE} from ${cleaned}` : SUBJECT_BASE;
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function filesNotReadyLine(count: number): string | null {
  if (count <= 0) {
    return null;
  }
  return count === 1 ? "1 file is still uploading or did not arrive." : `${count} files are still uploading or did not arrive.`;
}

function monoRow(label: string, value: string): string {
  return [
    `<tr><td style="padding:0 0 12px 0;font-family:${BODY_FONT};">`,
    `<div style="font-size:17px;line-height:1.4;color:${WALNUT_SOFT};">${escapeHtml(label)}</div>`,
    `<div style="font-family:Menlo,Consolas,'Courier New',monospace;font-size:13px;line-height:1.5;color:${WALNUT};word-break:break-all;">${escapeHtml(value)}</div>`,
    `</td></tr>`,
  ].join("");
}

export interface RenderedAdminNewMemory {
  subject: string;
  text: string;
  html: string;
  attachments: EmailAttachment[];
}

export function buildAdminNewMemory(input: AdminNewMemoryContent): RenderedAdminNewMemory {
  const name = cleanOptional(input.name, NAME_MAX) ?? NOT_GIVEN;
  const relationship = cleanOptional(input.relationship, 120) ?? NOT_GIVEN;
  const email = cleanOptional(input.email, 254) ?? NOT_GIVEN;
  const when = cleanOptional(input.approxDateText, 120) ?? NOT_GIVEN;
  const where = cleanOptional(input.place, 200) ?? NOT_GIVEN;
  const note = input.note ? cleanNote(input.note) : "";
  const hasWords = note.length > 0;
  const submitted = SUBMITTED_FORMAT.format(input.submittedAt);
  const memoryId = stripControl(input.memoryId);
  const visibility = VISIBILITY_LABEL[input.visibility];
  const { cards, attachments: previewAttachments, badges } = buildMediaCards(input.media);
  const fileCount = cards.length > 1 ? `${cards.length} files` : null;
  const notReady = filesNotReadyLine(input.filesNotReady);
  const subject = adminNewMemorySubject(input.name);
  const preheaderNote = hasWords ? note.replaceAll("\n", " ").slice(0, PREHEADER_NOTE_CHARS) : "No written note";
  const preheader = `${cleanOptional(input.relationship, 120) ?? "No relationship given"} · ${preheaderNote}`;

  // ---- text part -----------------------------------------------------------
  const text = [
    HEADLINE,
    "",
    `Submitted: ${submitted}`,
    "",
    "Who",
    `Name: ${name}`,
    `How they knew Jo: ${relationship}`,
    `Email: ${email}`,
    `Can be contacted: ${yesNo(input.contactOptIn)}`,
    `Wants to hear when it's posted: ${yesNo(input.notifyWhenPosted)}`,
    `Mailing list: ${yesNo(input.mailingListOptIn)}`,
    "",
    "Date",
    `Submitted: ${submitted}`,
    `When, as they wrote it: ${when}`,
    `Where: ${where}`,
    "",
    "Memory",
    hasWords ? note : NO_NOTE,
    "",
    "Media",
    ...(fileCount ? [fileCount] : []),
    ...(cards.length > 0 ? cards.map(renderCardText) : [NO_FILES]),
    ...(notReady ? [notReady] : []),
    "",
    "Other details",
    `Visibility: ${visibility}`,
    `Memory id: ${memoryId}`,
    "",
    FOOTER_LINE,
  ].join("\n");

  // ---- html part -----------------------------------------------------------
  const whoCard = cardHtml(
    [
      cardHeading("Who", 14),
      detailRow("Name", name),
      detailRow("How they knew Jo", relationship),
      detailRow("Email", email),
      detailRow("Can be contacted", yesNo(input.contactOptIn)),
      detailRow("Wants to hear when it's posted", yesNo(input.notifyWhenPosted)),
      detailRow("Mailing list", yesNo(input.mailingListOptIn)),
    ].join("\n")
  );
  const dateCard = cardHtml(
    [cardHeading("Date", 14), detailRow("Submitted", submitted), detailRow("When, as they wrote it", when), detailRow("Where", where)].join("\n")
  );
  const memoryCard = cardHtml(
    [
      cardHeading("Memory", 10),
      hasWords
        ? `<tr><td style="padding:0;font-family:${BODY_FONT};"><div style="font-size:20px;line-height:1.5;color:${WALNUT};white-space:pre-wrap;word-break:break-word;">${noteToHtml(note)}</div></td></tr>`
        : `<tr><td style="padding:0;font-family:${DISPLAY_FONT};font-size:20px;line-height:1.5;font-style:italic;color:${WALNUT_SOFT};">${escapeHtml(NO_NOTE)}</td></tr>`,
    ].join("\n")
  );
  const mediaCard = cardHtml(
    [
      cardHeading("Media", 4),
      fileCount
        ? `<tr><td style="padding:0 0 4px 0;font-family:${BODY_FONT};font-size:17px;line-height:1.4;color:${WALNUT_SOFT};">${escapeHtml(fileCount)}</td></tr>`
        : "",
      cards.length > 0
        ? cards.map((card) => renderCardHtml(card, null)).join("\n")
        : `<tr><td style="padding:10px 0 0 0;font-family:${DISPLAY_FONT};font-size:20px;line-height:1.5;font-style:italic;color:${WALNUT_SOFT};">${escapeHtml(NO_FILES)}</td></tr>`,
      notReady
        ? `<tr><td style="padding:18px 0 0 0;font-family:${BODY_FONT};font-size:17px;line-height:1.4;color:${WALNUT_SOFT};">${escapeHtml(notReady)}</td></tr>`
        : "",
    ].join("\n")
  );
  const detailsCard = cardHtml([cardHeading("Other details", 14), detailRow("Visibility", visibility), monoRow("Memory id", memoryId)].join("\n"));

  const gap = `<tr><td style="height:20px;line-height:20px;font-size:0;">&nbsp;</td></tr>`;
  const body = [
    HEART_ROW,
    "",
    headlineRow(HEADLINE),
    leadRow(`Submitted ${escapeHtml(submitted)}.`),
    "",
    whoCard,
    gap,
    dateCard,
    gap,
    memoryCard,
    gap,
    mediaCard,
    gap,
    detailsCard,
    "",
    `<tr><td style="height:36px;line-height:36px;font-size:0;">&nbsp;</td></tr>`,
    STITCHED_HEART_ROW,
    `<tr><td align="center" style="font-family:${BODY_FONT};font-size:15px;line-height:1.5;color:${WALNUT_SOFT};">${escapeHtml(FOOTER_LINE)}</td></tr>`,
  ].join("\n");

  const html = renderDocument({ title: subject, preheader, body });
  const attachments: EmailAttachment[] = [...brandAttachments(badges), ...previewAttachments];

  return { subject, text, html, attachments };
}
