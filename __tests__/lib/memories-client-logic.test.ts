import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDebounce,
  decadeFromHash,
  decadeFromLink,
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

describe("createDebounce (the search box's pending search, TCR round 1 B2-3)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("runs only the last scheduled search, after the pause", () => {
    const ran: string[] = [];
    const debounce = createDebounce(SEARCH_DEBOUNCE_MS);
    debounce.schedule(() => ran.push("bu"));
    vi.advanceTimersByTime(300);
    debounce.schedule(() => ran.push("bus"));
    vi.advanceTimersByTime(399);
    expect(ran).toEqual([]);
    expect(debounce.isPending()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(ran).toEqual(["bus"]);
    expect(debounce.isPending()).toBe(false);
  });

  it("abandons unsent typing when cancelled: a press elsewhere (blur), a submit, new filters or unmounting", () => {
    const ran: string[] = [];
    const debounce = createDebounce(SEARCH_DEBOUNCE_MS);
    debounce.schedule(() => ran.push("buses"));
    vi.advanceTimersByTime(200);
    // The visitor presses a filter chip mid-pause: the field blurs before the chip's navigation starts.
    debounce.cancel();
    vi.advanceTimersByTime(10_000);
    expect(ran).toEqual([]);
    expect(debounce.isPending()).toBe(false);
  });

  it("is harmless to cancel with nothing pending, and schedules again afterwards", () => {
    const ran: string[] = [];
    const debounce = createDebounce(SEARCH_DEBOUNCE_MS);
    debounce.cancel();
    debounce.schedule(() => ran.push("quilt"));
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(ran).toEqual(["quilt"]);
  });
});

describe("decadeFromLink (the timeline's jump links, TCR round 1 B2-4)", () => {
  const ids = ["d1970", "d1980", "d1990"];
  const here = "https://www.jowray.com/memories/timeline#d1980";

  it.each([
    ["#d1980", "d1980"],
    ["#d1990", "d1990"],
    ["/memories/timeline#d1980", "d1980"],
    ["https://www.jowray.com/memories/timeline#d1970", "d1970"],
    ["/memories/timeline?decade=1980#d1980", "d1980"],
  ])("opens the decade a same-page link %j points at, even when the hash is already current", (href, expected) => {
    expect(decadeFromLink(href, here, ids)).toBe(expected);
  });

  it.each([
    ["/memories#d1980", "another page"],
    ["https://example.com/memories/timeline#d1980", "another site"],
    ["#d2050", "no such decade"],
    ["#", "an empty fragment"],
    ["/memories/timeline", "no fragment"],
    ["#%E0%A4%A", "a malformed fragment"],
    ["http://[::1", "an unparsable href"],
  ])("ignores %j (%s)", (href) => {
    expect(decadeFromLink(href, here, ids)).toBeNull();
  });
});
