import type { PlaceResult } from "@/lib/places/types";
import type { Coordinates } from "@/lib/validations/memory";

export type { PlaceLabel, PlaceResult } from "@/lib/places/types";

/**
 * A reverse geocoder: a point in, the trimmed result for the closest named object out (null when the provider has
 * none). Implementations live in integrations/; `PLACES_PROVIDER` chooses one (services/places/index.ts) so the
 * provider can be switched or stopped by config (plan 2026-11-06-photo-gps-places, C2, F4).
 */
export interface ReverseGeocoder {
  /** The key of this provider's throttle row and cache rows ("nominatim"). */
  readonly provider: string;
  /** False for the stub: answered in-process, so it is never throttled, counted or cached. */
  readonly remote: boolean;
  /**
   * The provider's answer for `point`, sent with nothing but the point (D6). Throws PlaceProviderRefusedError
   * (lib/places/errors.ts) on a refusal; any other failure throws an error that carries neither the URL nor the point.
   */
  reverse(point: Coordinates): Promise<PlaceResult | null>;
}
