import { describe, expect, it } from "vitest";

import { MAX_FILES_PER_MEMORY } from "@/lib/media-types";
import { createMemoryInputSchema, fileInputSchema, memoryFileInputSchema, uploadTicketRequestSchema } from "@/lib/validations/memory";

const textOnly = { note: "She once taught me to quilt.", files: [] };
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
    const parsed = createMemoryInputSchema.parse({ files: [{ ...file, durationSeconds: 24 }] });
    expect(parsed.files[0]?.durationSeconds).toBe(24);
  });

  it("accepts up to the per-memory cap of files, each with optional caption, date and place, and trims them", () => {
    const files = Array.from({ length: MAX_FILES_PER_MEMORY }, (_, i) => ({ ...file, name: `f${i}.webm`, caption: `  take ${i}  `, approxDateText: "", place: " Lake George " }));
    const parsed = createMemoryInputSchema.parse({ files });
    expect(parsed.files).toHaveLength(MAX_FILES_PER_MEMORY);
    expect(parsed.files[0]).toMatchObject({ caption: "take 0", approxDateText: null, place: "Lake George" });
    expect(createMemoryInputSchema.safeParse({ files: [...files, file] }).success).toBe(false);
  });

  it("needs a file or a few words; an empty list with no note is invalid", () => {
    expect(createMemoryInputSchema.safeParse({ files: [], note: "   " }).success).toBe(false);
    expect(createMemoryInputSchema.safeParse({ files: [file] }).success).toBe(true);
    expect(createMemoryInputSchema.parse({ note: "words" }).files).toEqual([]);
  });

  it("caps per-file text lengths", () => {
    expect(memoryFileInputSchema.safeParse({ ...file, caption: "x".repeat(2001) }).success).toBe(false);
    expect(memoryFileInputSchema.safeParse({ ...file, approxDateText: "x".repeat(121) }).success).toBe(false);
    expect(memoryFileInputSchema.safeParse({ ...file, place: "x".repeat(201) }).success).toBe(false);
  });

  it("accepts a claim-page upload ticket without a duration, with optional per-file fields", () => {
    const input = { claimToken: "t".repeat(43), file };
    expect(uploadTicketRequestSchema.parse(input)).toEqual(input);
    expect(uploadTicketRequestSchema.parse({ ...input, file: { ...file, caption: "the lake" } }).file).toMatchObject({ caption: "the lake" });
  });
});
