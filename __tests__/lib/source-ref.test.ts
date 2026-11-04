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
  it("hashes the E.164 number, the text's timestamp (UTC minute) and the canonical text; the number never appears in clear", () => {
    const ref = smsSourceRef("+14105551234", "2026-11-03T14:05:00Z", "Jo was a light.");
    expect(ref).toBe(`sms:${sha("+14105551234|2026-11-03T14:05Z|Jo was a light.").slice(0, 32)}`);
    expect(ref).not.toContain("4105551234");
    expect(ref).toMatch(SOURCE_REF_PATTERN);
  });

  it("gives two texts from the same number different refs, even within the same minute when the words differ", () => {
    expect(smsSourceRef("+14105551234", "2026-11-03T14:05:00Z", "a")).not.toBe(smsSourceRef("+14105551234", "2026-11-03T15:05:00Z", "a"));
    expect(smsSourceRef("+14105551234", "2026-11-03T14:05:01Z", "first text")).not.toBe(smsSourceRef("+14105551234", "2026-11-03T14:05:58Z", "second text"));
  });

  it("rejects an empty text", () => {
    expect(() => smsSourceRef("+14105551234", "2026-11-03T14:05:00Z", "  \n")).toThrow(/text/);
  });

  it("canonicalises the timestamp to UTC at minute precision, so a retyped zone or seconds cannot make a second draft", () => {
    const a = smsSourceRef("+14105551234", "2026-11-03T10:05:00-04:00", "Jo");
    expect(a).toBe(smsSourceRef("+14105551234", "2026-11-03T14:05Z", "Jo\r\n"));
    expect(a).toBe(smsSourceRef("+14105551234", "2026-11-03T14:05:37.250Z", "Jo"));
    expect(a).toBe(`sms:${sha("+14105551234|2026-11-03T14:05Z|Jo").slice(0, 32)}`);
    expect(() => smsSourceRef("+14105551234", "yesterday", "Jo")).toThrow(/timestamp/);
    // A zone-less timestamp would be read in the process's zone and hash differently on another machine.
    expect(() => smsSourceRef("+14105551234", "2026-11-03T10:05", "Jo")).toThrow(/zone|offset|Z/);
    expect(() => smsSourceRef("+14105551234", "2026-11-03", "Jo")).toThrow(/zone|offset|Z/);
  });

  it("rejects a number that is not E.164", () => {
    expect(() => smsSourceRef("410-555-1234", "2026-11-03T14:05:00Z", "Jo")).toThrow();
  });
});

describe("otherSourceRef", () => {
  it("hashes the lower-cased sender email with the full original text, not the excerpt", () => {
    const original = "Dear Rob,\n\nJo taught me to quilt.\n\nLove, Pat";
    const ref = otherSourceRef("Pat@Example.com", original);
    expect(ref).toBe(`other:${sha(`pat@example.com|${original}`).slice(0, 32)}`);
    expect(otherSourceRef("a@example.com", "same words")).not.toBe(otherSourceRef("a@example.com", "other words"));
    expect(ref).not.toContain("example.com");
    expect(ref).toMatch(SOURCE_REF_PATTERN);
  });

  it("canonicalises the text (NFC, LF line ends, trailing whitespace and blank lines dropped) so a re-paste matches", () => {
    const a = otherSourceRef("pat@example.com", "Dear Rob,\r\n\r\nJo taught me to quilt.  \r\n\r\nLove, Pat\r\n\r\n");
    expect(a).toBe(otherSourceRef("pat@example.com", "Dear Rob,\n\nJo taught me to quilt.\n\nLove, Pat"));
    expect(otherSourceRef("pat@example.com", "caf\u00e9")).toBe(otherSourceRef("pat@example.com", "cafe\u0301"));
  });

  it("rejects an empty or non-address email and an empty text", () => {
    expect(() => otherSourceRef("", "words")).toThrow(/email/);
    expect(() => otherSourceRef("not-an-address", "words")).toThrow(/email/);
    expect(() => otherSourceRef("pat@example.com", " \n ")).toThrow(/text/);
  });

  it("gives two people with identical words different refs", () => {
    expect(otherSourceRef("a@example.com", "same words")).not.toBe(otherSourceRef("b@example.com", "same words"));
  });
});
