import { describe, expect, it } from "vitest";

import {
  EMPTY_SHARE_DRAFT,
  isShareDraftEmpty,
  parseShareDraft,
  readShareDraft,
  serializeShareDraft,
  SHARE_DRAFT_KEY,
  SHARE_DRAFT_TTL_MS,
  SHARE_DRAFT_V1_KEY,
  type ShareDraft,
} from "@/lib/share-draft";

const NOW = 1_800_000_000_000;
const draft: ShareDraft = {
  contributor: { name: "Jo Friend", relationship: "neighbour" },
  cards: [
    { approxDateText: "Summer 1998", place: "The garden", note: "  We laughed a lot.\nThen we had tea.  " },
    { approxDateText: "", place: "", note: "Second one." },
  ],
};
function fakeStore(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return { getItem: (k: string) => map.get(k) ?? null, removeItem: (k: string) => { map.delete(k); }, setItem: (k: string, v: string) => { map.set(k, v); }, map };
}

describe("share draft v2 storage", () => {
  it("stores the contributor's name and relationship and every card's three fields, never the email, under the v2 key", () => {
    expect(SHARE_DRAFT_KEY).toBe("jowray.share.draft.v2");
    const raw = serializeShareDraft(draft, NOW);
    expect(JSON.parse(raw)).toEqual({ v: 2, savedAt: NOW, contributor: draft.contributor, cards: draft.cards });
    expect(raw).not.toContain("email");
    expect(parseShareDraft(raw, NOW)).toEqual(draft);
  });

  it("expires a draft older than 30 days and keeps one exactly at the boundary (localStorage never expires on its own)", () => {
    expect(parseShareDraft(serializeShareDraft(draft, NOW - SHARE_DRAFT_TTL_MS - 1), NOW)).toBeNull();
    expect(parseShareDraft(serializeShareDraft(draft, NOW - SHARE_DRAFT_TTL_MS), NOW)).toEqual(draft);
  });

  it.each([null, "", "{", "null", JSON.stringify({ v: 1, savedAt: NOW, fields: {} }), JSON.stringify({ v: 2, savedAt: "x", contributor: {}, cards: [] })])(
    "returns null for absent, malformed or wrong-shaped storage: %s",
    (raw) => {
      expect(parseShareDraft(raw, NOW)).toBeNull();
    }
  );

  it("caps fields at their form limits, cards at ten, and drops unknown keys", () => {
    const oversized: ShareDraft = {
      contributor: { name: "a".repeat(121), relationship: "b".repeat(121) },
      cards: Array.from({ length: 12 }, () => ({ approxDateText: "c".repeat(121), place: "d".repeat(201), note: "e".repeat(10_001) })),
    };
    const parsed = parseShareDraft(serializeShareDraft(oversized, NOW), NOW)!;
    expect(parsed.contributor).toEqual({ name: "a".repeat(120), relationship: "b".repeat(120) });
    expect(parsed.cards).toHaveLength(10);
    expect(parsed.cards[0]).toEqual({ approxDateText: "c".repeat(120), place: "d".repeat(200), note: "e".repeat(10_000) });
    const withExtra = JSON.stringify({ v: 2, savedAt: NOW, contributor: { ...draft.contributor, email: "x@example.com" }, cards: [{ ...draft.cards[0], secret: 1 }] });
    expect(parseShareDraft(withExtra, NOW)).toEqual({ contributor: draft.contributor, cards: [draft.cards[0]] });
  });

  it("migrates a v1 draft into the contributor fields and card 1, and removes the old key", () => {
    const v1 = JSON.stringify({ v: 1, savedAt: NOW, fields: { name: "Jo", relationship: "friend", approxDateText: "1985", place: "", note: "words" } });
    const store = fakeStore({ [SHARE_DRAFT_V1_KEY]: v1 });
    expect(readShareDraft(store, NOW)).toEqual({ contributor: { name: "Jo", relationship: "friend" }, cards: [{ approxDateText: "1985", place: "", note: "words" }] });
    expect(store.map.has(SHARE_DRAFT_V1_KEY)).toBe(false);
  });

  it("prefers a v2 draft over a leftover v1 one, and ignores an expired v1 draft", () => {
    const v1 = JSON.stringify({ v: 1, savedAt: NOW, fields: { name: "Old", relationship: "", approxDateText: "", place: "", note: "old" } });
    expect(readShareDraft(fakeStore({ [SHARE_DRAFT_V1_KEY]: v1, [SHARE_DRAFT_KEY]: serializeShareDraft(draft, NOW) }), NOW)).toEqual(draft);
    const stale = JSON.stringify({ v: 1, savedAt: NOW - SHARE_DRAFT_TTL_MS - 1, fields: { name: "Old", relationship: "", approxDateText: "", place: "", note: "old" } });
    expect(readShareDraft(fakeStore({ [SHARE_DRAFT_V1_KEY]: stale }), NOW)).toBeNull();
  });

  it("treats a draft with nothing but whitespace as empty", () => {
    expect(isShareDraftEmpty(EMPTY_SHARE_DRAFT)).toBe(true);
    expect(isShareDraftEmpty({ contributor: { name: " ", relationship: "" }, cards: [{ approxDateText: "", place: " ", note: "\n" }] })).toBe(true);
    expect(isShareDraftEmpty({ contributor: { name: "", relationship: "" }, cards: [{ approxDateText: "", place: "", note: "x" }] })).toBe(false);
    expect(isShareDraftEmpty({ contributor: { name: "Jo", relationship: "" }, cards: [] })).toBe(false);
  });
});
