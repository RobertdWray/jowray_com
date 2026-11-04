import { createHash } from "node:crypto";

import { SOURCE_REF_PATTERN } from "@/lib/validations/memory";

/**
 * Builders for `Memory.sourceRef` (scheme in lib/validations/memory.ts). Pure:
 * no `server-only`, so the repo script and the skill can use them too. The
 * sms and other forms hash their inputs so no phone number or address ever
 * sits in the column in clear; `other` is keyed on the full original text
 * (not the excerpt) so an edited cut cannot create a second memory and two
 * people's identical words cannot collide. Inputs are canonicalised first
 * (UTC minute for the timestamp; NFC, LF, trimmed line ends for the text) so
 * the same message retyped or re-pasted cannot create a second draft.
 */

const GMAIL_MESSAGE_ID = /^[0-9a-f]{8,32}$/i;
const E164 = /^\+[1-9]\d{6,14}$/;

function hash32(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

function checked(ref: string): string {
  if (!SOURCE_REF_PATTERN.test(ref)) {
    throw new Error("sourceRef does not follow the scheme");
  }
  return ref;
}

/** The Gmail id of the sender's message that contains the excerpt (not the thread id). */
export function gmailSourceRef(messageId: string): string {
  if (!GMAIL_MESSAGE_ID.test(messageId)) {
    throw new Error("A Gmail message id is 8 to 32 hex characters");
  }
  return checked(`gmail:${messageId.toLowerCase()}`);
}

/** `2026-11-03T14:05Z`: the instant to the minute, in UTC, whatever zone or precision was typed. */
function canonicalMinute(sentAtIso: string): string {
  const ms = Date.parse(sentAtIso);
  if (Number.isNaN(ms)) {
    throw new Error("The text's timestamp must be ISO-8601 (for example 2026-11-03T14:05-04:00)");
  }
  return `${new Date(ms).toISOString().slice(0, 16)}Z`;
}

/** NFC, LF line ends, no trailing whitespace on a line, no leading or trailing blank lines. */
export function canonicalText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

/** A text message: the E.164 number and the timestamp of the text (to the UTC minute), hashed. */
export function smsSourceRef(e164Number: string, sentAtIso: string): string {
  if (!E164.test(e164Number)) {
    throw new Error("The number must be E.164 (+ and 7 to 15 digits)");
  }
  return checked(`sms:${hash32(`${e164Number}|${canonicalMinute(sentAtIso)}`)}`);
}

/** Anything else: the sender's email (lower-cased) and the full original message text (canonicalised), hashed. */
export function otherSourceRef(senderEmail: string, originalText: string): string {
  return checked(`other:${hash32(`${senderEmail.trim().toLowerCase()}|${canonicalText(originalText)}`)}`);
}
