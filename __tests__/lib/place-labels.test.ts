/**
 * lib/places/label.ts and the trimmed result shape (plan 2026-11-06-photo-gps-places B4, D5): a label is landmark + town +
 * region or town + region, never a house number, road or postcode; a landmark only for named non-residential features,
 * carrying the matched place's own point [C7]; at most 200 characters.
 *
 * Fixtures: the examples in the Nominatim reverse docs [C5] (https://nominatim.org/release-docs/latest/api/Reverse/#examples),
 * the plan's public point (the Statue of Liberty), and made-up places with no family connection.
 */
import { describe, expect, it } from "vitest";

import { placeLabels } from "@/lib/places/label";
import { placeResultSchema, type PlaceResult } from "@/lib/places/types";

/** The docs' `format=jsonv2` example (lat=-34.44076&lon=-58.70521), verbatim: a motorway. */
const DOCS_JSONV2_MOTORWAY = {
  place_id: "134140761",
  licence: "Data © OpenStreetMap contributors, ODbL 1.0. https://www.openstreetmap.org/copyright",
  osm_type: "way",
  osm_id: "280940520",
  lat: "-34.4391708",
  lon: "-58.7064573",
  place_rank: "26",
  category: "highway",
  type: "motorway",
  importance: "0.1",
  addresstype: "road",
  display_name: "Autopista Pedro Eugenio Aramburu, El Triángulo, Partido de Malvinas Argentinas, Buenos Aires, 1.619, Argentina",
  name: "Autopista Pedro Eugenio Aramburu",
  address: {
    road: "Autopista Pedro Eugenio Aramburu",
    village: "El Triángulo",
    state_district: "Partido de Malvinas Argentinas",
    state: "Buenos Aires",
    postcode: "1.619",
    country: "Argentina",
    country_code: "ar",
  },
  boundingbox: ["-34.44159", "-34.4370994", "-58.7086067", "-58.7044712"],
};

/** The docs' `format=geojson` example (lat=44.50155&lon=11.33989), its properties as jsonv2 carries them: a house in Bologna. */
const DOCS_BOLOGNA_HOUSE = {
  place_id: 77292420,
  osm_type: "node",
  osm_id: 1704756187,
  place_rank: 30,
  category: "place",
  type: "house",
  importance: 7.805828946359988e-5,
  addresstype: "place",
  name: "",
  display_name: "71, Via Guglielmo Marconi, Pioggia, Marconi, Porto-Saragozza, Bologna, Emilia-Romagna, 40122, Italy",
  address: {
    house_number: "71",
    road: "Via Guglielmo Marconi",
    neighbourhood: "Pioggia",
    suburb: "Marconi",
    city: "Bologna",
    county: "Bologna",
    "ISO3166-2-lvl6": "IT-BO",
    state: "Emilia-Romagna",
    "ISO3166-2-lvl4": "IT-45",
    postcode: "40122",
    country: "Italy",
    country_code: "it",
  },
  lat: "44.5015307",
  lon: "11.3398676",
};

/** The docs' XML example's address parts (Birmingham, United Kingdom): no state, so the region is the country. */
const DOCS_BIRMINGHAM_ADDRESS = {
  category: "place",
  type: "house",
  addresstype: "place",
  name: "",
  address: {
    house_number: "135",
    road: "Pilkington Avenue",
    village: "Wylde Green",
    town: "Sutton Coldfield",
    city: "City of Birmingham",
    county: "West Midlands (county)",
    postcode: "B72",
    country: "United Kingdom",
    country_code: "gb",
  },
};

/** An Orlando-shaped golf club (made-up name; a city-level point). */
const ORLANDO_GOLF_CLUB = {
  category: "leisure",
  type: "golf_course",
  addresstype: "leisure",
  name: "Lakeside Golf Club",
  lat: "28.54",
  lon: "-81.38",
  address: { leisure: "Lakeside Golf Club", road: "Example Road", city: "Orlando", county: "Orange County", state: "Florida", postcode: "32801", country: "United States", country_code: "us" },
};

/** The plan's fixture point as a tourism result, with the object's own point. */
const STATUE_OF_LIBERTY = {
  category: "tourism",
  type: "attraction",
  addresstype: "tourism",
  name: "Statue of Liberty",
  lat: "40.689247",
  lon: "-74.044502",
  address: { tourism: "Statue of Liberty", road: "Flagpole Plaza", city: "New York", state: "New York", postcode: "10004", country: "United States", country_code: "us" },
};

/** A rural point whose nearest named thing is only a county (made up). */
const COUNTY_ONLY = {
  category: "boundary",
  type: "administrative",
  addresstype: "county",
  name: "Example County",
  lat: "38.5",
  lon: "-98.5",
  address: { county: "Example County", state: "Kansas", country: "United States", country_code: "us" },
};

const parse = (raw: unknown): PlaceResult => placeResultSchema.parse(raw);
const texts = (result: PlaceResult | null) => placeLabels(result).map((l) => l.text);

describe("placeResultSchema (the trimmed shape the cache stores)", () => {
  it("keeps only name, category, type, addresstype, the place's own lat/lon and the town-level address parts", () => {
    const trimmed = parse(DOCS_BOLOGNA_HOUSE);
    expect(trimmed).toEqual({
      name: "",
      category: "place",
      type: "house",
      addresstype: "place",
      lat: "44.5015307",
      lon: "11.3398676",
      address: { city: "Bologna", county: "Bologna", state: "Emilia-Romagna", country: "Italy", country_code: "it" },
    });
    const json = JSON.stringify([trimmed, parse(DOCS_JSONV2_MOTORWAY), parse(ORLANDO_GOLF_CLUB), parse(DOCS_BIRMINGHAM_ADDRESS)]);
    // Keys (with their colon) and the values they carried; a result's `addresstype` may itself be the word "road".
    for (const forbidden of ['"house_number":', '"road":', '"postcode":', '"display_name":', '"osm_id":', "Via Guglielmo Marconi", "40122", "Pilkington", "B72", "Example Road", "32801"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("accepts a result with no address block (an empty address) and a null name", () => {
    expect(parse({ category: "natural", type: "water", name: null })).toEqual({ category: "natural", type: "water", name: null, address: {} });
  });
});

describe("placeLabels (D5)", () => {
  it("the docs' Bologna house: residential, so a town label only, with the country because it is not the US", () => {
    expect(placeLabels(parse(DOCS_BOLOGNA_HOUSE))).toEqual([{ text: "Bologna, Emilia-Romagna, Italy", kind: "town" }]);
  });

  it("the docs' motorway: a named road is never a landmark; the village is the locality", () => {
    expect(placeLabels(parse(DOCS_JSONV2_MOTORWAY))).toEqual([{ text: "El Triángulo, Buenos Aires, Argentina", kind: "town" }]);
  });

  it("the docs' Birmingham address: no state, so the region is the country; the city wins over town and village", () => {
    expect(texts(parse(DOCS_BIRMINGHAM_ADDRESS))).toEqual(["City of Birmingham, United Kingdom"]);
  });

  it("an Orlando-shaped golf club: a landmark (name, town, region) carrying the club's own point, then the town; no country for the US", () => {
    expect(placeLabels(parse(ORLANDO_GOLF_CLUB))).toEqual([
      { text: "Lakeside Golf Club, Orlando, Florida", kind: "landmark", point: { latitude: 28.54, longitude: -81.38 } },
      { text: "Orlando, Florida", kind: "town" },
    ]);
  });

  it("the Statue of Liberty: a tourism landmark with its own point", () => {
    expect(placeLabels(parse(STATUE_OF_LIBERTY))).toEqual([
      { text: "Statue of Liberty, New York, New York", kind: "landmark", point: { latitude: 40.689247, longitude: -74.044502 } },
      { text: "New York, New York", kind: "town" },
    ]);
  });

  it("a county-only rural point: the county stands in for the town, and a name equal to the locality is no landmark", () => {
    expect(placeLabels(parse(COUNTY_ONLY))).toEqual([{ text: "Example County, Kansas", kind: "town" }]);
  });

  it("an empty result (the provider found nothing) and a result without any locality give no labels", () => {
    expect(placeLabels(null)).toEqual([]);
    expect(placeLabels(parse({ category: "natural", type: "water", name: "Atlantic Ocean", address: {} }))).toEqual([]);
    expect(placeLabels(parse({ address: { state: "Kansas", country: "United States", country_code: "us" } }))).toEqual([]);
  });

  it.each([
    ["amenity", "library"],
    ["tourism", "museum"],
    ["leisure", "park"],
    ["historic", "monument"],
    ["natural", "beach"],
    ["waterway", "waterfall"],
    ["aeroway", "aerodrome"],
    ["place", "island"],
    ["place", "islet"],
    ["place", "square"],
    ["boundary", "national_park"],
    ["boundary", "protected_area"],
  ])("a named %s/%s is a landmark", (category, type) => {
    const labels = placeLabels(parse({ category, type, addresstype: category, name: "Somewhere Named", lat: "10.5", lon: "20.25", address: { town: "Smalltown", state: "Ohio", country_code: "us" } }));
    expect(labels[0]).toEqual({ text: "Somewhere Named, Smalltown, Ohio", kind: "landmark", point: { latitude: 10.5, longitude: 20.25 } });
  });

  it.each([
    ["highway", "residential", "road"],
    ["shop", "bakery", "shop"],
    ["place", "city", "city"],
    ["place", "house", "place"],
    ["building", "yes", "building"],
    ["building", "apartments", "building"],
    ["amenity", "apartments", "amenity"],
    ["landuse", "residential", "residential"],
    ["amenity", "restaurant", "house"],
    ["boundary", "administrative", "county"],
  ])("a named %s/%s (addresstype %s) is never a landmark", (category, type, addresstype) => {
    const labels = placeLabels(parse({ category, type, addresstype, name: "Something Named", lat: "10.5", lon: "20.25", address: { town: "Smalltown", state: "Ohio", country_code: "us" } }));
    expect(labels).toEqual([{ text: "Smalltown, Ohio", kind: "town" }]);
  });

  it("a landmark whose own point is missing or invalid keeps its text and has no point (MCP proposes coordinates only with one)", () => {
    for (const point of [{}, { lat: "abc", lon: "1" }, { lat: "91", lon: "0" }]) {
      const [landmark] = placeLabels(parse({ category: "tourism", type: "museum", name: "A Museum", ...point, address: { city: "Toledo", state: "Ohio", country_code: "us" } }));
      expect(landmark).toEqual({ text: "A Museum, Toledo, Ohio", kind: "landmark" });
    }
  });

  it("a name equal to the locality (ignoring case and spaces) is not a landmark", () => {
    expect(texts(parse({ category: "tourism", type: "attraction", name: " orlando ", address: { city: "Orlando", state: "Florida", country_code: "us" } }))).toEqual(["Orlando, Florida"]);
  });

  it("drops any label over 200 characters, and keeps one of exactly 200", () => {
    const longName = "N".repeat(200);
    expect(texts(parse({ category: "tourism", type: "museum", name: longName, address: { city: "Toledo", state: "Ohio", country_code: "us" } }))).toEqual(["Toledo, Ohio"]);
    const exact = "T".repeat(200 - ", Ohio".length);
    expect(texts(parse({ address: { city: exact, state: "Ohio", country_code: "us" } }))).toEqual([`${exact}, Ohio`]);
    expect(texts(parse({ address: { city: `${exact}x`, state: "Ohio", country_code: "us" } }))).toEqual([]);
  });

  it("trims parts and skips empty ones (a US address with no state is the town alone)", () => {
    expect(texts(parse({ address: { city: "  Toledo ", state: " ", country: "United States", country_code: "us" } }))).toEqual(["Toledo"]);
  });
});
