import { describe, expect, it } from "vitest";

import { createMemoryInputSchema, draftMemoryInputSchema, fileInputSchema, uploadTicketRequestSchema } from "@/lib/validations/memory";

const textOnly = { note: "She once taught me to quilt.", file: null };
const file = { name: "clip.webm", type: "audio/webm;codecs=opus", size: 10 };

describe("createMemoryInputSchema defaults", () => {
  it("defaults visibility to PUBLIC when the field is absent (Rob, 2026-11-03)", () => {
    const parsed = createMemoryInputSchema.parse(textOnly);
    expect(parsed.visibility).toBe("PUBLIC");
  });

  it("keeps an explicit visibility", () => {
    expect(createMemoryInputSchema.parse({ ...textOnly, visibility: "FAMILY" }).visibility).toBe("FAMILY");
    expect(createMemoryInputSchema.parse({ ...textOnly, visibility: "PRIVATE" }).visibility).toBe("PRIVATE");
  });

  it("rejects an unknown visibility", () => {
    expect(createMemoryInputSchema.safeParse({ ...textOnly, visibility: "FRIENDS" }).success).toBe(false);
  });

  it("defaults contactOptIn to false when absent; the share form sends true because its checkbox is on by default", () => {
    expect(createMemoryInputSchema.parse(textOnly).contactOptIn).toBe(false);
  });

  it("defaults the weekly mailing list to off and 'tell me when my story is posted' to on (Rob, 2026-11-03)", () => {
    const parsed = createMemoryInputSchema.parse(textOnly);
    expect(parsed.mailingListOptIn).toBe(false);
    expect(parsed.notifyWhenPosted).toBe(true);
  });

  it("keeps explicit preference values", () => {
    const parsed = createMemoryInputSchema.parse({ ...textOnly, mailingListOptIn: true, notifyWhenPosted: false });
    expect(parsed.mailingListOptIn).toBe(true);
    expect(parsed.notifyWhenPosted).toBe(false);
  });
});

describe("fileInputSchema", () => {
  it("accepts a file without a duration", () => {
    expect(fileInputSchema.parse(file)).toEqual(file);
  });

  it.each([0, 24, 86_400])("keeps a duration of %i seconds", (durationSeconds) => {
    expect(fileInputSchema.parse({ ...file, durationSeconds })).toEqual({ ...file, durationSeconds });
  });

  it.each([1.5, -1, 86_401, "24"])("rejects invalid duration %s", (durationSeconds) => {
    expect(fileInputSchema.safeParse({ ...file, durationSeconds }).success).toBe(false);
  });
});

describe("memory file validation", () => {
  it("keeps the duration on a new memory's file", () => {
    const parsed = createMemoryInputSchema.parse({ file: { ...file, durationSeconds: 24 } });
    expect(parsed.file?.durationSeconds).toBe(24);
  });

  it("accepts a claim-page upload ticket without a duration", () => {
    const input = { claimToken: "t".repeat(43), file };
    expect(uploadTicketRequestSchema.parse(input)).toEqual(input);
  });
});

describe("draftMemoryInputSchema", () => {
  const valid = {
    contributor: { name: "Joyce", email: "Joyce@Example.com", relationship: "Friend from church" },
    note: "Jo always had a kind word.",
    source: "EMAIL",
    sourceRef: "gmail:1a1a2317fba34eec",
  };

  it("accepts a drafted memory, lower-cases the email and defaults visibility to PUBLIC", () => {
    const parsed = draftMemoryInputSchema.parse(valid);
    expect(parsed.contributor.email).toBe("joyce@example.com");
    expect(parsed.visibility).toBe("PUBLIC");
    expect(parsed.contributor.phone).toBeUndefined();
  });

  it("trims and lower-cases a padded address before checking it (zod 4 checks the format first unless piped)", () => {
    expect(draftMemoryInputSchema.parse({ ...valid, contributor: { email: "  Joyce@Example.com " } }).contributor.email).toBe("joyce@example.com");
  });

  it("requires a valid email: an admin draft is only ever reached through the sender's address", () => {
    expect(draftMemoryInputSchema.safeParse({ ...valid, contributor: { name: "Joyce" } }).success).toBe(false);
    expect(draftMemoryInputSchema.safeParse({ ...valid, contributor: { email: "not-an-address" } }).success).toBe(false);
  });

  it("requires words: an empty or whitespace note is rejected, a 10 001-character one too", () => {
    expect(draftMemoryInputSchema.safeParse({ ...valid, note: "   " }).success).toBe(false);
    expect(draftMemoryInputSchema.safeParse({ ...valid, note: "x".repeat(10_001) }).success).toBe(false);
  });

  it("only accepts the admin sources and a sourceRef that follows the scheme", () => {
    expect(draftMemoryInputSchema.safeParse({ ...valid, source: "WEB_UPLOAD" }).success).toBe(false);
    expect(draftMemoryInputSchema.safeParse({ ...valid, source: "SMS", sourceRef: `sms:${"a".repeat(32)}` }).success).toBe(true);
    expect(draftMemoryInputSchema.safeParse({ ...valid, source: "OTHER", sourceRef: `other:${"b".repeat(32)}` }).success).toBe(true);
    expect(draftMemoryInputSchema.safeParse({ ...valid, sourceRef: "gmail:thread-f:123" }).success).toBe(false);
    expect(draftMemoryInputSchema.safeParse({ ...valid, sourceRef: "sms:+14105551234" }).success).toBe(false);
    expect(draftMemoryInputSchema.safeParse({ ...valid, sourceRef: "" }).success).toBe(false);
  });

  it("keeps the note exactly as given (never trimmed or rewritten) and turns empty optional fields into null", () => {
    const parsed = draftMemoryInputSchema.parse({ ...valid, note: "  Two spaces lead.\n\nAnd a blank line.  ", approxDateText: "", place: " Broadmead " });
    expect(parsed.note).toBe("  Two spaces lead.\n\nAnd a blank line.  ");
    expect(parsed.approxDateText).toBeNull();
    expect(parsed.place).toBe("Broadmead");
  });
});
