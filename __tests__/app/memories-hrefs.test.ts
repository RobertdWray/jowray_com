import { describe, expect, it } from "vitest";

import {
  PUBLIC_PATHS,
  exploreHref,
  mapHref,
  memoryHref,
  moreHref,
  publicMediaHref,
  searchHref,
  shareHref,
  tagsHref,
  timelineHref,
  toggleHref,
} from "@/app/memories/_components/hrefs";
import type { ExploreFilters } from "@/lib/memories/types";
import { parseExploreQuery } from "@/lib/validations/public-memories";

function filters(overrides: Partial<ExploreFilters> = {}): ExploreFilters {
  return {
    place: "towson-md", decade: 1980, tag: "quilting", kind: "PHOTO", q: "bus", n: 24,
    ...overrides,
  };
}

describe("public paths", () => {
  it("keeps the four public views and the share link in one place", () => {
    expect(PUBLIC_PATHS).toStrictEqual({
      explore: "/memories", map: "/memories/map", timeline: "/memories/timeline", tags: "/memories/tags",
    });
    expect(shareHref).toBe("/share");
  });
});

describe("exploreHref", () => {
  it("writes filters in the fixed order regardless of object insertion order", () => {
    expect(exploreHref({ n: 24, q: "bus", kind: "PHOTO", tag: "quilting", decade: 1980, place: "towson-md" }))
      .toBe("/memories?place=towson-md&decade=1980&tag=quilting&kind=PHOTO&q=bus&n=24");
  });

  it("omits undefined values and the default count without leaving a question mark", () => {
    expect(exploreHref({})).toBe("/memories");
    expect(exploreHref({ place: undefined, decade: undefined, tag: undefined, kind: undefined, q: undefined, n: undefined }))
      .toBe("/memories");
    expect(exploreHref({ n: 12 })).toBe("/memories");
    expect(exploreHref({ tag: "quilting", n: 12 })).toBe("/memories?tag=quilting");
    expect(exploreHref({ n: 9 })).toBe("/memories?n=9");
    expect(exploreHref({ n: Number.MAX_SAFE_INTEGER })).toBe("/memories?n=9007199254740991");
  });

  it("encodes spaces, ampersands, quotes and non-ASCII text as query values", () => {
    expect(exploreHref({ place: "St. Mary's & café", tag: '“quilt” & "家"', q: 'Jo’s "café" & quilts' }))
      .toBe("/memories?place=St.+Mary%27s+%26+caf%C3%A9&tag=%E2%80%9Cquilt%E2%80%9D+%26+%22%E5%AE%B6%22&q=Jo%E2%80%99s+%22caf%C3%A9%22+%26+quilts");
  });

  it("keeps query and fragment delimiters inside their original value", () => {
    expect(exploreHref({ q: "a+b&n=999#d1980?x=%" }))
      .toBe("/memories?q=a%2Bb%26n%3D999%23d1980%3Fx%3D%25");
  });

  it("round-trips valid filters through the page's query parser", () => {
    const current = filters({ q: 'Jo’s "café" & quilts' });
    const query = exploreHref(current).split("?")[1];
    expect(parseExploreQuery(Object.fromEntries(new URLSearchParams(query)))).toStrictEqual(current);
  });
});

describe("toggleHref", () => {
  it.each([
    ["place", "towson-md", "/memories?decade=1980&tag=quilting&kind=PHOTO&q=bus"],
    ["decade", 1980, "/memories?place=towson-md&tag=quilting&kind=PHOTO&q=bus"],
    ["tag", "quilting", "/memories?place=towson-md&decade=1980&kind=PHOTO&q=bus"],
    ["kind", "PHOTO", "/memories?place=towson-md&decade=1980&tag=quilting&q=bus"],
  ] as const)("clears a selected %s and resets the count", (key, value, expected) => {
    expect(toggleHref(filters(), key, value)).toBe(expected);
  });

  it.each([
    ["place", "baltimore-md", "/memories?place=baltimore-md&decade=1980&tag=quilting&kind=PHOTO&q=bus"],
    ["decade", 1990, "/memories?place=towson-md&decade=1990&tag=quilting&kind=PHOTO&q=bus"],
    ["tag", "gardening", "/memories?place=towson-md&decade=1980&tag=gardening&kind=PHOTO&q=bus"],
    ["kind", "VOICE", "/memories?place=towson-md&decade=1980&tag=quilting&kind=VOICE&q=bus"],
  ] as const)("replaces a different %s and keeps the other filters and search", (key, value, expected) => {
    expect(toggleHref(filters(), key, value)).toBe(expected);
  });

  it("adds an absent filter, compares without coercion, and removes the final filter cleanly", () => {
    expect(toggleHref({ n: 36 }, "tag", "quilting")).toBe("/memories?tag=quilting");
    expect(toggleHref({ n: 36, decade: 1980 }, "decade", "1980")).toBe("/memories?decade=1980");
    expect(toggleHref({ n: 36, tag: "quilting" }, "tag", "quilting")).toBe("/memories");
  });
});

describe("searchHref and moreHref", () => {
  it("trims a new search, keeps the other filters and resets the count", () => {
    expect(searchHref(filters(), "  quilt & café  "))
      .toBe("/memories?place=towson-md&decade=1980&tag=quilting&kind=PHOTO&q=quilt+%26+caf%C3%A9");
    expect(searchHref(filters(), "bus"))
      .toBe("/memories?place=towson-md&decade=1980&tag=quilting&kind=PHOTO&q=bus");
  });

  it("removes an empty search and the count without losing the other filters", () => {
    expect(searchHref(filters(), " \t\n "))
      .toBe("/memories?place=towson-md&decade=1980&tag=quilting&kind=PHOTO");
    expect(searchHref({ n: 24, q: "bus" }, "")).toBe("/memories");
  });

  it("changes only the count for Show more and omits the default count", () => {
    expect(moreHref(filters(), 36))
      .toBe("/memories?place=towson-md&decade=1980&tag=quilting&kind=PHOTO&q=bus&n=36");
    expect(moreHref(filters(), 12))
      .toBe("/memories?place=towson-md&decade=1980&tag=quilting&kind=PHOTO&q=bus");
  });

  it("never mutates the current filters when building a link", () => {
    const current = filters();
    Object.freeze(current);
    toggleHref(current, "place", "towson-md");
    searchHref(current, "quilt");
    moreHref(current, 36);
    expect(current).toStrictEqual(filters());
  });
});

describe("mapHref, timelineHref and tagsHref", () => {
  it("builds the map link with an optional encoded place", () => {
    expect(mapHref()).toBe("/memories/map");
    expect(mapHref("towson-md")).toBe("/memories/map?place=towson-md");
    expect(mapHref('Café & "Jo’s"')).toBe("/memories/map?place=Caf%C3%A9+%26+%22Jo%E2%80%99s%22");
  });

  it("puts kind in the query and decade in a fragment, in that order", () => {
    expect(timelineHref()).toBe("/memories/timeline");
    expect(timelineHref({})).toBe("/memories/timeline");
    expect(timelineHref({ kind: "PHOTO" })).toBe("/memories/timeline?kind=PHOTO");
    expect(timelineHref({ decade: 1980 })).toBe("/memories/timeline#d1980");
    expect(timelineHref({ kind: "VOICE", decade: 1980 })).toBe("/memories/timeline?kind=VOICE#d1980");
  });

  it("builds tag links with tag before count, omitting only the nine-item default", () => {
    expect(tagsHref()).toBe("/memories/tags");
    expect(tagsHref(undefined, 9)).toBe("/memories/tags");
    expect(tagsHref("quilting")).toBe("/memories/tags?tag=quilting");
    expect(tagsHref("quilting", 9)).toBe("/memories/tags?tag=quilting");
    expect(tagsHref("quilting", 18)).toBe("/memories/tags?tag=quilting&n=18");
    expect(tagsHref(undefined, 12)).toBe("/memories/tags?n=12");
    expect(tagsHref('café & "家"', 18)).toBe("/memories/tags?tag=caf%C3%A9+%26+%22%E5%AE%B6%22&n=18");
  });
});

describe("memoryHref and publicMediaHref", () => {
  it("keeps ordinary ids intact and chooses the requested media variant", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(memoryHref(id)).toBe(`/memories/${id}`);
    expect(publicMediaHref(id, "thumb")).toBe(`/api/public-media/${id}?v=thumb`);
    expect(publicMediaHref(id, "web")).toBe(`/api/public-media/${id}?v=web`);
  });

  it("encodes ids as a single path segment without form-style plus signs", () => {
    const id = 'café /?&#%"';
    const encoded = "caf%C3%A9%20%2F%3F%26%23%25%22";
    expect(memoryHref(id)).toBe(`/memories/${encoded}`);
    expect(publicMediaHref(id, "thumb")).toBe(`/api/public-media/${encoded}?v=thumb`);
    expect(publicMediaHref(id, "web")).toBe(`/api/public-media/${encoded}?v=web`);
  });
});
