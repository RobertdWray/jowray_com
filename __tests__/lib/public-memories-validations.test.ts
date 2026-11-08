import { describe, expect, it } from "vitest";

import { PUBLIC_KINDS } from "@/lib/memories/types";
import {
  DEFAULT_EXPLORE_N,
  DEFAULT_TAGS_N,
  countSchema,
  decadeSchema,
  firstParam,
  kindSchema,
  parseExploreQuery,
  parseMapQuery,
  parseMemoryId,
  parseTagsQuery,
  parseTimelineQuery,
  searchSchema,
  slugSchema,
} from "@/lib/validations/public-memories";
import type { SearchParams } from "@/lib/validations/public-memories";

describe("firstParam", () => {
  it("keeps a string or the first array value without changing the array", () => {
    const values = ["quilting", "gardening"];
    Object.freeze(values);
    expect(firstParam("quilting")).toBe("quilting");
    expect(firstParam(values)).toBe("quilting");
    expect(values).toEqual(["quilting", "gardening"]);
  });

  it("returns undefined for a missing value or an empty array", () => {
    expect(firstParam(undefined)).toBeUndefined();
    expect(firstParam([])).toBeUndefined();
    expect(firstParam(["", "quilting"])).toBe("");
  });
});

describe("public filter schemas", () => {
  it.each(["a", "123", "towson-md", "a-1-b", "a".repeat(80)])(
    "accepts the slug %j",
    (slug) => {
      expect(slugSchema.parse(slug)).toBe(slug);
    },
  );

  it.each([
    "", "Towson", "towson--md", "-towson", "towson-", "a".repeat(81),
    "towson md", "towson_md", "café", "towson&md", "jo's", " quilting ",
  ])("refuses the invalid slug %j", (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(false);
  });

  it.each(["1900", "1980", "2090"])("coerces the valid decade %s", (decade) => {
    expect(decadeSchema.parse(decade)).toBe(Number(decade));
  });

  it.each(["1985", "1890", "2100", "19x0", "1980.5", "", "Infinity"])(
    "refuses the invalid decade %j",
    (decade) => {
      expect(decadeSchema.safeParse(decade).success).toBe(false);
    },
  );

  it("accepts only the four public kinds with their exact spelling", () => {
    for (const kind of PUBLIC_KINDS) {
      expect(kindSchema.parse(kind)).toBe(kind);
    }
    for (const kind of ["photo", "AUDIO", " PHOTO ", ""]) {
      expect(kindSchema.safeParse(kind).success).toBe(false);
    }
  });

  it("trims search text before enforcing its length and preserves its contents", () => {
    expect(searchSchema.parse(" \tJo’s “café” & quilt\n ")).toBe("Jo’s “café” & quilt");
    expect(searchSchema.parse(`  ${"a".repeat(100)}  `)).toBe("a".repeat(100));
    expect(searchSchema.safeParse("a".repeat(101)).success).toBe(false);
    expect(searchSchema.parse(" \t\n ")).toBeUndefined();
    expect(searchSchema.parse("")).toBeUndefined();
  });

  it.each([
    ["1", 1],
    ["24", 24],
    ["1e3", 1000],
    ["9007199254740991", Number.MAX_SAFE_INTEGER],
  ])("accepts the safe count %s without a page-size cap", (value, expected) => {
    expect(countSchema.parse(value)).toBe(expected);
  });

  it.each([
    "0", "-3", "1.5", "99999999999999999999", "9007199254740992",
    "abc", "NaN", "Infinity", "", " ",
  ])("refuses the invalid count %j", (value) => {
    expect(countSchema.safeParse(value).success).toBe(false);
    expect(parseExploreQuery({ tag: "quilting", n: value })).toStrictEqual({ tag: "quilting", n: 12 });
    expect(parseTagsQuery({ tag: "quilting", n: value })).toStrictEqual({ tag: "quilting", n: 9 });
  });
});

describe("parseExploreQuery", () => {
  const valid: SearchParams = {
    place: "towson-md", decade: "1980", tag: "quilting", kind: "PHOTO", q: "bus", n: "24",
  };
  const expected = {
    place: "towson-md", decade: 1980, tag: "quilting", kind: "PHOTO", q: "bus", n: 24,
  };

  it("defaults the count and omits missing filters and unknown keys", () => {
    expect(DEFAULT_EXPLORE_N).toBe(12);
    expect(parseExploreQuery({})).toStrictEqual({ n: 12 });
    expect(parseExploreQuery({ place: undefined, extra: "ignored" })).toStrictEqual({ n: 12 });
    expect(parseExploreQuery({ place: [], decade: [], tag: [], kind: [], q: [], n: [] })).toStrictEqual({ n: 12 });
  });

  it("reads the first value of every key and leaves the input untouched", () => {
    const params: SearchParams = {
      place: ["towson-md", "bad place"], decade: ["1980", "bad decade"],
      tag: ["quilting", "bad tag"], kind: ["PHOTO", "bad kind"],
      q: [" bus ", "later search"], n: ["24", "abc"],
    };
    const before = structuredClone(params);
    Object.values(params).forEach((value) => {
      if (Array.isArray(value)) {
        Object.freeze(value);
      }
    });
    Object.freeze(params);
    expect(parseExploreQuery(params)).toStrictEqual(expected);
    expect(params).toStrictEqual(before);
  });

  it("drops invalid place and count values without losing a valid tag", () => {
    expect(parseExploreQuery({ place: "Towson MD", tag: "quilting", n: "abc" }))
      .toStrictEqual({ tag: "quilting", n: 12 });
  });

  it.each([
    ["place", "Towson MD"], ["decade", "1985"], ["tag", "-quilting"],
    ["kind", "photo"], ["q", "a".repeat(101)],
  ])("drops invalid %s independently while keeping every other filter", (key, value) => {
    const remaining = Object.fromEntries(Object.entries(expected).filter(([name]) => name !== key));
    expect(parseExploreQuery({ ...valid, [key]: value })).toStrictEqual(remaining);
    expect(parseExploreQuery({ ...valid, [key]: [value, valid[key] as string] })).toStrictEqual(remaining);
  });

  it("keeps every filter when only the count is invalid", () => {
    expect(parseExploreQuery({ ...valid, n: ["abc", "24"] })).toStrictEqual({ ...expected, n: 12 });
  });

  it("omits an empty search without dropping the remaining filters", () => {
    expect(parseExploreQuery({ tag: "quilting", q: [" \t ", "bus"], n: "24" }))
      .toStrictEqual({ tag: "quilting", n: 24 });
  });

  it("uses defaults when every supplied filter is invalid", () => {
    expect(parseExploreQuery({
      place: "../admin", decade: "19x0", tag: "<script>", kind: "UNKNOWN", q: "x".repeat(101), n: "-3",
    })).toStrictEqual({ n: 12 });
  });
});

describe("the map, timeline and tags query parsers", () => {
  it("reads only the map's first valid place and drops an invalid first value", () => {
    expect(parseMapQuery({ place: ["towson-md", "baltimore-md"], kind: "PHOTO" }))
      .toStrictEqual({ place: "towson-md" });
    expect(parseMapQuery({ place: ["Towson MD", "towson-md"] })).toStrictEqual({});
    expect(parseMapQuery({ place: [] })).toStrictEqual({});
    expect(parseMapQuery({})).toStrictEqual({});
  });

  it("reads only the timeline's first kind because the decade belongs in a fragment", () => {
    expect(parseTimelineQuery({ kind: ["VOICE", "PHOTO"], decade: "1980" }))
      .toStrictEqual({ kind: "VOICE" });
    expect(parseTimelineQuery({ kind: ["voice", "VOICE"] })).toStrictEqual({});
    expect(parseTimelineQuery({ kind: [] })).toStrictEqual({});
    expect(parseTimelineQuery({})).toStrictEqual({});
  });

  it("reads each tag filter independently and defaults to nine items", () => {
    expect(DEFAULT_TAGS_N).toBe(9);
    expect(parseTagsQuery({})).toStrictEqual({ n: 9 });
    expect(parseTagsQuery({ tag: [], n: [] })).toStrictEqual({ n: 9 });
    expect(parseTagsQuery({ tag: ["quilting", "gardening"], n: ["18", "abc"], kind: "PHOTO" }))
      .toStrictEqual({ tag: "quilting", n: 18 });
    expect(parseTagsQuery({ tag: ["bad tag", "quilting"], n: "18" })).toStrictEqual({ n: 18 });
    expect(parseTagsQuery({ tag: "quilting", n: ["abc", "18"] })).toStrictEqual({ tag: "quilting", n: 9 });
    expect(parseTagsQuery({ tag: "quilting", n: "1e3" })).toStrictEqual({ tag: "quilting", n: 1000 });
  });
});

describe("parseMemoryId", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("accepts a version %s UUID and lower-cases it", (version) => {
    const id = `550E8400-E29B-${version}1D4-A716-446655440000`;
    expect(parseMemoryId(id)).toBe(id.toLowerCase());
    expect(parseMemoryId(id.toLowerCase())).toBe(id.toLowerCase());
  });

  it("accepts the special nil and max UUIDs regardless of case", () => {
    expect(parseMemoryId("00000000-0000-0000-0000-000000000000"))
      .toBe("00000000-0000-0000-0000-000000000000");
    expect(parseMemoryId("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF"))
      .toBe("ffffffff-ffff-ffff-ffff-ffffffffffff");
  });

  it.each([
    "", "not-a-uuid", "550e8400e29b41d4a716446655440000",
    "550e8400-e29b-41d4-a716-44665544000g", "550e8400-e29b-91d4-a716-446655440000",
    "550e8400-e29b-41d4-0716-446655440000", "550e8400-e29b-41d4-a716-446655440000/extra",
    " 550e8400-e29b-41d4-a716-446655440000 ", "550e8400-e29b-41d4-a716-446655440000\n", "../admin",
  ])("returns null for the invalid memory id %j", (id) => {
    expect(parseMemoryId(id)).toBeNull();
  });
});
