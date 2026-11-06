import { describe, expect, it } from "vitest";
import { z } from "zod";

import { prepareInput, sourceInputSchema } from "@/lib/source-input";
import { otherSourceRef } from "@/lib/source-ref";

import { prepareInput as scriptPrepareInput } from "../../scripts/draft-memory";

/**
 * The shared `sourceInput` derivation (plan 2026-11-06 §4.3). The script's own
 * tests (__tests__/scripts/draft-memory.test.ts) keep every prepareInput
 * assertion; these add the schema the MCP tool advertises and pin the exact
 * messages that become `invalid` tool errors.
 */

describe("sourceInputSchema", () => {
  it("accepts the three kinds, with the email optional for other", () => {
    for (const input of [
      { kind: "gmail", messageId: "1a1a2317fba34eec" },
      { kind: "sms", number: "+14105551234", sentAt: "2026-11-03T10:05-04:00", text: "Jo was a light." },
      { kind: "other", email: "pat@example.com", originalText: "Dear Rob,\n\nJo was a light." },
      { kind: "other", originalText: "Dear Rob,\n\nJo was a light." },
    ]) {
      expect(sourceInputSchema.parse(input), input.kind).toEqual(input);
    }
  });

  it("refuses an unknown kind, an extra key, a missing field and an empty string", () => {
    for (const input of [
      { kind: "fax", number: "+14105551234" },
      { kind: "gmail", messageId: "1a1a2317fba34eec", threadId: "x" },
      { kind: "sms", number: "+14105551234", sentAt: "2026-11-03T10:05-04:00", text: "x", sourceRef: "sms:abc" },
      { kind: "other", originalText: "x", note: "y" },
      { kind: "sms", number: "+14105551234", text: "x" },
      { kind: "gmail", messageId: "" },
      { messageId: "1a1a2317fba34eec" },
    ]) {
      expect(sourceInputSchema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    }
  });

  it("advertises one closed object per kind with a description on every field", () => {
    const schema = z.toJSONSchema(sourceInputSchema) as { oneOf?: unknown[]; anyOf?: unknown[] };
    const variants = (schema.oneOf ?? schema.anyOf ?? []) as Array<{ additionalProperties?: unknown; properties: Record<string, { description?: string }> }>;
    expect(variants).toHaveLength(3);
    for (const variant of variants) {
      expect(variant.additionalProperties).toBe(false);
      for (const [key, property] of Object.entries(variant.properties)) {
        expect(property.description, key).toEqual(expect.any(String));
      }
    }
  });
});

describe("prepareInput (moved from scripts/draft-memory.ts)", () => {
  const base = { contributor: { email: "pat@example.com" }, note: "Jo was a light." };

  it("is the one implementation: the script re-exports it", () => {
    expect(scriptPrepareInput).toBe(prepareInput);
  });

  it("keeps its messages for the `other` email rules, which the tool returns as invalid", () => {
    expect(() => prepareInput({ ...base, sourceInput: { kind: "other", email: "someone-else@example.com", originalText: "Jo" } })).toThrow(
      "sourceInput.email must match contributor.email (the dedup key is the stored address)"
    );
    expect(() => prepareInput({ note: "x", sourceInput: { kind: "other", originalText: "Jo" } })).toThrow("sourceInput.email or contributor.email is required for kind other");
    expect(prepareInput({ ...base, sourceInput: { kind: "other", email: " PAT@example.com ", originalText: "Jo" } })).toEqual({ ...base, source: "OTHER", sourceRef: otherSourceRef("pat@example.com", "Jo") });
  });
});
