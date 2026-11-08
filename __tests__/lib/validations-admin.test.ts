import { describe, expect, it } from "vitest";

import { z } from "zod";

import { adminCoordinatesSchema, adminDraftFormSchema, adminListQuerySchema, adminMemoryChangesSchema } from "@/lib/validations/admin";

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

describe("adminCoordinatesSchema (MCP set_coordinates, plan 2026-11-06 §4.2)", () => {
  const base = { memoryId: MEMORY_ID, memoryVersion: VERSIONS.memoryVersion };

  it("takes a memory id, the version get_memory returned and a WGS 84 pair, or null to clear both", () => {
    expect(adminCoordinatesSchema.parse({ ...base, coordinates: { latitude: 39.4815, longitude: -76.6447 } })).toEqual({ ...base, coordinates: { latitude: 39.4815, longitude: -76.6447 } });
    expect(adminCoordinatesSchema.parse({ ...base, coordinates: null }).coordinates).toBeNull();
  });

  it("requires coordinates to be stated: an omitted key is not a clear", () => {
    expect(adminCoordinatesSchema.safeParse(base).success).toBe(false);
  });

  it("refuses a half pair, an out-of-range value, a string, a stale-looking version and a non-uuid id", () => {
    expect(adminCoordinatesSchema.safeParse({ ...base, coordinates: { latitude: 39.4815 } }).success).toBe(false);
    expect(adminCoordinatesSchema.safeParse({ ...base, coordinates: { latitude: 91, longitude: 0 } }).success).toBe(false);
    expect(adminCoordinatesSchema.safeParse({ ...base, coordinates: { latitude: 0, longitude: -180.0001 } }).success).toBe(false);
    expect(adminCoordinatesSchema.safeParse({ ...base, coordinates: { latitude: "39.4815", longitude: "-76.6447" } }).success).toBe(false);
    expect(adminCoordinatesSchema.safeParse({ ...base, memoryVersion: "yesterday", coordinates: null }).success).toBe(false);
    expect(adminCoordinatesSchema.safeParse({ ...base, memoryId: "mem_1", coordinates: null }).success).toBe(false);
  });

  it("tells the model in the JSON Schema to pass memoryVersion exactly as get_memory returned it", () => {
    const schema = z.toJSONSchema(adminCoordinatesSchema);
    expect(schema.properties?.memoryVersion).toMatchObject({ type: "string", description: "ISO-8601 timestamp exactly as get_memory returned it" });
  });
});

describe("adminMemoryChangesSchema: tags, approxYear, approxMonth (plan 2026-11-08 D3, D4)", () => {
  const parse = (changes: Record<string, unknown>) => adminMemoryChangesSchema.safeParse({ memoryId: MEMORY_ID, ...VERSIONS, changes });
  const thisYear = new Date().getUTCFullYear();

  it("normalises tags: trimmed, one spelling per slug (the first), order kept", () => {
    const parsed = parse({ tags: ["  Café ", "cafe", "St. Mary's", "St Marys", "Ocean   City"] });
    expect(parsed.success && parsed.data.changes.tags).toEqual(["Café", "St. Mary's", "Ocean City"]);
    const empty = parse({ tags: [] });
    expect(empty.success && empty.data.changes.tags).toEqual([]);
  });

  it("refuses a patch with no letter or digit, an empty one, one over 40 characters and more than 20", () => {
    expect(parse({ tags: ["!!!"] }).success).toBe(false);
    expect(parse({ tags: ["   "] }).success).toBe(false);
    expect(parse({ tags: ["日本"] }).success).toBe(false);
    expect(parse({ tags: ["x".repeat(41)] }).success).toBe(false);
    expect(parse({ tags: ["x".repeat(40)] }).success).toBe(true);
    expect(parse({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }).success).toBe(false);
    expect(parse({ tags: "quilting" }).success).toBe(false);
  });

  it("accepts a whole year from 1900 to this year, null to clear, and leaves it alone when absent", () => {
    expect(parse({ approxYear: 1900 }).success).toBe(true);
    expect(parse({ approxYear: thisYear }).success).toBe(true);
    expect(parse({ approxYear: 1899 }).success).toBe(false);
    expect(parse({ approxYear: thisYear + 1 }).success).toBe(false);
    expect(parse({ approxYear: 1985.5 }).success).toBe(false);
    expect(parse({ approxYear: "1985" }).success).toBe(false);
    const cleared = parse({ approxYear: null });
    expect(cleared.success && cleared.data.changes.approxYear).toBeNull();
    const absent = parse({ place: "x" });
    expect(absent.success && absent.data.changes.approxYear).toBeUndefined();
  });

  it("accepts a month 1–12 or null, and refuses a month sent with a cleared year", () => {
    expect(parse({ approxMonth: 1 }).success).toBe(true);
    expect(parse({ approxMonth: 12 }).success).toBe(true);
    expect(parse({ approxMonth: 0 }).success).toBe(false);
    expect(parse({ approxMonth: 13 }).success).toBe(false);
    expect(parse({ approxMonth: null, approxYear: null }).success).toBe(true);
    expect(parse({ approxMonth: 4, approxYear: 1985 }).success).toBe(true);
    expect(parse({ approxMonth: 4, approxYear: null }).success).toBe(false);
  });
});
