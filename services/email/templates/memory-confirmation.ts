import type { ReceivedType } from "../types";

/**
 * The one transactional email of Phase 1. Fixed subject, no user text in it.
 * Every interpolated field is HTML-entity-encoded in the HTML part and
 * stripped of control characters in the text part. The contributor's note
 * and relationship are never echoed. Pure module: usable from `tsx` scripts.
 */

export const MEMORY_CONFIRMATION_SUBJECT = "Thank you for sharing a memory";

const NAME_MAX = 60;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Remove control characters (including CR/LF) so a value cannot inject headers or lines. */
export function stripControl(value: string): string {
  return value.replaceAll(/\p{Cc}/gu, " ").replaceAll(/\s+/g, " ").trim();
}

function cleanName(name: string | null | undefined): string | null {
  if (!name) {
    return null;
  }
  const cleaned = stripControl(name).slice(0, NAME_MAX).trim();
  return cleaned.length > 0 ? cleaned : null;
}

function describeReceived(type: ReceivedType, fileCount: number): string {
  if (type === "TEXT" || fileCount === 0) {
    return "a written memory";
  }
  const noun = { VOICE: "voice recording", VIDEO: "video", PHOTO: "photo", TEXT: "note" }[type];
  return fileCount === 1 ? `a ${noun}` : `${fileCount} ${noun}s`;
}

export interface MemoryConfirmationTemplateInput {
  name?: string | null;
  received: { type: ReceivedType; fileCount: number };
  claimLink: string;
  usageSentence?: string;
}

export function buildMemoryConfirmation(input: MemoryConfirmationTemplateInput): {
  subject: string;
  text: string;
  html: string;
} {
  const name = cleanName(input.name);
  const greeting = name ? `Hello ${name},` : "Hello,";
  const received = describeReceived(input.received.type, input.received.fileCount);
  const link = stripControl(input.claimLink);
  const usage = input.usageSentence ? stripControl(input.usageSentence) : null;

  const textLines = [
    greeting,
    "",
    `Thank you. We received ${received} and it has been stored exactly as you sent it.`,
    "",
    "You can see what was received, correct the details, or add more files here:",
    link,
    "",
    ...(usage ? [usage, ""] : []),
    "Keep this link private: anyone who has it can edit this memory.",
  ];

  const htmlParts = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>Thank you. We received ${escapeHtml(received)} and it has been stored exactly as you sent it.</p>`,
    `<p>You can see what was received, correct the details, or add more files here:<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
    ...(usage ? [`<p>${escapeHtml(usage)}</p>`] : []),
    "<p>Keep this link private: anyone who has it can edit this memory.</p>",
  ];

  return {
    subject: MEMORY_CONFIRMATION_SUBJECT,
    text: textLines.join("\n"),
    html: htmlParts.join("\n"),
  };
}
