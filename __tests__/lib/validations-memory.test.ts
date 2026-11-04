import { describe, expect, it } from "vitest";

import { MAX_FILES_PER_MEMORY } from "@/lib/media-types";
import { createSubmissionInputSchema, draftMemoryInputSchema, fileInputSchema, memoryFileInputSchema, submissionMemorySchema, uploadTicketRequestSchema } from "@/lib/validations/memory";

const textOnly = { memories: [{ note: "She once taught me to quilt.", files: [] }] };
const file = { name: "clip.webm", type: "audio/webm;codecs=opus", size: 10 };

describe("createSubmissionInputSchema defaults", () => {
  it("defaults visibility to PUBLIC when the field is absent (Rob, 2026-11-03)", () => {
    const parsed = createSubmissionInputSchema.parse(textOnly);
    expect(parsed.visibility).toBe("PUBLIC");
  });

  it("keeps an explicit visibility", () => {
    expect(createSubmissionInputSchema.parse({ ...textOnly, visibility: "FAMILY" }).visibility).toBe("FAMILY");
    expect(createSubmissionInputSchema.parse({ ...textOnly, visibility: "PRIVATE" }).visibility).toBe("PRIVATE");
  });

  it("rejects an unknown visibility", () => {
    expect(createSubmissionInputSchema.safeParse({ ...textOnly, visibility: "FRIENDS" }).success).toBe(false);
  });

  it("defaults contactOptIn to false when absent; the share form sends true because its checkbox is on by default", () => {
    expect(createSubmissionInputSchema.parse(textOnly).contactOptIn).toBe(false);
  });

  it("defaults the weekly mailing list to off and 'tell me when my story is posted' to on (Rob, 2026-11-03)", () => {
    const parsed = createSubmissionInputSchema.parse(textOnly);
    expect(parsed.mailingListOptIn).toBe(false);
    expect(parsed.notifyWhenPosted).toBe(true);
  });

  it("keeps explicit preference values", () => {
    const parsed = createSubmissionInputSchema.parse({ ...textOnly, mailingListOptIn: true, notifyWhenPosted: false });
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
    const parsed = createSubmissionInputSchema.parse({ memories: [{ files: [{ ...file, durationSeconds: 24 }] }] });
    expect(parsed.memories[0]?.files[0]?.durationSeconds).toBe(24);
  });

  it("a card takes up to the per-memory cap of files and needs a file or a few words", () => {
    const files = Array.from({ length: MAX_FILES_PER_MEMORY }, (_, i) => ({ ...file, name: `f${i}.webm` }));
    expect(submissionMemorySchema.parse({ files }).files).toHaveLength(MAX_FILES_PER_MEMORY);
    expect(submissionMemorySchema.safeParse({ files: [...files, file] }).success).toBe(false);
    expect(submissionMemorySchema.safeParse({ files: [], note: "   " }).success).toBe(false);
    expect(submissionMemorySchema.safeParse({ files: [file] }).success).toBe(true);
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

describe("createSubmissionInputSchema (Task 15)", async () => {
  const { createSubmissionInputSchema, MAX_MEMORIES_PER_SUBMISSION, submissionIssueLocation } = await import("@/lib/validations/memory");
  const memory = (over: Record<string, unknown> = {}) => ({ note: "words", files: [], ...over });
  const send = (memories: unknown[]) => ({ name: "Kay", email: "kay@example.com", memories });

  it("takes 1 to 10 memories, each with at most 10 files", () => {
    expect(MAX_MEMORIES_PER_SUBMISSION).toBe(10);
    expect(createSubmissionInputSchema.safeParse(send([])).success).toBe(false);
    expect(createSubmissionInputSchema.safeParse(send([memory()])).success).toBe(true);
    expect(createSubmissionInputSchema.safeParse(send(Array.from({ length: 10 }, () => memory()))).success).toBe(true);
    expect(createSubmissionInputSchema.safeParse(send(Array.from({ length: 11 }, () => memory()))).success).toBe(false);
    const tenFiles = Array.from({ length: 10 }, (_, i) => ({ ...file, name: `f${i}.webm` }));
    expect(createSubmissionInputSchema.safeParse(send([memory({ files: tenFiles })])).success).toBe(true);
    expect(createSubmissionInputSchema.safeParse(send([memory({ files: [...tenFiles, file] })])).success).toBe(false);
  });

  it("each memory needs files or words; blank words do not count", () => {
    expect(createSubmissionInputSchema.safeParse(send([memory({ note: "   ", files: [] })])).success).toBe(false);
    expect(createSubmissionInputSchema.safeParse(send([memory({ note: null, files: [file] })])).success).toBe(true);
    expect(createSubmissionInputSchema.safeParse(send([memory(), memory({ note: "", files: [] })])).success).toBe(false);
  });

  it("shares one set of contributor fields and defaults with the single-memory form", () => {
    const parsed = createSubmissionInputSchema.parse(send([memory()]));
    expect(parsed).toMatchObject({ visibility: "PUBLIC", contactOptIn: false, mailingListOptIn: false, notifyWhenPosted: true, email: "kay@example.com" });
    expect(createSubmissionInputSchema.safeParse({ ...send([memory()]), email: "not-an-address" }).success).toBe(false);
  });

  it("issues carry memoryIndex and fileIndex", () => {
    const result = createSubmissionInputSchema.safeParse(send([memory(), memory({ note: "", files: [] }), memory({ files: [{ ...file, size: -1 }] })]));
    expect(result.success).toBe(false);
    if (result.success) { return; }
    const locations = result.error.issues.map((issue) => submissionIssueLocation(issue));
    expect(locations).toContainEqual({ memoryIndex: 1, fileIndex: null, message: "Add a file, a recording, or a few words" });
    expect(locations).toContainEqual(expect.objectContaining({ memoryIndex: 2, fileIndex: 0 }));
    const top = createSubmissionInputSchema.safeParse({ ...send([memory()]), email: "nope" });
    expect(top.success).toBe(false);
    if (!top.success) {
      expect(submissionIssueLocation(top.error.issues[0]!)).toMatchObject({ memoryIndex: null, fileIndex: null });
    }
  });
});

describe("ticket and completion schemas (Task 15)", async () => {
  const { completeSubmissionSchema, issueTicketRequestSchema } = await import("@/lib/validations/memory");

  it("a per-file ticket request names the claim token and the media row", () => {
    expect(issueTicketRequestSchema.safeParse({ claimToken: "t".repeat(43), mediaId: "med_1" }).success).toBe(true);
    expect(issueTicketRequestSchema.safeParse({ claimToken: "short", mediaId: "med_1" }).success).toBe(false);
    expect(issueTicketRequestSchema.safeParse({ claimToken: "t".repeat(43), mediaId: "" }).success).toBe(false);
  });

  it("completion takes 1 to 10 claim tokens", () => {
    expect(completeSubmissionSchema.safeParse({ claimTokens: [] }).success).toBe(false);
    expect(completeSubmissionSchema.safeParse({ claimTokens: ["t".repeat(43)] }).success).toBe(true);
    expect(completeSubmissionSchema.safeParse({ claimTokens: Array.from({ length: 11 }, () => "t".repeat(43)) }).success).toBe(false);
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
    expect(draftMemoryInputSchema.parse({ ...valid, contributor: { ...valid.contributor, phone: "  " } }).contributor.phone).toBeNull();
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

  it("requires the sourceRef scheme to match the source", () => {
    expect(draftMemoryInputSchema.safeParse({ ...valid, source: "SMS", sourceRef: "gmail:1a1a2317fba34eec" }).success).toBe(false);
    expect(draftMemoryInputSchema.safeParse({ ...valid, source: "EMAIL", sourceRef: `other:${"b".repeat(32)}` }).success).toBe(false);
    expect(draftMemoryInputSchema.safeParse({ ...valid, source: "OTHER", sourceRef: `sms:${"a".repeat(32)}` }).success).toBe(false);
  });

  it("keeps the note exactly as given (never trimmed or rewritten) and turns empty optional fields into null", () => {
    const parsed = draftMemoryInputSchema.parse({ ...valid, note: "  Two spaces lead.\n\nAnd a blank line.  ", approxDateText: "", place: " Broadmead " });
    expect(parsed.note).toBe("  Two spaces lead.\n\nAnd a blank line.  ");
    expect(parsed.approxDateText).toBeNull();
    expect(parsed.place).toBe("Broadmead");
  });
});
