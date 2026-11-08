import { describe, expect, it } from "vitest";

import { oldestFirst } from "@/lib/memories/explore";
import { nearby, photoPill, placeCount, prevNext, threadOrder } from "@/lib/memories/related";
import type { PublicMemory } from "@/lib/memories/types";

function memory(id: string, overrides: Partial<PublicMemory> = {}): PublicMemory {
  return {
    id, kind: "PHOTO", who: "A friend of Jo's", relationship: null, note: null,
    when: null, year: null, month: null, place: null, point: null, tags: [],
    durationSeconds: null, photos: [], poster: null, playable: "yes", createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const towson = { slug: "towson-md", label: "Towson, MD" };
const quilting = { slug: "quilting", name: "Quilting" };
const school = { slug: "school", name: "School" };

describe("threadOrder", () => {
  it("exports the shared oldest-first rule and leaves the original array unchanged", () => {
    const all = Object.freeze([memory("undated"), memory("new", { year: 2000 }), memory("old", { year: 1950 })]);
    expect(threadOrder).toBe(oldestFirst);
    expect(threadOrder(all).map((item) => item.id)).toEqual(["old", "new", "undated"]);
    expect(all.map((item) => item.id)).toEqual(["undated", "new", "old"]);
  });
});

describe("prevNext", () => {
  const ordered = Object.freeze([memory("first"), memory("middle"), memory("last")]);

  it("returns the index, total and adjacent memories at both ends and the middle", () => {
    expect(prevNext(ordered, "first")).toEqual({ index: 0, total: 3, prev: null, next: ordered[1] });
    expect(prevNext(ordered, "middle")).toEqual({ index: 1, total: 3, prev: ordered[0], next: ordered[2] });
    expect(prevNext(ordered, "last")).toEqual({ index: 2, total: 3, prev: ordered[1], next: null });
    expect(prevNext([ordered[0]], "first")).toEqual({ index: 0, total: 1, prev: null, next: null });
  });

  it("returns null when the id is absent or the thread is empty", () => {
    expect(prevNext(ordered, "absent")).toBeNull();
    expect(prevNext(Object.freeze([]), "absent")).toBeNull();
  });
});

describe("nearby", () => {
  const current = memory("current", { year: 1980, place: towson, tags: [quilting, school] });

  it("adds three for place, two for a year within five, and one for each shared slug", () => {
    const all = Object.freeze([
      memory("tag", { tags: [quilting] }),
      memory("year", { year: 1985 }),
      memory("place", { place: towson }),
      memory("year-tags", { year: 1975, tags: [quilting, school] }),
      memory("place-year", { year: 1984, place: towson }),
      memory("everything", { year: 1980, place: towson, tags: [quilting, school] }),
      memory("six-years-away", { year: 1986 }),
      memory("unrelated"),
      current,
      memory("current", { ...current }),
    ].map((item) => Object.freeze(item)));
    const original = structuredClone(all);
    expect(nearby(all, current, 20).map((item) => item.id)).toEqual(["everything", "place-year", "year-tags", "place", "year", "tag"]);
    expect(nearby(all, current).map((item) => item.id)).toEqual(["everything", "place-year", "year-tags"]);
    expect(nearby(all, current, 1).map((item) => item.id)).toEqual(["everything"]);
    expect(nearby(all, current, 0)).toEqual([]);
    expect(all).toEqual(original);
  });

  it("breaks equal scores by year distance, creation date descending, then id ascending, with unknown years last", () => {
    const all = Object.freeze([
      memory("unknown-a", { place: towson, createdAt: "2026-03-01T00:00:00.000Z" }),
      memory("unknown-b", { place: towson }),
      memory("far", { year: 1960, place: towson }),
      memory("b", { year: 1990, place: towson }),
      memory("a", { year: 1970, place: towson }),
      memory("created-later", { year: 1970, place: towson, createdAt: "2026-02-01T00:00:00.000Z" }),
    ]);
    expect(nearby(all, current, 10).map((item) => item.id)).toEqual(["created-later", "a", "b", "far", "unknown-a", "unknown-b"]);
  });

  it("requires non-null places and years and compares tag slugs rather than names", () => {
    const undated = memory("current", { tags: [quilting, quilting] });
    const all = [
      memory("no-signals"), memory("year-only", { year: 1980 }),
      memory("two-tags", { tags: [quilting, school] }),
      memory("duplicate", { tags: [{ slug: "quilting", name: "QUILTING" }, quilting] }),
      memory("same-name", { tags: [{ slug: "other", name: "Quilting" }] }),
    ];
    expect(nearby(all, undated, 10).map((item) => item.id)).toEqual(["duplicate", "two-tags"]);
    expect(nearby(Object.freeze([]), current)).toEqual([]);
  });

  it("compares tied candidates by their creation instant across ISO offsets before using ids", () => {
    const all = Object.freeze([
      memory("earlier", { place: towson, createdAt: "2026-01-01T01:00:00+02:00" }),
      memory("a", { place: towson, createdAt: "2026-01-01T00:00:00Z" }),
      memory("b", { place: towson, createdAt: "2026-01-01T00:00:00.000Z" }),
    ]);
    expect(nearby(all, current).map((item) => item.id)).toEqual(["a", "b", "earlier"]);
  });
});

describe("placeCount", () => {
  it("counts by place slug regardless of label and skips unplaced memories", () => {
    const all = Object.freeze([memory("one", { place: towson }), memory("two", { place: { slug: "towson-md", label: "Towson MD" } }), memory("unplaced")]);
    expect(placeCount(all, "towson-md")).toBe(2);
    expect(placeCount(all, "unknown")).toBe(0);
    expect(placeCount(Object.freeze([]), "towson-md")).toBe(0);
  });
});

describe("photoPill", () => {
  it("joins the contributor's date with only the town before the first comma", () => {
    expect(photoPill(memory("m", { when: "Summer 1998", place: { slug: "ocean-city-md", label: "Ocean City, MD" } }))).toBe("Summer 1998, Ocean City");
    expect(photoPill(memory("m", { when: "1980", place: { slug: "towson", label: "Towson, MD, USA" } }))).toBe("1980, Towson");
  });

  it("handles either missing part, labels without commas and a wholly missing pill", () => {
    expect(photoPill(memory("m", { when: "1980" }))).toBe("1980");
    expect(photoPill(memory("m", { place: towson }))).toBe("Towson");
    expect(photoPill(memory("m", { place: { slug: "baltimore", label: "Baltimore" } }))).toBe("Baltimore");
    expect(photoPill(memory("m"))).toBeNull();
    expect(photoPill(memory("m", { when: "" }))).toBeNull();
  });
});
