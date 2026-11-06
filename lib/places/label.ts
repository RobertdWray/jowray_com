import { coordinatesSchema } from "@/lib/validations/memory";

import type { PlaceLabel, PlaceResult } from "./types";

/** The Where field's maximum (lib/validations/memory.ts); a longer label could not be saved, so it is not offered. */
export const MAX_LABEL_LENGTH = 200;

/** OSM categories whose named features may be offered as landmarks: parks, beaches, museums, airports, rivers… */
const LANDMARK_CATEGORIES = new Set(["amenity", "tourism", "leisure", "historic", "natural", "waterway", "aeroway"]);
/** Within `place` and `boundary`, only these types are landmarks (a city or an admin boundary is a town, not a sight). */
const LANDMARK_TYPES: Record<string, ReadonlySet<string>> = {
  place: new Set(["island", "islet", "square"]),
  boundary: new Set(["national_park", "protected_area"]),
};
/** Never a landmark, whatever the category: a home is not a place to name (D5). */
const RESIDENTIAL = new Set(["building", "house", "residential", "apartments"]);

const clean = (value: string | null | undefined): string => value?.trim() ?? "";
const join = (parts: string[]): string => parts.filter((p) => p.length > 0).join(", ");

/**
 * Suggestions for one reverse-geocode result (D5): a landmark label first when the result is a named non-residential
 * feature, then the town label. Never a house number, road or postcode: only the name, the locality and the region
 * are used, and the cached result holds nothing else. Labels over 200 characters are dropped; no locality, no labels.
 */
export function placeLabels(result: PlaceResult | null): PlaceLabel[] {
  if (result === null) {
    return [];
  }
  const { address } = result;
  const locality = [address.city, address.town, address.village, address.hamlet, address.county].map(clean).find((p) => p.length > 0) ?? "";
  if (locality.length === 0) {
    return [];
  }
  const countryCode = clean(address.country_code).toLowerCase();
  const region = join([clean(address.state), countryCode === "us" ? "" : clean(address.country)]);

  const labels: PlaceLabel[] = [];
  const name = clean(result.name);
  if (isLandmark(result, name, locality)) {
    const point = ownPoint(result);
    labels.push({ text: join([name, locality, region]), kind: "landmark", ...(point && { point }) });
  }
  labels.push({ text: join([locality, region]), kind: "town" });
  return labels.filter((label) => label.text.length <= MAX_LABEL_LENGTH);
}

/** The matched feature's own point [C7], or undefined when the provider gave none or an unusable one (blank, NaN, out of range). */
function ownPoint(result: PlaceResult): PlaceLabel["point"] {
  const lat = clean(result.lat);
  const lon = clean(result.lon);
  if (lat.length === 0 || lon.length === 0) {
    return undefined;
  }
  const parsed = coordinatesSchema.safeParse({ latitude: Number(lat), longitude: Number(lon) });
  return parsed.success ? parsed.data : undefined;
}

function isLandmark(result: PlaceResult, name: string, locality: string): boolean {
  if (name.length === 0 || name.toLowerCase() === locality.toLowerCase()) {
    return false;
  }
  const category = clean(result.category);
  const type = clean(result.type);
  if ([category, type, clean(result.addresstype)].some((value) => RESIDENTIAL.has(value))) {
    return false;
  }
  return LANDMARK_CATEGORIES.has(category) || (LANDMARK_TYPES[category]?.has(type) ?? false);
}
