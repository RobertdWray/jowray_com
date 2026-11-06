import { z } from "zod";

import type { Coordinates } from "@/lib/validations/memory";

/**
 * Place types for photo GPS suggestions (plan 2026-11-06-photo-gps-places B4). Pure and browser-safe: the service
 * interface (services/places), its implementations (integrations/*) and the features all share them, and integrations
 * may import only types from services.
 */

const part = z.string().trim().max(500).optional();

/**
 * The parts of a reverse-geocode answer that are kept and cached (D5). Parsing with this schema IS the trimming: zod
 * drops every key it does not name, so a house number, road, postcode, display name or OSM id never survives. `lat`/
 * `lon` are the matched object's own point as the provider writes it (Nominatim: decimal strings) [C7].
 */
export const placeResultSchema = z.object({
  name: z.string().trim().max(500).nullish(),
  category: part,
  type: part,
  addresstype: part,
  lat: part,
  lon: part,
  address: z
    .object({
      city: part,
      town: part,
      village: part,
      hamlet: part,
      county: part,
      state: part,
      country: part,
      country_code: part,
    })
    .default({}),
});
export type PlaceResult = z.infer<typeof placeResultSchema>;

/**
 * A suggestion a person can tap (D4, D5). `landmark` is "name, town, region" for a named non-residential feature and
 * carries that feature's own point when the provider gave a valid one (D13); `town` is "town, region".
 */
export interface PlaceLabel {
  text: string;
  kind: "landmark" | "town";
  point?: Coordinates;
}
