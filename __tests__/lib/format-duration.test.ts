import { describe, expect, it } from "vitest";

import { durationSecondsFor, formatDuration } from "@/lib/format-duration";

describe("formatDuration", () => {
  it.each([
    [0, "0:00"],
    [42_000, "0:42"],
    [605_000, "10:05"],
    [59_999, "0:59"],
    [60_000, "1:00"],
    [3_600_000, "60:00"],
  ])("formats %i ms as %s without rounding up or capping minutes", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it.each([-1_000, NaN, Infinity, -Infinity])("formats invalid duration %s as 0:00", (ms) => {
    expect(formatDuration(ms)).toBe("0:00");
  });
});

describe("durationSecondsFor", () => {
  it.each([
    [1, 1],
    [199, 1],
    [400, 1],
    [499, 1],
    [500, 1],
    [999, 1],
    [1000, 1],
    [24_400, 24],
  ])("stores %i ms as %i seconds without losing short clips", (ms, expected) => {
    expect(durationSecondsFor(ms)).toBe(expected);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])("omits invalid duration %s", (ms) => {
    expect(durationSecondsFor(ms)).toBeUndefined();
  });
});
