import { z } from "zod";

import { gmailSourceRef, otherSourceRef, smsSourceRef } from "@/lib/source-ref";

/**
 * Where an admin-drafted memory's words came from, and how that becomes
 * `source` + `sourceRef` (plan 2026-11-06 §4.3). Moved from
 * scripts/draft-memory.ts so the laptop script and the MCP `draft_memory` tool
 * share one derivation through the canonical builders in lib/source-ref.ts:
 * neither the skill nor a model ever reproduces the hashing by hand. Pure: no
 * `server-only`, so the script can import it.
 */

/**
 * The `sourceInput` the MCP tool advertises: one closed object per kind. The
 * formats (hex message id, E.164 number, zoned timestamp) are checked by the
 * builders, whose messages come back to the model as `invalid`.
 */
export const sourceInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("gmail").describe("The words came in an email in Rob's Gmail"),
      messageId: z.string().min(1).describe("Gmail id of the sender's message that holds the words (8 to 32 hex characters), not the thread id"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("sms").describe("The words came in a text message"),
      number: z.string().min(1).describe("Sender's number in E.164, for example +14105551234"),
      sentAt: z.string().min(1).describe("When the text was sent, ISO-8601 with an explicit zone or offset, for example 2026-11-03T14:05-04:00"),
      text: z.string().min(1).describe("The full text of the message, as received"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("other").describe("Anything else, for example a card or a message passed on by hand"),
      email: z.string().min(1).optional().describe("Sender's email address; defaults to contributor.email and must match it"),
      originalText: z.string().min(1).describe("The full original message text, not the excerpt"),
    })
    .strict(),
]);

/**
 * Where the words came from, in the input JSON. `prepareInput` turns this into
 * `source` + `sourceRef` through the canonical builders in lib/source-ref.ts.
 * The script's input may instead carry `source` and `sourceRef` itself (a
 * replay of an earlier payload); the MCP tool accepts only `sourceInput`.
 */
export type SourceInput = z.infer<typeof sourceInputSchema>;

function stringField(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`sourceInput.${key} must be a non-empty string`);
  }
  return value;
}

function sourceFor(input: Record<string, unknown>, contributorEmail: string | undefined): { source: "EMAIL" | "SMS" | "OTHER"; sourceRef: string } {
  switch (input.kind) {
    case "gmail":
      return { source: "EMAIL", sourceRef: gmailSourceRef(stringField(input, "messageId")) };
    case "sms":
      return { source: "SMS", sourceRef: smsSourceRef(stringField(input, "number"), stringField(input, "sentAt"), stringField(input, "text")) };
    case "other": {
      // The dedup key is the stored contributor's address; a different one would let the same person be drafted twice.
      const email = typeof input.email === "string" && input.email.length > 0 ? input.email : contributorEmail;
      if (!email) {
        throw new Error("sourceInput.email or contributor.email is required for kind other");
      }
      if (contributorEmail && email.trim().toLowerCase() !== contributorEmail.trim().toLowerCase()) {
        throw new Error("sourceInput.email must match contributor.email (the dedup key is the stored address)");
      }
      return { source: "OTHER", sourceRef: otherSourceRef(email, stringField(input, "originalText")) };
    }
    default:
      throw new Error(`sourceInput.kind must be gmail, sms or other (got ${String(input.kind)})`);
  }
}

/** The JSON file's object, with `sourceInput` replaced by `source` + `sourceRef`. */
export function prepareInput(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("The input file must hold a JSON object");
  }
  const { sourceInput, ...rest } = raw as Record<string, unknown> & { sourceInput?: unknown };
  const explicit = "source" in rest || "sourceRef" in rest;
  if (sourceInput !== undefined && explicit) {
    throw new Error("Give either sourceInput or source + sourceRef, not both");
  }
  if (sourceInput === undefined) {
    if (!("source" in rest) || !("sourceRef" in rest)) {
      throw new Error("The input needs sourceInput ({ kind: gmail | sms | other, … }) or source + sourceRef");
    }
    return rest;
  }
  if (typeof sourceInput !== "object" || sourceInput === null) {
    throw new Error("sourceInput.kind must be gmail, sms or other");
  }
  const contributor = rest.contributor as { email?: unknown } | undefined;
  const contributorEmail = typeof contributor?.email === "string" ? contributor.email : undefined;
  return { ...rest, ...sourceFor(sourceInput as Record<string, unknown>, contributorEmail) };
}
