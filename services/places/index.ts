import "server-only";

import { NominatimGeocoder } from "@/integrations/nominatim/client";
import { StubGeocoder } from "@/integrations/places-stub/client";
import { getPlacesEnv } from "@/server/config/env";

import type { ReverseGeocoder } from "./types";

export type { PlaceLabel, PlaceResult, ReverseGeocoder } from "./types";

/**
 * The configured reverse geocoder, or null when place lookups are off (D7: `nominatim` in Production, `stub` in
 * Preview and local runs, `off` by default). Reads env on each call (memoized there); nothing happens at module scope.
 */
export function getReverseGeocoder(): ReverseGeocoder | null {
  const env = getPlacesEnv();
  switch (env.PLACES_PROVIDER) {
    case "nominatim":
      return new NominatimGeocoder(env.PLACES_LOOKUP_URL);
    case "stub":
      return new StubGeocoder();
    case "off":
      return null;
  }
}
