import { describe, expect, it } from "vitest";

import { SLUG_MAX_LENGTH, slugify } from "@/lib/memories/slug";

describe("slugify (plan: tags and places share one slug rule, #8, #19)", () => {
  it("strips diacritics so café and cafe meet", () => {
    expect(slugify("café")).toBe("cafe");
    expect(slugify("Cafe")).toBe("cafe");
  });

  it("drops apostrophes so St. Mary's and St Marys meet", () => {
    expect(slugify("St. Mary's")).toBe("st-marys");
    expect(slugify("St Marys")).toBe("st-marys");
    expect(slugify("St. Mary’s")).toBe("st-marys");
  });

  it("turns other runs of punctuation and spaces into one hyphen, trimmed at both ends", () => {
    expect(slugify("  Towson,   MD ")).toBe("towson-md");
    expect(slugify("--quilting!!")).toBe("quilting");
    expect(slugify("Lancaster County, PA")).toBe("lancaster-county-pa");
  });

  it("returns an empty slug for punctuation-only and non-Latin names", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("   ")).toBe("");
    expect(slugify("日本")).toBe("");
  });

  it("caps the slug at 80 characters without a trailing hyphen", () => {
    const long = `${"a".repeat(79)} b${"c".repeat(40)}`;
    const slug = slugify(long);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug).toBe("a".repeat(79));
    expect(slugify("x".repeat(200))).toHaveLength(SLUG_MAX_LENGTH);
  });
});
