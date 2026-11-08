import { describe, expect, it } from "vitest";

import { buildTimeline, ERA_LINE, ERAS } from "@/lib/memories/timeline";
import type { PublicMemory } from "@/lib/memories/types";

function memory(id: string, overrides: Partial<PublicMemory> = {}): PublicMemory {
  return {
    id, kind: "PHOTO", who: "A friend of Jo's", relationship: null, note: null,
    when: null, year: null, month: null, place: null, point: null, tags: [],
    durationSeconds: null, photos: [], poster: null, playable: "yes", createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("timeline era wording", () => {
  it("keeps the approved decade descriptions verbatim", () => {
    expect(ERAS).toEqual({
      1950: "Growing up on Army posts",
      1960: "Last Army years, then Towson",
      1970: "A Christmas Eve wedding, and a classroom",
      1980: "The teaching years",
      1990: "The teaching years",
      2000: "The teaching years, then retirement",
      2010: "Quilts, bargains and Santa",
      2020: "Grandma Jo",
    });
  });

  it("uses en dashes and the approved copy in the Explore era line", () => {
    expect(ERA_LINE).toEqual([
      { range: "1949–66", text: "Growing up on Army posts" },
      { range: "1967–71", text: "Towson, and a tall guy named Richard" },
      { range: "1971–2008", text: "The teaching years" },
      { range: "2009–17", text: "Quilts, bargains and Santa" },
      { range: "2018–", text: "Grandma Jo" },
    ]);
  });
});

describe("buildTimeline", () => {
  it("builds the title from every dated memory regardless of kind", () => {
    const all = [memory("early", { year: 1949 }), memory("late", { year: 2026, kind: "VOICE" }), memory("unknown")];
    expect(buildTimeline(all).title).toBe("77 years of Jo stories, 1949 to 2026");
    expect(buildTimeline(all, "VOICE").title).toBe("77 years of Jo stories, 1949 to 2026");
    expect(buildTimeline(all, "TEXT").title).toBe("77 years of Jo stories, 1949 to 2026");
    expect(buildTimeline([memory("one", { year: 1985 }), memory("two", { year: 1985 })]).title).toBe("Jo stories from 1985");
    expect(buildTimeline([memory("unknown")]).title).toBeNull();
  });

  it("extends every decade from all data, counts only the selected kind, and assigns accessible ids", () => {
    const all = Object.freeze([
      memory("early", { year: 1938 }),
      memory("voice", { year: 1980, kind: "VOICE" }),
      memory("later-voice", { year: 1989, kind: "VOICE" }),
      memory("photo", { year: 1982 }),
      memory("future", { year: 2044 }),
    ]);
    const model = buildTimeline(all, "VOICE");
    expect(model.kind).toBe("VOICE");
    expect(model.decades.map((decade) => decade.decade)).toEqual([1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020, 2030, 2040]);
    expect(model.decades[0]).toEqual({ decade: 1930, id: "d1930", headingId: "h1930", bodyId: "b1930", era: null, count: 0, countText: "nothing yet", years: [] });
    expect(model.decades.find((decade) => decade.decade === 1980)).toMatchObject({ id: "d1980", headingId: "h1980", bodyId: "b1980", era: "The teaching years", count: 2, countText: "2 memories" });
    expect(model.jumps.map(({ decade, id, count, label, shortLabel }) => [decade, id, count, label, shortLabel])).toEqual([
      [1930, "d1930", 0, "1930s", "’30"], [1940, "d1940", 0, "1940s", "’40"],
      [1950, "d1950", 0, "1950s", "’50"], [1960, "d1960", 0, "1960s", "’60"],
      [1970, "d1970", 0, "1970s", "’70"], [1980, "d1980", 2, "1980s", "’80"],
      [1990, "d1990", 0, "1990s", "’90"], [2000, "d2000", 0, "2000s", "’00"],
      [2010, "d2010", 0, "2010s", "’10"], [2020, "d2020", 0, "2020s", "’20"],
      [2030, "d2030", 0, "2030s", "’30"], [2040, "d2040", 0, "2040s", "’40"],
    ]);
    expect(model.maxCount).toBe(2);
    expect(model.openDecade).toBe(1980);
  });

  it("orders years and each year's memories oldest first, including month and tie-breakers", () => {
    const all = Object.freeze([
      memory("next-year", { year: 1989 }),
      memory("b", { year: 1980, month: 2 }),
      memory("a", { year: 1980, month: 2 }),
      memory("later-created", { year: 1980, month: 2, createdAt: "2026-02-01T00:00:00.000Z" }),
      memory("january", { year: 1980, month: 1 }),
      memory("no-month", { year: 1980 }),
    ].map((item) => Object.freeze(item)));
    const original = structuredClone(all);
    const model = buildTimeline(all);
    expect(model.kind).toBeNull();
    expect(model.decades.find((decade) => decade.decade === 1980)?.years.map(({ year, countText, memories }) => ({ year, countText, ids: memories.map((item) => item.id) }))).toEqual([
      { year: 1980, countText: "5 memories", ids: ["no-month", "january", "a", "b", "later-created"] },
      { year: 1989, countText: "1 memory", ids: ["next-year"] },
    ]);
    expect(all).toEqual(original);
  });

  it("groups undated memories after kind filtering in oldest-first order", () => {
    const all = Object.freeze([
      memory("z", { kind: "VOICE" }), memory("a", { kind: "VOICE" }),
      memory("later", { kind: "VOICE", createdAt: "2026-02-01T00:00:00.000Z" }),
      memory("photo"), memory("dated", { kind: "VOICE", year: 1985 }),
    ]);
    const model = buildTimeline(all, "VOICE");
    expect(model.undated).toMatchObject({ id: "undated", count: 3, countText: "3 memories" });
    expect(model.undated?.memories.map((item) => item.id)).toEqual(["a", "z", "later"]);
    expect(buildTimeline(all, "PHOTO").undated?.countText).toBe("1 memory");
    expect(buildTimeline(all, "TEXT").undated).toBeNull();
  });

  it("opens the fullest decade, choosing the earliest on a tie after filtering", () => {
    const all = [
      memory("later", { year: 1990 }), memory("earlier", { year: 1975 }),
      memory("voice-one", { year: 1980, kind: "VOICE" }), memory("voice-two", { year: 1981, kind: "VOICE" }),
    ];
    expect(buildTimeline(all).openDecade).toBe(1980);
    expect(buildTimeline(all, "PHOTO").openDecade).toBe(1970);
    expect(buildTimeline(all, "TEXT").openDecade).toBeNull();
    expect(buildTimeline(all, "PHOTO").decades.find((decade) => decade.decade === 1970)?.countText).toBe("1 memory");
  });

  it("keeps empty baseline decades with no open decade or dated title", () => {
    const model = buildTimeline(Object.freeze([]));
    expect(model).toMatchObject({ title: null, kind: null, undated: null, maxCount: 0, openDecade: null });
    expect(model.decades.map((decade) => decade.decade)).toEqual([1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]);
    expect(model.decades.every((decade) => decade.count === 0 && decade.countText === "nothing yet" && decade.years.length === 0)).toBe(true);
    expect(model.jumps.every((jump) => jump.count === 0)).toBe(true);
    expect(buildTimeline([memory("undated")]).openDecade).toBeNull();
  });
});
