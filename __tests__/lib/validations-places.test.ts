import { describe, expect, it } from "vitest";

import { placeSuggestInputSchema } from "@/lib/validations/places";

describe("placeSuggestInputSchema (B5, C18)", () => {
  it("accepts WGS 84 degrees in range, including the equator and the prime meridian on their own", () => {
    for (const point of [{ latitude: 40.689247, longitude: -74.044502 }, { latitude: 90, longitude: 180 }, { latitude: -90, longitude: -180 }, { latitude: 0, longitude: 12.5 }, { latitude: 51.5, longitude: 0 }]) {
      expect(placeSuggestInputSchema.parse(point)).toEqual(point);
    }
  });

  it("refuses 0/0 (a camera with no fix, D12), out-of-range or non-finite values, strings, missing and extra keys", () => {
    for (const bad of [
      { latitude: 0, longitude: 0 },
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: -181 },
      { latitude: Number.NaN, longitude: 1 },
      { latitude: Number.POSITIVE_INFINITY, longitude: 1 },
      { latitude: "40", longitude: "-74" },
      { latitude: 40 },
      { latitude: 40, longitude: -74, extra: true },
      null,
      [40, -74],
    ]) {
      expect(placeSuggestInputSchema.safeParse(bad).success).toBe(false);
    }
  });
});
