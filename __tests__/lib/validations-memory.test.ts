import { describe, expect, it } from "vitest";

import { createMemoryInputSchema, fileInputSchema, uploadTicketRequestSchema } from "@/lib/validations/memory";

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
