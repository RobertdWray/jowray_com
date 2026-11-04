import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { claimMediaRefSchema, completeSubmissionSchema, mediaChangesSchema, mediaWordsRequestSchema, replaceRequestSchema } from "@/lib/validations/media";
import { memoryFileInputSchema } from "@/lib/validations/memory";

const TOKEN = "t".repeat(43);

describe("claimMediaRefSchema", () => {
  it("accepts a claim token and a media uuid", () => {
    const mediaId = randomUUID();
    expect(claimMediaRefSchema.parse({ claimToken: TOKEN, mediaId })).toEqual({ claimToken: TOKEN, mediaId });
  });

  it("rejects a short token, a non-uuid media id and extra shapes", () => {
    expect(claimMediaRefSchema.safeParse({ claimToken: "short", mediaId: randomUUID() }).success).toBe(false);
    expect(claimMediaRefSchema.safeParse({ claimToken: TOKEN, mediaId: "med_1" }).success).toBe(false);
    expect(claimMediaRefSchema.safeParse({ claimToken: TOKEN }).success).toBe(false);
    expect(claimMediaRefSchema.safeParse(null).success).toBe(false);
  });
});

describe("replaceRequestSchema", () => {
  it("requires the file the browser picked", () => {
    const base = { claimToken: TOKEN, mediaId: randomUUID() };
    expect(replaceRequestSchema.safeParse(base).success).toBe(false);
    expect(replaceRequestSchema.parse({ ...base, file: { name: "b.jpg", type: "image/jpeg", size: 10 } }).file).toEqual({ name: "b.jpg", type: "image/jpeg", size: 10 });
  });
});

describe("mediaChangesSchema", () => {
  it("accepts any subset of caption, date and place, trimming and nulling empties", () => {
    expect(mediaChangesSchema.parse({ caption: "  her desk ", place: "" })).toEqual({ caption: "her desk", place: null });
    expect(mediaChangesSchema.parse({})).toEqual({});
    expect(mediaChangesSchema.safeParse({ caption: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("request schemas for the submission and per-file Server Functions", () => {
  it("completeSubmissionSchema takes exactly a claim token", () => {
    expect(completeSubmissionSchema.safeParse({ claimToken: TOKEN }).success).toBe(true);
    expect(completeSubmissionSchema.safeParse({ claimToken: "short" }).success).toBe(false);
    expect(completeSubmissionSchema.safeParse(null).success).toBe(false);
  });

  it("mediaWordsRequestSchema wraps the media reference and the changes", () => {
    const parsed = mediaWordsRequestSchema.safeParse({ claimToken: TOKEN, mediaId: randomUUID(), changes: { caption: " x " } });
    expect(parsed.success && parsed.data.changes).toEqual({ caption: "x" });
    expect(mediaWordsRequestSchema.safeParse({ claimToken: TOKEN, changes: {} }).success).toBe(false);
  });

  it("the per-file word limits are the same on the share form and on the claim page", () => {
    const long = "x".repeat(2001);
    expect(memoryFileInputSchema.safeParse({ name: "a.jpg", type: "image/jpeg", size: 1, caption: long }).success).toBe(false);
    expect(mediaChangesSchema.safeParse({ caption: long }).success).toBe(false);
    expect(memoryFileInputSchema.safeParse({ name: "a.jpg", type: "image/jpeg", size: 1, place: "p".repeat(201) }).success).toBe(false);
    expect(mediaChangesSchema.safeParse({ place: "p".repeat(201) }).success).toBe(false);
  });
});
