import { describe, expect, it } from "vitest";

import { adminDraftFormSchema, adminListQuerySchema, adminMemoryChangesSchema } from "@/lib/validations/admin";

const MEMORY_ID = "00000000-0000-4000-8000-000000000001";
const VERSIONS = { memoryVersion: "2026-11-04T10:00:00.000Z", contributorVersion: "2026-11-04T10:00:00.000Z" };

describe("adminListQuerySchema (V1)", () => {
  it("reads `deleted` as a checkbox: on, 1 and true mean true; absent means undefined", () => {
    expect(adminListQuerySchema.parse({ deleted: "on" }).deleted).toBe(true);
    expect(adminListQuerySchema.parse({ deleted: "1" }).deleted).toBe(true);
    expect(adminListQuerySchema.parse({ deleted: "true" }).deleted).toBe(true);
    expect(adminListQuerySchema.parse({}).deleted).toBeUndefined();
    expect(adminListQuerySchema.safeParse({ deleted: "yes" }).success).toBe(false);
  });

  it("trims the search text, drops an empty one and refuses more than 100 characters", () => {
    expect(adminListQuerySchema.parse({ q: "  joyce " }).q).toBe("joyce");
    expect(adminListQuerySchema.parse({ q: "   " }).q).toBeUndefined();
    expect(adminListQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
  });

  it("accepts only the four statuses", () => {
    for (const status of ["DRAFT", "PENDING", "APPROVED", "HIDDEN"]) {
      expect(adminListQuerySchema.parse({ status }).status).toBe(status);
    }
    expect(adminListQuerySchema.safeParse({ status: "DELETED" }).success).toBe(false);
    expect(adminListQuerySchema.parse({}).status).toBeUndefined();
  });
});

describe("adminMemoryChangesSchema (V2)", () => {
  it("accepts the six editable keys, trimming text and storing an emptied field as null", () => {
    const parsed = adminMemoryChangesSchema.parse({
      memoryId: MEMORY_ID,
      ...VERSIONS,
      changes: { name: " Joyce ", relationship: "", approxDateText: "Summer 1998", place: "Baltimore", note: "words", visibility: "FAMILY" },
    });
    expect(parsed.changes).toEqual({ name: "Joyce", relationship: null, approxDateText: "Summer 1998", place: "Baltimore", note: "words", visibility: "FAMILY" });
  });

  it("stores an emptied note as null and keeps a note's inner whitespace", () => {
    expect(adminMemoryChangesSchema.parse({ memoryId: MEMORY_ID, ...VERSIONS, changes: { note: "   " } }).changes.note).toBeNull();
    expect(adminMemoryChangesSchema.parse({ memoryId: MEMORY_ID, ...VERSIONS, changes: { note: "a\n\n b" } }).changes.note).toBe("a\n\n b");
  });

  it("rejects the contributor's email and preferences as unknown keys", () => {
    for (const key of ["email", "notifyWhenPosted", "contactOptIn", "mailingListOptIn", "status"]) {
      const result = adminMemoryChangesSchema.safeParse({ memoryId: MEMORY_ID, ...VERSIONS, changes: { [key]: "x" } });
      expect(result.success, key).toBe(false);
    }
  });

  it("requires both versions (the contributor's may be null) and a uuid memory id", () => {
    expect(adminMemoryChangesSchema.safeParse({ memoryId: MEMORY_ID, changes: {} }).success).toBe(false);
    expect(adminMemoryChangesSchema.safeParse({ memoryId: MEMORY_ID, memoryVersion: "2026-11-04T10:00:00.000Z", changes: {} }).success).toBe(false);
    expect(adminMemoryChangesSchema.safeParse({ memoryId: MEMORY_ID, memoryVersion: "2026-11-04T10:00:00.000Z", contributorVersion: null, changes: {} }).success).toBe(true);
    expect(adminMemoryChangesSchema.safeParse({ memoryId: MEMORY_ID, memoryVersion: "yesterday", contributorVersion: null, changes: {} }).success).toBe(false);
    expect(adminMemoryChangesSchema.safeParse({ memoryId: "mem_1", ...VERSIONS, changes: {} }).success).toBe(false);
  });

  it("refuses over-long values", () => {
    expect(adminMemoryChangesSchema.safeParse({ memoryId: MEMORY_ID, ...VERSIONS, changes: { note: "x".repeat(10_001) } }).success).toBe(false);
    expect(adminMemoryChangesSchema.safeParse({ memoryId: MEMORY_ID, ...VERSIONS, changes: { place: "x".repeat(201) } }).success).toBe(false);
  });
});

describe("adminDraftFormSchema (V3)", () => {
  const valid = { name: "Joyce", email: " Joyce@Example.com ", relationship: "Friend", note: "Jo was kind.", approxDateText: "", place: "", visibility: "PUBLIC" };

  it("requires an email (lower-cased) and a note with words; the note is kept verbatim", () => {
    const parsed = adminDraftFormSchema.parse({ ...valid, note: "  Jo was kind.\n\nShe will be missed. " });
    expect(parsed.email).toBe("joyce@example.com");
    expect(parsed.note).toBe("  Jo was kind.\n\nShe will be missed. ");
    expect(parsed).toMatchObject({ name: "Joyce", relationship: "Friend", approxDateText: null, place: null, visibility: "PUBLIC" });
    expect(adminDraftFormSchema.safeParse({ ...valid, email: "" }).success).toBe(false);
    expect(adminDraftFormSchema.safeParse({ ...valid, email: "not-an-address" }).success).toBe(false);
    expect(adminDraftFormSchema.safeParse({ ...valid, note: "   " }).success).toBe(false);
  });

  it("defaults visibility to PUBLIC and has no source key", () => {
    const { visibility: _v, ...withoutVisibility } = valid;
    expect(adminDraftFormSchema.parse(withoutVisibility).visibility).toBe("PUBLIC");
    expect(adminDraftFormSchema.safeParse({ ...valid, source: "EMAIL" }).success).toBe(false);
    expect(adminDraftFormSchema.safeParse({ ...valid, sourceRef: "other:" + "a".repeat(32) }).success).toBe(false);
    expect(adminDraftFormSchema.safeParse({ ...valid, phone: "+15555550100" }).success).toBe(false);
  });
});
