import { describe, expect, it } from "vitest";

import {
  HOME_BOUNDS,
  POINT_STEP,
  US_OUTLINE_PATH,
  US_OUTLINE_VIEWBOX,
  groupPlaces,
  homePoint,
  inHomeBounds,
  inUsBounds,
  normalizePlaceLabel,
  pinSize,
  placeSlug,
  roundCoordinate,
  roundPoint,
  toPublicPlace,
  usPoint,
} from "@/lib/memories/places";
import type { MapPercent } from "@/lib/memories/places";
import type { PublicMemory } from "@/lib/memories/types";

describe("place labels and slugs", () => {
  it("trims and collapses whitespace while preserving the contributor's spelling", () => {
    expect(normalizePlaceLabel(" \tTowson,\n  MD\u00a0 ")).toBe("Towson, MD");
  });

  it("strips trailing periods, commas, semicolons, colons and spaces only", () => {
    expect(normalizePlaceLabel(" St. Mary's, MD. , ; :  ")).toBe("St. Mary's, MD");
    expect(normalizePlaceLabel("Towson!")).toBe("Towson!");
  });

  it.each([null, undefined, "", " \t\n ", " . , ; : ", "!!!", "日本"])(
    "returns null for an absent or unsluggable label %j",
    (place) => {
      expect(normalizePlaceLabel(place)).toBeNull();
      expect(toPublicPlace(place)).toBeNull();
    },
  );

  it("uses the shared slug rules for diacritics, apostrophes and punctuation", () => {
    expect(placeSlug("St. Mary’s, MD")).toBe("st-marys-md");
    expect(placeSlug("Café")).toBe("cafe");
    expect(placeSlug("Towson MD")).toBe("towson-md");
  });

  it("builds a public place from the normalized label", () => {
    expect(toPublicPlace("Towson, MD")).toEqual({ label: "Towson, MD", slug: "towson-md" });
    expect(toPublicPlace("  Towson,   MD.; ")).toEqual({ label: "Towson, MD", slug: "towson-md" });
  });
});

describe("town-level points", () => {
  it("uses the 0.05 degree public grid", () => {
    expect(POINT_STEP).toBe(0.05);
  });

  it.each([
    [39.41, 39.4],
    [39.43, 39.45],
    [-76.61, -76.6],
    [-76.64, -76.65],
    [0, 0],
  ])("rounds %s to %s without floating-point noise", (value, expected) => {
    expect(roundCoordinate(value)).toBe(expected);
  });

  it.each([
    [null, -76.61],
    [39.41, null],
    [undefined, -76.61],
    [39.41, undefined],
    [NaN, -76.61],
    [39.41, NaN],
    [Infinity, -76.61],
    [39.41, -Infinity],
    [-90.01, 0],
    [90.01, 0],
    [0, -180.01],
    [0, 180.01],
  ])("refuses invalid coordinates (%s, %s) before rounding", (lat, lon) => {
    expect(roundPoint(lat, lon)).toBeNull();
  });

  it("rounds both coordinates of a valid point", () => {
    expect(roundPoint(39.41, -76.61)).toEqual({ lat: 39.4, lon: -76.6 });
  });

  it("accepts the equator, prime meridian and inclusive geographic limits", () => {
    expect(roundPoint(0, 0)).toEqual({ lat: 0, lon: 0 });
    expect(roundPoint(-90, -180)).toEqual({ lat: -90, lon: -180 });
    expect(roundPoint(90, 180)).toEqual({ lat: 90, lon: 180 });
  });
});

describe("groupPlaces", () => {
  it("groups by slug, keeps the first label and rounds the mean of only the available points", () => {
    const memories: ReadonlyArray<Pick<PublicMemory, "place" | "point" | "year">> = [
      { place: { label: "Towson, MD", slug: "towson-md" }, point: { lat: 39.4, lon: -76.6 }, year: null },
      { place: { label: "Towson MD", slug: "towson-md" }, point: { lat: 39.5, lon: -76.6 }, year: 1998 },
      { place: { label: "Towson MD", slug: "towson-md" }, point: { lat: 39.5, lon: -76.7 }, year: 1972 },
      { place: { label: "Towson MD", slug: "towson-md" }, point: null, year: 1985 },
      { place: null, point: { lat: 40, lon: -70 }, year: 1900 },
    ];
    const original = structuredClone(memories);

    expect(groupPlaces(memories)).toEqual([
      {
        slug: "towson-md",
        label: "Towson, MD",
        count: 4,
        firstYear: 1972,
        lastYear: 1998,
        point: { lat: 39.45, lon: -76.65 },
      },
    ]);
    expect(memories).toEqual(original);
  });

  it("keeps a place with no years or points and returns null for those fields", () => {
    expect(groupPlaces([
      { place: { label: "Baltimore", slug: "baltimore" }, point: null, year: null },
      { place: { label: "Baltimore", slug: "baltimore" }, point: null, year: null },
    ])).toEqual([
      { slug: "baltimore", label: "Baltimore", count: 2, firstYear: null, lastYear: null, point: null },
    ]);
  });

  it("sorts by count descending then label ascending in English", () => {
    expect(groupPlaces([
      { place: { label: "Zürich", slug: "zurich" }, point: null, year: 2001 },
      { place: { label: "Évansville", slug: "evansville" }, point: null, year: 2002 },
      { place: { label: "Baltimore", slug: "baltimore" }, point: null, year: 2003 },
      { place: { label: "Towson", slug: "towson" }, point: null, year: null },
      { place: { label: "Towson", slug: "towson" }, point: null, year: null },
    ])).toEqual([
      { slug: "towson", label: "Towson", count: 2, firstYear: null, lastYear: null, point: null },
      { slug: "baltimore", label: "Baltimore", count: 1, firstYear: 2003, lastYear: 2003, point: null },
      { slug: "evansville", label: "Évansville", count: 1, firstYear: 2002, lastYear: 2002, point: null },
      { slug: "zurich", label: "Zürich", count: 1, firstYear: 2001, lastYear: 2001, point: null },
    ]);
  });

  it("returns no groups for an empty list or memories without a place", () => {
    expect(groupPlaces([])).toEqual([]);
    expect(groupPlaces([{ place: null, point: null, year: null }])).toEqual([]);
  });
});

describe("US map projection", () => {
  it.each([
    ["Cockeysville", { lat: 39.48, lon: -76.64 }, { x: 82.5734, y: 40.543152 }],
    ["San Francisco", { lat: 37.77, lon: -122.42 }, { x: 5.2052, y: 47.261058 }],
  ])("places %s at the design's position inside the map", (_label, point, expected) => {
    const projected: MapPercent = usPoint(point);
    expect(projected.x).toBeCloseTo(expected.x, 6);
    expect(projected.y).toBeCloseTo(expected.y, 6);
    expect(projected.x).toBeGreaterThanOrEqual(0);
    expect(projected.x).toBeLessThanOrEqual(100);
    expect(projected.y).toBeGreaterThanOrEqual(0);
    expect(projected.y).toBeLessThanOrEqual(100);
    expect(inUsBounds(point)).toBe(true);
  });

  it("excludes Honolulu from the contiguous US map", () => {
    expect(inUsBounds({ lat: 21.31, lon: -157.86 })).toBe(false);
  });

  it("includes the northwest corner and excludes points beyond each map edge", () => {
    expect(usPoint({ lat: 49.8, lon: -125.5 })).toEqual({ x: 0, y: 0 });
    expect(inUsBounds({ lat: 49.8, lon: -125.5 })).toBe(true);
    expect(inUsBounds({ lat: 40, lon: -126 })).toBe(false);
    expect(inUsBounds({ lat: 40, lon: -66 })).toBe(false);
    expect(inUsBounds({ lat: 50, lon: -100 })).toBe(false);
    expect(inUsBounds({ lat: 24, lon: -100 })).toBe(false);
  });

  it("provides the design's outline and its SVG coordinate box", () => {
    expect(US_OUTLINE_VIEWBOX).toBe("0 0 1000 560");
    expect(US_OUTLINE_PATH.length).toBeGreaterThan(0);
    expect(US_OUTLINE_PATH.startsWith("M")).toBe(true);
  });
});

describe("closer to home inset", () => {
  it.each([
    ["Baltimore", { lat: 39.29, lon: -76.61 }, { x: 36.333333, y: 52.4 }],
    ["Ocean City", { lat: 38.34, lon: -75.08 }, { x: 87.333333, y: 90.4 }],
  ])("places %s within the desktop inset", (_label, point, expected) => {
    expect(inHomeBounds(point)).toBe(true);
    expect(homePoint(point).x).toBeCloseTo(expected.x, 5);
    expect(homePoint(point).y).toBeCloseTo(expected.y, 5);
  });

  it("includes the design's bounds and maps the corners to the inset edges", () => {
    expect(HOME_BOUNDS).toEqual({ west: -77.7, east: -74.7, south: 38.1, north: 40.6 });
    expect(inHomeBounds({ lat: 40.6, lon: -77.7 })).toBe(true);
    expect(inHomeBounds({ lat: 38.1, lon: -74.7 })).toBe(true);
    expect(homePoint({ lat: 40.6, lon: -77.7 })).toEqual({ x: 0, y: 0 });
    expect(homePoint({ lat: 38.1, lon: -74.7 })).toEqual({ x: 100, y: 100 });
  });

  it.each([
    { lat: 39, lon: -77.71 },
    { lat: 39, lon: -74.69 },
    { lat: 38.09, lon: -76 },
    { lat: 40.61, lon: -76 },
  ])("excludes a point beyond a home edge: %j", (point) => {
    expect(inHomeBounds(point)).toBe(false);
  });
});

describe("pinSize", () => {
  it.each([
    [1, 33, 39],
    [4, 40, 46],
    [20, 57, 63],
  ])("sizes a group of %s and enlarges its selected pin", (count, normal, selected) => {
    expect(pinSize(count, false)).toBe(normal);
    expect(pinSize(count, true)).toBe(selected);
  });
});
