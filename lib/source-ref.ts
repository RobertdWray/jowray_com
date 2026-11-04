import { createHash } from "node:crypto";

import { SOURCE_REF_PATTERN } from "@/lib/validations/memory";

/**
 * Builders for `Memory.sourceRef` (scheme in lib/validations/memory.ts). Pure:
 * no `server-only`, so the repo script and the skill can use them too. The
 * sms and other forms hash their inputs so no phone number or address ever
 * sits in the column in clear; `other` is keyed on the full original text
 * (not the excerpt) so an edited cut cannot create a second memory and two
 * people's identical words cannot collide.
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

/** A text message: the E.164 number and the ISO-8601 timestamp of the text, hashed. */
export function smsSourceRef(e164Number: string, sentAtIso: string): string {
  if (!E164.test(e164Number)) {
    throw new Error("The number must be E.164 (+ and 7 to 15 digits)");
  }
  if (sentAtIso.trim().length === 0) {
    throw new Error("The text's timestamp is required");
  }
  return checked(`sms:${hash32(`${e164Number}|${sentAtIso}`)}`);
}

/** Anything else: the sender's email (lower-cased) and the full original message text, hashed. */
export function otherSourceRef(senderEmail: string, originalText: string): string {
  return checked(`other:${hash32(`${senderEmail.trim().toLowerCase()}|${originalText}`)}`);
}
