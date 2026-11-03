import { describe, expect, it } from "vitest";

import { EMPTY_SHARE_DRAFT, isShareDraftEmpty, parseShareDraft, serializeShareDraft, SHARE_DRAFT_TTL_MS, type ShareDraft } from "@/lib/share-draft";

const NOW = 1_800_000_000_000;
const draft: ShareDraft = {
  name: "Jo Friend",
  relationship: "neighbour",
  approxDateText: "Summer 1998",
  place: "The garden",
  note: "  We laughed a lot.\nThen we had tea.  ",
};

describe("share draft storage", () => {
  it("round-trips all five text fields without losing whitespace", () => {
    const raw = serializeShareDraft(draft, NOW);
    expect(JSON.parse(raw)).toEqual({ v: 1, savedAt: NOW, fields: draft });
    expect(parseShareDraft(raw, NOW)).toEqual(draft);
  });

  it("expires a draft older than 30 days", () => {
    const raw = serializeShareDraft(draft, NOW - SHARE_DRAFT_TTL_MS - 1);
    expect(parseShareDraft(raw, NOW)).toBeNull();
  });

  it("keeps a draft exactly at the expiry boundary", () => {
    const raw = serializeShareDraft(draft, NOW - SHARE_DRAFT_TTL_MS);
    expect(parseShareDraft(raw, NOW)).toEqual(draft);
  });

  it.each([null, "", "{", "null"])("returns null for absent or malformed storage: %s", (raw) => {
    expect(parseShareDraft(raw, NOW)).toBeNull();
  });

  it("rejects an unsupported version", () => {
    expect(parseShareDraft(JSON.stringify({ v: 2, savedAt: NOW, fields: draft }), NOW)).toBeNull();
  });

  it.each(["name", "relationship", "approxDateText", "place", "note"] as const)("rejects a draft missing %s", (field) => {
    const fields: Partial<ShareDraft> = { ...draft };
    delete fields[field];
    expect(parseShareDraft(JSON.stringify({ v: 1, savedAt: NOW, fields }), NOW)).toBeNull();
  });

  it("rejects a nonnumeric savedAt", () => {
    expect(parseShareDraft(JSON.stringify({ v: 1, savedAt: String(NOW), fields: draft }), NOW)).toBeNull();
  });

  it("rejects a nonstring field", () => {
    expect(parseShareDraft(JSON.stringify({ v: 1, savedAt: NOW, fields: { ...draft, note: null } }), NOW)).toBeNull();
  });

  it("drops unknown keys from stored fields", () => {
    const raw = JSON.stringify({ v: 1, savedAt: NOW, extra: true, fields: { ...draft, email: "private@example.com" } });
    expect(parseShareDraft(raw, NOW)).toEqual(draft);
  });

  it("limits serialized fields to their form maximum lengths", () => {
    const oversized: ShareDraft = {
      name: "a".repeat(121),
      relationship: "b".repeat(121),
      approxDateText: "c".repeat(121),
      place: "d".repeat(201),
      note: "e".repeat(10_001),
    };
    const fields = {
      name: "a".repeat(120),
      relationship: "b".repeat(120),
      approxDateText: "c".repeat(120),
      place: "d".repeat(200),
      note: "e".repeat(10_000),
    };
    const raw = serializeShareDraft(oversized, NOW);
    expect(JSON.parse(raw)).toEqual({ v: 1, savedAt: NOW, fields });
    expect(parseShareDraft(raw, NOW)).toEqual(fields);
    expect(oversized.note).toHaveLength(10_001);
  });
});

describe("isShareDraftEmpty", () => {
  it("recognizes the empty draft", () => {
    expect(isShareDraftEmpty(EMPTY_SHARE_DRAFT)).toBe(true);
  });

  it("treats whitespace-only text as empty", () => {
    expect(isShareDraftEmpty({ name: " ", relationship: "\t", approxDateText: "\n", place: " \t ", note: "\n  " })).toBe(true);
  });

  it.each(["name", "relationship", "approxDateText", "place", "note"] as const)("keeps a draft with text in %s", (field) => {
    expect(isShareDraftEmpty({ ...EMPTY_SHARE_DRAFT, [field]: " x " })).toBe(false);
  });
});
