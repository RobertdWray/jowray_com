import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { gmailSourceRef, otherSourceRef, smsSourceRef } from "@/lib/source-ref";
import { SOURCE_REF_PATTERN } from "@/lib/validations/memory";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("gmailSourceRef", () => {
  it("pins the sender's Gmail message id, lower-cased", () => {
    expect(gmailSourceRef("1A1A2317FBA34EEC")).toBe("gmail:1a1a2317fba34eec");
  });

  it("rejects anything that is not a hex message id (a thread-f URL fragment, an empty string)", () => {
    expect(() => gmailSourceRef("thread-f:1234567890")).toThrow();
    expect(() => gmailSourceRef("")).toThrow();
  });
});

describe("smsSourceRef", () => {
  it("hashes the E.164 number with the text's timestamp; the number never appears in clear", () => {
    const ref = smsSourceRef("+14105551234", "2026-11-03T14:05:00Z");
    expect(ref).toBe(`sms:${sha("+14105551234|2026-11-03T14:05:00Z").slice(0, 32)}`);
    expect(ref).not.toContain("4105551234");
    expect(ref).toMatch(SOURCE_REF_PATTERN);
  });

  it("gives two texts from the same number different refs", () => {
    expect(smsSourceRef("+14105551234", "2026-11-03T14:05:00Z")).not.toBe(smsSourceRef("+14105551234", "2026-11-03T15:05:00Z"));
  });

  it("rejects a number that is not E.164", () => {
    expect(() => smsSourceRef("410-555-1234", "2026-11-03T14:05:00Z")).toThrow();
  });
});

describe("otherSourceRef", () => {
  it("hashes the lower-cased sender email with the full original text, not the excerpt", () => {
    const original = "Dear Rob,\n\nJo taught me to quilt.\n\nLove, Pat";
    const ref = otherSourceRef("Pat@Example.com", original);
    expect(ref).toBe(`other:${sha(`pat@example.com|${original}`).slice(0, 32)}`);
    expect(ref).not.toContain("example.com");
    expect(ref).toMatch(SOURCE_REF_PATTERN);
  });

  it("gives two people with identical words different refs", () => {
    expect(otherSourceRef("a@example.com", "same words")).not.toBe(otherSourceRef("b@example.com", "same words"));
  });
});
