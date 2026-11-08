import { describe, expect, it } from "vitest";

import {
  isUsableTag,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  normalizeTagName,
  normalizeTags,
  tagSlug,
  tagsEqual,
  toPublicTags,
} from "@/lib/memories/tags";

describe("tagSlug", () => {
  it("uses the shared slug rules for accents, apostrophes and punctuation", () => {
    expect(tagSlug("café")).toBe("cafe");
    expect(tagSlug("St. Mary's")).toBe("st-marys");
    expect(tagSlug("St. Mary’s")).toBe("st-marys");
    expect(tagSlug("  Ocean City!! ")).toBe("ocean-city");
    expect(tagSlug("!!!")).toBe("");
  });

  it("uses the shared 80-character slug cap without truncating the name to 40", () => {
    expect(tagSlug("a".repeat(100))).toBe("a".repeat(80));
    expect(tagSlug(`${"a".repeat(79)} b`)).toBe("a".repeat(79));
  });
});

describe("normalizeTagName", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeTagName(" \t quilting \n ")).toBe("quilting");
    expect(normalizeTagName(" \t\n\u00a0 ")).toBe("");
  });

  it("collapses runs of spaces, tabs, newlines and non-breaking spaces", () => {
    expect(normalizeTagName("  Ocean \t\n\u00a0 City   memories  ")).toBe("Ocean City memories");
  });

  it("cuts a 60-character name to the 40-character limit", () => {
    const name = normalizeTagName("a".repeat(60));
    expect(name).toBe("a".repeat(40));
    expect(Array.from(name)).toHaveLength(MAX_TAG_LENGTH);
  });

  it("trims a space left at the end by truncation", () => {
    const name = `${"a".repeat(39)} ${"b".repeat(20)}`;
    expect(normalizeTagName(name)).toBe("a".repeat(39));
  });

  it.each(["🧵", "é"])("keeps %s intact as the 40th code point", (character) => {
    const name = normalizeTagName(`${"a".repeat(39)}${character}tail`);
    expect(name).toBe(`${"a".repeat(39)}${character}`);
    expect(Array.from(name)).toHaveLength(40);
  });

  it("counts emoji earlier in a name as one code point each", () => {
    expect(normalizeTagName(`${"🧵".repeat(20)}${"a".repeat(30)}`)).toBe(
      `${"🧵".repeat(20)}${"a".repeat(20)}`,
    );
  });
});

describe("isUsableTag", () => {
  it.each(["", " \t\n\u00a0 ", "!!!", "日本", "🧵"])("refuses %j without a usable slug", (name) => {
    expect(isUsableTag(name)).toBe(false);
  });

  it.each(["quilting", " café ", " 1985 ", "日本 1985", "🧵 sewing"])("accepts %j with a usable slug", (name) => {
    expect(isUsableTag(name)).toBe(true);
  });

  it("checks usability after truncation removes the only Latin letter", () => {
    expect(isUsableTag(`${"!".repeat(40)}a`)).toBe(false);
  });
});

describe("normalizeTags", () => {
  it("deduplicates café and cafe by slug, keeping the first spelling", () => {
    expect(normalizeTags(["café", "cafe", "Cafe"])).toEqual(["café"]);
    expect(normalizeTags(["cafe", "café"])).toEqual(["cafe"]);
  });

  it("deduplicates straight and curly apostrophe spellings of St. Mary's", () => {
    expect(normalizeTags(["St. Mary's", "St Marys", "St. Mary’s"])).toEqual(["St. Mary's"]);
  });

  it("normalizes each name and preserves the first occurrence's position", () => {
    expect(normalizeTags([" quilting ", " Ocean\t\n\u00a0City ", "QUILTING", "café", "cafe"])).toEqual([
      "quilting",
      "Ocean City",
      "café",
    ]);
  });

  it("drops empty, punctuation-only and non-Latin names", () => {
    expect(normalizeTags(["", " \t ", "!!!", "日本", "🧵", "quilting"])).toEqual(["quilting"]);
  });

  it("checks usability and duplicate slugs after truncating names", () => {
    const prefix = "a".repeat(40);
    expect(normalizeTags([`${"!".repeat(40)}a`, `${prefix}first`, `${prefix}second`])).toEqual([prefix]);
  });

  it("keeps the first 20 of 25 distinct names", () => {
    const names = Array.from({ length: 25 }, (_, index) => `Patch ${index + 1}`);
    const normalized = normalizeTags(names);
    expect(normalized).toEqual(names.slice(0, 20));
    expect(normalized).toHaveLength(MAX_TAGS);
  });

  it("does not count unusable or duplicate names toward the limit", () => {
    const names = Array.from({ length: 25 }, (_, index) => `Patch ${index + 1}`);
    expect(normalizeTags(["!!!", ...names.flatMap((name) => [name, name.toUpperCase()])])).toEqual(
      names.slice(0, 20),
    );
  });

  it("returns an empty array for empty input", () => {
    expect(normalizeTags([])).toEqual([]);
  });

  it("accepts a frozen input without changing it", () => {
    const names = Object.freeze([" café ", "cafe", "quilting"]);
    expect(normalizeTags(names)).toEqual(["café", "quilting"]);
    expect(names).toEqual([" café ", "cafe", "quilting"]);
  });
});

describe("toPublicTags", () => {
  it("returns normalized names and their slugs in first-occurrence order", () => {
    expect(toPublicTags([" café ", "cafe", "St. Mary’s", "Ocean\tCity", "!!!", "日本"])).toEqual([
      { name: "café", slug: "cafe" },
      { name: "St. Mary’s", slug: "st-marys" },
      { name: "Ocean City", slug: "ocean-city" },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(toPublicTags([])).toEqual([]);
  });
});

describe("tagsEqual", () => {
  it("accepts empty arrays and matching strings in the same order", () => {
    expect(tagsEqual([], [])).toBe(true);
    expect(tagsEqual(["quilting", "café"], ["quilting", "café"])).toBe(true);
  });

  it("rejects different lengths in either direction", () => {
    expect(tagsEqual([], ["quilting"])).toBe(false);
    expect(tagsEqual(["quilting"], [])).toBe(false);
    expect(tagsEqual(["quilting"], ["quilting", "café"])).toBe(false);
    expect(tagsEqual(["quilting", "café"], ["quilting"])).toBe(false);
  });

  it("rejects different strings even when their slugs match", () => {
    expect(tagsEqual(["café"], ["cafe"])).toBe(false);
    expect(tagsEqual(["quilting"], ["Quilting"])).toBe(false);
    expect(tagsEqual(["quilting"], [" quilting "])).toBe(false);
  });

  it("rejects a different order", () => {
    expect(tagsEqual(["quilting", "café"], ["café", "quilting"])).toBe(false);
  });
});
