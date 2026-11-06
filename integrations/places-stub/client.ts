import "server-only";

import type { PlaceResult } from "@/lib/places/types";
import type { Coordinates } from "@/lib/validations/memory";
import type { ReverseGeocoder } from "@/services/places/types";

/**
 * The place provider for Preview deployments and local runs (`PLACES_PROVIDER=stub`, D7): no network, one town label
 * naming the point at 2 dp, so a device check shows whether a photo's GPS arrived without calling Nominatim.
 */
export class StubGeocoder implements ReverseGeocoder {
  readonly provider = "stub";
  readonly remote = false;

  async reverse(point: Coordinates): Promise<PlaceResult> {
    // The label builder turns a lone locality into a town label of exactly this text.
    return { address: { city: `Photo location found near ${point.latitude.toFixed(2)}, ${point.longitude.toFixed(2)} (test)` } };
  }
}
