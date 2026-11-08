import { describe, expect, it } from "vitest";

import { barHeight, clockText, countNoun, durationText, fakeBars, KIND_TEXT, memoriesText } from "@/lib/memories/format";

describe("memory wording", () => {
  it("uses singular only for one and accepts an irregular plural", () => {
    expect(countNoun(1, "photo")).toBe("1 photo");
    expect(countNoun(2, "photo")).toBe("2 photos");
    expect(countNoun(0, "child", "children")).toBe("0 children");
    expect(memoriesText(0)).toBe("0 memories");
    expect(memoriesText(1)).toBe("1 memory");
    expect(memoriesText(2)).toBe("2 memories");
  });

  it("provides the family-facing labels for all four kinds", () => {
    expect(KIND_TEXT).toEqual({
      PHOTO: { chip: "Photos", singular: "photo", plural: "photos", badge: "Photos", eyebrow: "A memory from" },
      VOICE: { chip: "Voices", singular: "voice", plural: "voices", badge: "A voice", eyebrow: "A voice memory from" },
      VIDEO: { chip: "Videos", singular: "video", plural: "videos", badge: "A video", eyebrow: "A video memory from" },
      TEXT: { chip: "Written", singular: "written memory", plural: "written memories", badge: "In writing", eyebrow: "A memory from" },
    });
  });
});

describe("durationText", () => {
  it.each([null, undefined, 0, -1, NaN, Infinity, -Infinity])("omits an unusable duration %s", (seconds) => {
    expect(durationText(seconds)).toBeNull();
  });

  it.each([[0.5, "0.5 sec"], [47, "47 sec"], [59, "59 sec"], [60, "1 min"], [89, "1 min"], [90, "2 min"], [233, "4 min"]])(
    "labels %s seconds as %s", (seconds, expected) => {
      expect(durationText(seconds)).toBe(expected);
    },
  );
});

describe("clockText", () => {
  it.each([[233, "3:53"], [0, "0:00"], [9, "0:09"], [60, "1:00"], [59.9, "0:59"], [3600, "60:00"], [-1, "0:00"], [NaN, "0:00"], [Infinity, "0:00"], [-Infinity, "0:00"]])(
    "formats %s seconds as %s", (seconds, expected) => {
      expect(clockText(seconds)).toBe(expected);
    },
  );
});

describe("fakeBars", () => {
  it("uses an unsigned FNV-1a seed and the specified bar sequence", () => {
    // FNV-1a('hello') = 0x4f9f2cab = 1335831723; FNV-1a('') = 2166136261.
    expect(fakeBars("hello", 5)).toEqual([39, 23, 29, 17, 27]);
    expect(fakeBars("", 3)).toEqual([25, 9, 15]);
    expect(fakeBars("hello", 5, 36, 10)).toEqual([37, 29, 43, 43, 29]);
  });

  it("is deterministic for an id and gives another id different decoration", () => {
    expect(fakeBars("memory-a", 40)).toEqual(fakeBars("memory-a", 40));
    expect(fakeBars("memory-a", 40)).not.toEqual(fakeBars("memory-b", 40));
    expect(fakeBars("memory-a", 0)).toEqual([]);
  });

  it("keeps every bar inside the requested pixel range", () => {
    const bars = fakeBars("a-long-memory-id", 1000, 56, 10);
    expect(bars).toHaveLength(1000);
    expect(bars.every((height) => Number.isInteger(height) && height >= 10 && height < 66)).toBe(true);
  });
});

describe("barHeight", () => {
  it.each([
    [0, 10, 100, 8, 2, 2], [-1, 10, 100, 8, 2, 2],
    [1, 100, 100, 8, 2, 8], [1, 3, 100, 8, 2, 33],
    [3, 3, 100, 8, 2, 100], [1, 0, 100, 8, 2, 100],
  ])("sizes count %s against maximum %s", (count, max, full, min, empty, expected) => {
    expect(barHeight(count, max, full, min, empty)).toBe(expected);
  });
});
