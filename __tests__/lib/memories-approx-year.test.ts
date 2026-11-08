import { describe, expect, it } from "vitest";

import { MIN_YEAR, decadeOf, displayYear, parseApproxYear } from "@/lib/memories/approx-year";

const NOW = new Date("2026-11-08T12:00:00Z");

describe("parseApproxYear", () => {
  it.each([null, undefined, "", "   ", "\t\n"])("returns null for missing or blank text: %j", (text) => {
    expect(parseApproxYear(text, NOW)).toBeNull();
  });

  it("includes 1900 as the earliest four-digit year", () => {
    expect(MIN_YEAR).toBe(1900);
    expect(parseApproxYear("1900", NOW)).toBe(1900);
    expect(parseApproxYear("1899", NOW)).toBeNull();
  });

  it.each([
    ["1959", 1959],
    ["1950s", 1950],
    ["the 1950s", 1950],
    ["mid-1960s", 1960],
    ["1949–66", 1949],
    ["1949-66", 1949],
    ["1949 to 1966", 1949],
    ["Christmas 1959", 1959],
    ["Summer 1998", 1998],
    ["2026", 2026],
  ])("reads the first year in %j as %i", (text, year) => {
    expect(parseApproxYear(text, NOW)).toBe(year);
  });

  it.each([
    "1850", "2099", "2027", "age 12", "66", "age 5", "undated",
    "11959", "19590", "119590", "1234567890",
  ])("returns null when %j has no valid year", (text) => {
    expect(parseApproxYear(text, NOW)).toBeNull();
  });

  it.each([
    ["born 1850, married 1952", 1952],
    ["2099, then 1959", 1959],
    ["11959 and 19590, then 1998", 1998],
    ["1998, remembering 1959", 1998],
    ["summer of '85, then 1998", 1985],
    ["1998, remembering '85", 1998],
    ["1850, then '05 and 1952", 2005],
    ["'851, then 1952", 1952],
  ])("scans %j from left to right, skipping invalid candidates", (text, year) => {
    expect(parseApproxYear(text, NOW)).toBe(year);
  });

  it.each([
    ["'85", 1985],
    ["summer of '85", 1985],
    ["’85", 1985],
    ["‘85", 1985],
    ["’50s", 1950],
    ["'05", 2005],
    ["'00", 2000],
    ["'26", 2026],
    ["'27", 1927],
    ["'99", 1999],
  ])("expands the apostrophe year %j to %i using the current year", (text, year) => {
    expect(parseApproxYear(text, NOW)).toBe(year);
  });

  it.each(["'8", "'085", "’851", "‘8512", "' 85", "’ 50"])(
    "requires exactly two digits immediately after an apostrophe in %j",
    (text) => {
      expect(parseApproxYear(text, NOW)).toBeNull();
    },
  );
});

describe("displayYear", () => {
  it("prefers the family's explicit year when the text says otherwise", () => {
    expect(displayYear({ approxYear: 1960, approxDateText: "Summer 1998" }, NOW)).toBe(1960);
  });

  it("uses a non-null explicit year without treating zero as missing", () => {
    expect(displayYear({ approxYear: 0, approxDateText: "Summer 1998" }, NOW)).toBe(0);
  });

  it("falls back to the text when the explicit year is null", () => {
    expect(displayYear({ approxYear: null, approxDateText: "Summer 1998" }, NOW)).toBe(1998);
  });

  it("passes the supplied current year to the text parser", () => {
    expect(displayYear({ approxYear: null, approxDateText: "'27" }, NOW)).toBe(1927);
    expect(displayYear({ approxYear: null, approxDateText: "2027" }, NOW)).toBeNull();
  });

  it("returns null when neither field supplies a year", () => {
    expect(displayYear({ approxYear: null, approxDateText: null }, NOW)).toBeNull();
    expect(displayYear({ approxYear: null, approxDateText: "undated" }, NOW)).toBeNull();
  });
});

describe("decadeOf", () => {
  it.each([
    [1900, 1900],
    [1959, 1950],
    [2000, 2000],
    [2026, 2020],
  ])("groups %i in the decade starting at %i", (year, decade) => {
    expect(decadeOf(year)).toBe(decade);
  });
});
