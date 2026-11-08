import { describe, expect, it } from "vitest";

import {
  decadeFromHash,
  isActivePath,
  playedBars,
  SEARCH_DEBOUNCE_MS,
  syncedQuery,
} from "@/lib/memories/client-logic";

describe("isActivePath", () => {
  it.each([
    ["/", "/", true],
    ["/memories", "/", false],
    ["/memories", "/memories", true],
    ["/memories/", "/memories", true],
    ["/memories/timeline", "/memories", true],
    ["/memories/one/photo", "/memories", true],
    ["/memoriesX", "/memories", false],
    ["/memories-old/one", "/memories", false],
    ["/share", "/memories", false],
    ["/Memories", "/memories", false],
  ])("matches %s against %s as %s", (pathname, href, expected) => {
    expect(isActivePath(pathname, href)).toBe(expected);
  });
});

describe("decadeFromHash", () => {
  const ids = ["d1980", "d1990", "D2000"] as const;

  it.each([
    ["#d1980", "d1980"],
    ["d1990", "d1990"],
    ["#%641980", "d1980"],
    ["d%31%39%39%30", "d1990"],
    ["#D2000", "D2000"],
    ["#d2000", null],
    ["#D1980", null],
    ["#d1970", null],
    ["#d1980/extra", null],
    ["#", null],
    ["", null],
    ["#d1980%", null],
    ["#%E0%A4%A", null],
  ])("resolves %s as %s", (hash, expected) => {
    expect(decadeFromHash(hash, ids)).toBe(expected);
  });

  it("has no matching decade when there are no rendered ids", () => {
    expect(decadeFromHash("#d1980", [])).toBeNull();
  });
});

describe("playedBars", () => {
  it.each([
    [0, 100, 40, 0],
    [24.9, 100, 40, 9],
    [25, 100, 40, 10],
    [99, 100, 40, 39],
    [100, 100, 40, 40],
    [125, 100, 40, 40],
    [-25, 100, 40, 0],
    [Infinity, 100, 40, 40],
    [-Infinity, 100, 40, 0],
    [NaN, 100, 40, 0],
    [50, 100, 0, 0],
    [50, 100, -1, 0],
    [50, 100, NaN, 0],
    [50, 100, Infinity, 0],
    [50, 100, 4.5, 2],
  ])("counts progress %s/%s over %s bars as %s", (current, total, count, expected) => {
    expect(playedBars(current, total, count)).toBe(expected);
  });

  it.each([null, 0, -10, NaN, Infinity, -Infinity])("shows no progress for total %s", (total) => {
    expect(playedBars(20, total, 40)).toBe(0);
  });
});

describe("syncedQuery", () => {
  it("preserves the text and spacing while the field is focused", () => {
    expect(syncedQuery(true, "new quilt ", "old quilt")).toBe("new quilt ");
    expect(syncedQuery(true, "still typing", undefined)).toBe("still typing");
    expect(syncedQuery(true, "", "old quilt")).toBe("");
  });

  it("follows the URL when the field is not focused", () => {
    expect(syncedQuery(false, "old quilt", "new quilt")).toBe("new quilt");
    expect(syncedQuery(false, "old quilt", undefined)).toBe("");
    expect(syncedQuery(false, "old quilt", "")).toBe("");
  });
});

describe("SEARCH_DEBOUNCE_MS", () => {
  it("waits 400 milliseconds", () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(400);
  });
});
