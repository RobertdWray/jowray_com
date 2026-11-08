import { describe, expect, it } from "vitest";

import {
  buildExplore, buildMap, buildQuilt, decadeRange, EXPLORE_PAGE_SIZE, FIRST_DECADE,
  LAST_DECADE, MAP_CARD_LIMIT, matchesSearch, newestFirst, oldestFirst, TAGS_PAGE_SIZE,
} from "@/lib/memories/explore";
import type { ExploreFilters, PublicMemory } from "@/lib/memories/types";

function memory(id: string, overrides: Partial<PublicMemory> = {}): PublicMemory {
  return {
    id, kind: "PHOTO", who: "A friend of Jo's", relationship: null, note: null,
    when: null, year: null, month: null, place: null, point: null, tags: [],
    durationSeconds: null, photos: [], poster: null, playable: "yes", createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const towson = { slug: "towson-md", label: "Towson, MD" };
const baltimore = { slug: "baltimore", label: "Baltimore" };
const quilting = { slug: "quilting", name: "Quilting" };
const school = { slug: "school", name: "School" };

describe("memory ordering", () => {
  it("sorts year, month, creation date and id in either direction, with undated memories last", () => {
    const memories = Object.freeze([
      memory("undated-a", { month: 12 }),
      memory("old", { year: 1950 }),
      memory("b", { year: 1985, month: 2 }),
      memory("a", { year: 1985, month: 2 }),
      memory("created-later", { year: 1985, month: 2, createdAt: "2026-02-01T00:00:00.000Z" }),
      memory("no-month", { year: 1985 }),
      memory("january", { year: 1985, month: 1 }),
      memory("new", { year: 2020 }),
      memory("undated-b", { month: 1 }),
      memory("undated-later", { createdAt: "2026-02-01T00:00:00.000Z" }),
    ].map((item) => Object.freeze(item)));
    const original = structuredClone(memories);
    expect(newestFirst(memories).map((item) => item.id)).toEqual([
      "new", "created-later", "b", "a", "january", "no-month", "old", "undated-later", "undated-b", "undated-a",
    ]);
    expect(oldestFirst(memories).map((item) => item.id)).toEqual([
      "old", "no-month", "january", "a", "b", "created-later", "new", "undated-a", "undated-b", "undated-later",
    ]);
    expect(newestFirst(memories)).not.toBe(memories);
    expect(oldestFirst(memories)).not.toBe(memories);
    expect(memories).toEqual(original);
  });

  it("returns new empty arrays for empty inputs", () => {
    expect(newestFirst(Object.freeze([]))).toEqual([]);
    expect(oldestFirst(Object.freeze([]))).toEqual([]);
  });

  it("compares creation instants across ISO offsets and uses ids when different strings mean the same instant", () => {
    const all = Object.freeze([
      memory("earlier", { createdAt: "2026-01-01T01:00:00+02:00" }),
      memory("a", { createdAt: "2026-01-01T00:00:00Z" }),
      memory("b", { createdAt: "2026-01-01T00:00:00.000Z" }),
    ]);
    expect(newestFirst(all).map((item) => item.id)).toEqual(["b", "a", "earlier"]);
    expect(oldestFirst(all).map((item) => item.id)).toEqual(["earlier", "a", "b"]);
  });
});

describe("matchesSearch", () => {
  const item = memory("m", {
    who: "Renée", relationship: "Cousin", note: "A Café trip", when: "Summer 1988",
    place: { slug: "zurich", label: "Zürich" }, tags: [{ slug: "sewing", name: "Sewing" }],
  });

  it.each([" renee ", "COUSIN", "cafe", "CAFÉ", "summer", "1988", "zurich", "sew", "", "  "])(
    "finds %j across all public text with case and accent folding", (query) => {
      expect(matchesSearch(item, query)).toBe(true);
    },
  );

  it("searches joined text but does not search ids, kinds or null placeholders", () => {
    expect(matchesSearch(item, "cousin a cafe")).toBe(true);
    expect(matchesSearch(memory("secret-id"), "secret-id")).toBe(false);
    expect(matchesSearch(memory("m"), "photo")).toBe(false);
    expect(matchesSearch(memory("m"), "null")).toBe(false);
    expect(matchesSearch(item, "unmatched")).toBe(false);
  });
});

describe("decadeRange", () => {
  it("keeps the baseline even without dated memories", () => {
    expect(FIRST_DECADE).toBe(1950);
    expect(LAST_DECADE).toBe(2020);
    expect(decadeRange([])).toEqual([1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]);
    expect(decadeRange([null, 1988])).toEqual([1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]);
  });

  it("extends below and above the baseline without changing the input", () => {
    const years = [2044, null, 1939, 1950];
    Object.freeze(years);
    expect(decadeRange(years)).toEqual([1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020, 2030, 2040]);
    expect(years).toEqual([2044, null, 1939, 1950]);
  });
});

describe("buildExplore", () => {
  const memories = Object.freeze([
    memory("match", { year: 1981, place: towson, tags: [quilting], note: "Café bus" }),
    memory("other-place", { year: 1982, place: baltimore, tags: [quilting], note: "bus" }),
    memory("other-decade", { year: 1991, place: towson, tags: [quilting], note: "bus" }),
    memory("undated", { place: towson, tags: [quilting], note: "bus" }),
    memory("other-tag", { year: 1983, place: towson, tags: [school], note: "bus" }),
    memory("other-kind", { year: 1984, place: towson, tags: [quilting], kind: "VOICE", note: "bus" }),
    memory("other-search", { year: 1985, place: towson, tags: [quilting], note: "train" }),
    memory("different-everything", { year: 1942, place: baltimore, tags: [school], kind: "TEXT", note: "bus" }),
    memory("no-place", { year: 2031, kind: "VIDEO" }),
  ].map((item) => Object.freeze(item)));
  const filters: ExploreFilters = { place: "towson-md", decade: 1980, tag: "quilting", kind: "PHOTO", q: "bus", n: 12 };

  it("honors all filters while computing collection-wide statistics", () => {
    const model = buildExplore(memories, Object.freeze(filters));
    expect(model.list.map((item) => item.id)).toEqual(["match"]);
    expect(model.stats).toEqual({ total: 9, places: 2, first: 1942, last: 2031, decades: 4 });
    expect(model.total).toBe(1);
    expect(model.hasFilters).toBe(true);
    expect(model.summary).toBe("1 photo about quilting from Towson, MD in the 1980s mentioning “bus”");
    expect(model.selectedPlace).toBe(model.places.find((place) => place.slug === "towson-md"));
    expect(model.selectedTag).toBe(model.tags.find((tag) => tag.slug === "quilting"));
  });

  it("counts each facet without its own filter while keeping all other filters and search", () => {
    const model = buildExplore(memories, filters);
    expect(model.places.map(({ slug, count, selected }) => ({ slug, count, selected }))).toEqual([
      { slug: "baltimore", count: 1, selected: false }, { slug: "towson-md", count: 1, selected: true },
    ]);
    expect(model.decades.filter((decade) => decade.count > 0)).toEqual([
      { decade: 1980, count: 1, selected: true }, { decade: 1990, count: 1, selected: false },
    ]);
    expect(model.decades.map((decade) => decade.decade)).toEqual([1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020, 2030]);
    expect(model.undatedCount).toBe(1);
    expect(model.tags).toEqual([
      { ...quilting, count: 1, selected: true }, { ...school, count: 1, selected: false },
    ]);
    expect(model.kinds).toEqual([
      { kind: "PHOTO", label: "Photos", count: 1, selected: true },
      { kind: "VOICE", label: "Voices", count: 1, selected: false },
      { kind: "VIDEO", label: "Videos", count: 0, selected: false },
      { kind: "TEXT", label: "Written", count: 0, selected: false },
    ]);
  });

  it("keeps unknown selected places and tags at zero with their slug as the label", () => {
    const model = buildExplore(memories, { place: "unknown-place", tag: "unknown-tag", n: 12 });
    expect(model.selectedPlace).toEqual({ slug: "unknown-place", label: "unknown-place", count: 0, firstYear: null, lastYear: null, point: null, selected: true });
    expect(model.selectedTag).toEqual({ slug: "unknown-tag", name: "unknown-tag", count: 0, selected: true });
    expect(model.topTags).toEqual([model.selectedTag]);
    expect(model.summary).toBe("0 memories about unknown-tag from unknown-place");
  });

  it("retains known labels when the selected facets have zero matches", () => {
    const model = buildExplore(memories, { ...filters, q: "not found" });
    expect(model.selectedPlace).toMatchObject({ label: "Towson, MD", count: 0 });
    expect(model.selectedTag).toMatchObject({ name: "Quilting", count: 0 });
    expect(model.undatedCount).toBe(0);
    expect(model.decades.every((decade) => decade.count === 0)).toBe(true);
  });

  it("ranks tags by count then English name, retaining the first spelling and counting a slug once per memory", () => {
    const model = buildExplore([
      memory("first", { tags: [{ name: "Élan", slug: "elan" }, school], note: "train" }),
      memory("second", { tags: [{ name: "ELAN", slug: "elan" }, { name: "duplicate", slug: "elan" }, school, quilting], note: "bus" }),
      memory("third", { tags: [quilting], note: "bus" }),
    ], { n: 12, q: "bus" });
    expect(model.tags).toEqual([
      { ...quilting, count: 2, selected: false },
      { name: "Élan", slug: "elan", count: 1, selected: false },
      { ...school, count: 1, selected: false },
    ]);
  });

  it("keeps twelve top tags and appends a selected tag outside them without duplicating one inside", () => {
    const tags = Array.from({ length: 14 }, (_, index) => ({ name: `Tag ${String(index).padStart(2, "0")}`, slug: `tag-${index}` }));
    const all = [memory("m", { tags })];
    expect(buildExplore(all, { n: 12 }).topTags).toHaveLength(12);
    expect(buildExplore(all, { tag: "tag-0", n: 12 }).topTags).toHaveLength(12);
    const model = buildExplore(all, { tag: "tag-13", n: 12 });
    expect(model.tags).toHaveLength(14);
    expect(model.topTags.map((tag) => tag.slug)).toEqual(["tag-0", "tag-1", "tag-2", "tag-3", "tag-4", "tag-5", "tag-6", "tag-7", "tag-8", "tag-9", "tag-10", "tag-11", "tag-13"]);
  });

  it.each([
    [{ n: 12 }, "1 memory, newest first"],
    [{ n: 12, place: "towson-md" }, "1 memory from Towson, MD"],
    [{ n: 12, decade: 1980 }, "1 memory in the 1980s"],
    [{ n: 12, tag: "quilting" }, "1 memory about quilting"],
    [{ n: 12, q: "Café" }, "1 memory mentioning “Café”"],
  ] satisfies Array<[ExploreFilters, string]>)("writes the singular summary for %j", (query, expected) => {
    expect(buildExplore([memories[0]], query).summary).toBe(expected);
  });

  it.each([
    ["PHOTO", "photo", "photos"], ["VOICE", "voice", "voices"],
    ["VIDEO", "video", "videos"], ["TEXT", "written memory", "written memories"],
  ] as const)("uses the %s kind's singular and plural in summaries", (kind, singular, plural) => {
    const item = memory("m", { kind });
    expect(buildExplore([item], { kind, n: 12 }).summary).toBe(`1 ${singular}`);
    expect(buildExplore([item, memory("m2", { kind })], { kind, n: 12 }).summary).toBe(`2 ${plural}`);
    expect(buildExplore([], { kind, n: 12 }).summary).toBe(`0 ${plural}`);
  });

  it("writes every summary clause in order with curly quotes", () => {
    const all = Array.from({ length: 12 }, (_, index) => memory(String(index), { year: 1988, place: towson, tags: [quilting], note: "bus" }));
    expect(buildExplore(all, filters).summary).toBe("12 photos about quilting from Towson, MD in the 1980s mentioning “bus”");
  });

  it("normalizes a blank search and excludes n from hasFilters", () => {
    const model = buildExplore(memories, { n: 1, q: "   " });
    expect(model.hasFilters).toBe(false);
    expect(model.summary).toBe("9 memories, newest first");
    expect(model.selectedPlace).toBeNull();
    expect(model.selectedTag).toBeNull();
    expect(buildExplore(memories, { n: 12, q: " CAFE " }).summary).toBe("1 memory mentioning “CAFE”");
  });

  it.each([[0, 12, 12, 24], [-5, 12, 12, 24], [1, 1, 12, 13], [12, 12, 12, 24], [24, 24, 1, 36], [25, 25, 0, null], [100, 25, 0, null]])(
    "clamps n=%s and offers only the remaining cards", (n, shown, more, next) => {
      const all = Object.freeze(Array.from({ length: 25 }, (_, index) => memory(String(index), { year: 1980 + index })));
      const model = buildExplore(all, { n });
      expect(EXPLORE_PAGE_SIZE).toBe(12);
      expect(model.total).toBe(25);
      expect(model.shown).toEqual(model.list.slice(0, shown));
      expect(model.shown[0].id).toBe("24");
      expect(model.moreCount).toBe(more);
      expect(model.nextN).toBe(next);
    },
  );

  it("returns useful empty results without changing frozen inputs", () => {
    const original = structuredClone(memories);
    buildExplore(memories, filters);
    expect(memories).toEqual(original);
    const empty = buildExplore(Object.freeze([]), { n: 12 });
    expect(empty.stats).toEqual({ total: 0, places: 0, first: null, last: null, decades: 0 });
    expect(empty).toMatchObject({ places: [], tags: [], topTags: [], list: [], total: 0, shown: [], moreCount: 0, nextN: null, summary: "0 memories, newest first", hasFilters: false, undatedCount: 0 });
    expect(buildExplore([memory("undated")], { n: 12 }).stats).toEqual({ total: 1, places: 0, first: null, last: null, decades: 0 });
  });
});

describe("buildMap", () => {
  it("defaults to the largest group, sorts its cards oldest first and caps at six", () => {
    const all = Object.freeze([
      ...Array.from({ length: 8 }, (_, index) => memory(String(index), { year: 2000 - index, place: towson })),
      memory("other", { place: baltimore }), memory("unplaced"),
    ]);
    const model = buildMap(all);
    expect(MAP_CARD_LIMIT).toBe(6);
    expect(model.places.map((place) => place.slug)).toEqual(["towson-md", "baltimore"]);
    expect(model.selected).toBe(model.places[0]);
    expect(model.selectedMemories.map((item) => item.id)).toEqual(["7", "6", "5", "4", "3", "2"]);
    expect(model).toMatchObject({ total: 10, placeCount: 2, unplacedCount: 1 });
    expect(buildMap(all, "baltimore").selectedMemories.map((item) => item.id)).toEqual(["other"]);
    expect(buildMap(all, "unknown").selected?.slug).toBe("towson-md");
  });

  it("breaks equal place counts by label and preserves input objects", () => {
    const all = Object.freeze([Object.freeze(memory("t", { place: towson })), Object.freeze(memory("b", { place: baltimore }))]);
    const original = structuredClone(all);
    expect(buildMap(all).selected?.slug).toBe("baltimore");
    expect(all).toEqual(original);
  });

  it("has no selection or cards when no memories are placed", () => {
    expect(buildMap(Object.freeze([]))).toEqual({ places: [], selected: null, selectedMemories: [], unplacedCount: 0, total: 0, placeCount: 0 });
    expect(buildMap([memory("unplaced")], "unknown")).toEqual({ places: [], selected: null, selectedMemories: [], unplacedCount: 1, total: 1, placeCount: 0 });
  });
});

describe("buildQuilt", () => {
  it("ranks patches and cycles sizes, tilts and edges with the default patch selected", () => {
    const tags = ["Alfa", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"].map((name) => ({ name, slug: name.toLowerCase() }));
    const model = buildQuilt([memory("all", { tags }), memory("first-again", { tags: [tags[0]] })]);
    expect(model.patches.map(({ name, count, fontPx, tilt, edge, selected }) => ({ name, count, fontPx, tilt, edge, selected }))).toEqual([
      { name: "Alfa", count: 2, fontPx: 46, tilt: "-2deg", edge: "periwinkle", selected: true },
      { name: "Bravo", count: 1, fontPx: 35, tilt: "1.5deg", edge: "goldenrod", selected: false },
      { name: "Charlie", count: 1, fontPx: 35, tilt: "-1deg", edge: "lake-green", selected: false },
      { name: "Delta", count: 1, fontPx: 35, tilt: "2deg", edge: "sunhat-pink", selected: false },
      { name: "Echo", count: 1, fontPx: 35, tilt: "-1.5deg", edge: "plum", selected: false },
      { name: "Foxtrot", count: 1, fontPx: 35, tilt: "1deg", edge: "wood", selected: false },
      { name: "Golf", count: 1, fontPx: 35, tilt: "0deg", edge: "periwinkle", selected: false },
      { name: "Hotel", count: 1, fontPx: 35, tilt: "-2deg", edge: "goldenrod", selected: false },
    ]);
    expect(model.selected).toBe(model.patches[0]);
    expect(model.eyebrow).toBe("2 memories carry this patch");
  });

  it("selects a requested patch or falls back to the first, using singular wording for one memory", () => {
    const all = [memory("q", { tags: [quilting] }), memory("s", { tags: [school] })];
    const model = buildQuilt(all, "school");
    expect(model.selected).toEqual({ ...school, count: 1, fontPx: 46, tilt: "1.5deg", edge: "goldenrod", selected: true });
    expect(model.list.map((item) => item.id)).toEqual(["s"]);
    expect(model.patches[0].selected).toBe(false);
    expect(model.eyebrow).toBe("1 memory carries this patch");
    expect(buildQuilt(all, "unknown").selected?.slug).toBe("quilting");
  });

  it("counts other tags only on selected memories, keeps first spellings and returns the best four neighbors", () => {
    const extras = ["Zulu", "Élan", "Bravo", "Alfa", "Cedar"].map((name) => ({ name, slug: name.toLowerCase() }));
    const all = Object.freeze([
      memory("old", { year: 1980, tags: [quilting, ...extras] }),
      memory("new", { year: 2000, tags: [quilting, extras[0], { name: "ZULU", slug: "zulu" }, school] }),
      memory("unrelated", { tags: [school] }),
    ]);
    const original = structuredClone(all);
    const model = buildQuilt(all, "quilting");
    expect(model.neighbors).toEqual([
      { name: "Zulu", slug: "zulu", count: 2 },
      { name: "Alfa", slug: "alfa", count: 1 },
      { name: "Bravo", slug: "bravo", count: 1 },
      { name: "Cedar", slug: "cedar", count: 1 },
    ]);
    expect(model.list.map((item) => item.id)).toEqual(["new", "old"]);
    expect(all).toEqual(original);
  });

  it.each([[undefined, 9, 9, 18], [0, 9, 9, 18], [-2, 9, 9, 18], [1, 1, 9, 10], [18, 18, 1, 27], [19, 19, 0, null], [100, 19, 0, null]])(
    "paginates n=%s in nine-card increments", (n, shown, more, next) => {
      const all = Object.freeze(Array.from({ length: 19 }, (_, index) => memory(String(index), { year: 1980 + index, tags: [quilting] })));
      const model = buildQuilt(all, "quilting", n);
      expect(TAGS_PAGE_SIZE).toBe(9);
      expect(model.total).toBe(19);
      expect(model.shown).toEqual(model.list.slice(0, shown));
      expect(model.shown[0].id).toBe("18");
      expect(model.moreCount).toBe(more);
      expect(model.nextN).toBe(next);
    },
  );

  it("returns no selection or eyebrow when no memory has a tag", () => {
    const expected = { patches: [], selected: null, neighbors: [], list: [], total: 0, shown: [], moreCount: 0, nextN: null, eyebrow: null };
    expect(buildQuilt(Object.freeze([]))).toEqual(expected);
    expect(buildQuilt([memory("untagged")], "unknown")).toEqual(expected);
  });
});
