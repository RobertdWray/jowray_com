import type { z } from "zod";

import { coordinatesSchema } from "@/lib/validations/memory";

/**
 * Body of POST /api/places/suggest (plan 2026-11-06-photo-gps-places B5): the photo's point, as PR #60's
 * coordinatesSchema (finite WGS 84 degrees in range, strict) with 0/0 refused, the placeholder some cameras write when
 * they have no fix (D12). The equator or the prime meridian alone is a real place.
 */
export const placeSuggestInputSchema = coordinatesSchema.refine((point) => !(point.latitude === 0 && point.longitude === 0), {
  message: "0, 0 is not a photo location",
});
export type PlaceSuggestInput = z.infer<typeof placeSuggestInputSchema>;
