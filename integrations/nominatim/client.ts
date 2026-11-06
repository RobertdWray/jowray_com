import "server-only";

import { PlaceProviderRefusedError } from "@/lib/places/errors";
import { PLACE_PROVIDER_TIMEOUT_MS } from "@/lib/places/timing";
import { type PlaceResult, placeResultSchema } from "@/lib/places/types";
import type { Coordinates } from "@/lib/validations/memory";
import type { ReverseGeocoder } from "@/services/places/types";

/** Identifies the application, as the usage policy requires; a stock HTTP-library User-Agent "will not do" [C1]. */
export const NOMINATIM_USER_AGENT = "jowray.com family memorial (https://www.jowray.com; memories@jowray.com)";

/**
 * Answers that mean "stop asking", not "try again": 403 (blocked), 429 (over the rate limit) and 509 (Bandwidth Limit
 * Exceeded, which OSM ops answered during the February 2026 anti-scraper measures; Team Code Review #3/#8).
 */
const REFUSED_STATUSES: ReadonlySet<number> = new Set([403, 429, 509]);

/**
 * OpenStreetMap Nominatim's reverse endpoint (R2, C5): `GET {base}/reverse?format=jsonv2&lat=…&lon=…&zoom=18&
 * addressdetails=1&accept-language=en`, the point at 6 dp (D6, R5) and nothing about the person. This file sets two
 * headers, the identifying User-Agent and Accept; in production the server's Sentry instrumentation also adds its
 * tracing headers (`sentry-trace`, `baggage`: trace id, release, environment, public key, org id, transaction name;
 * no personal data), because the server init sets no `tracePropagationTargets`. One attempt, aborted after
 * PLACE_PROVIDER_TIMEOUT_MS, while the caller holds the site-wide lease; no retries. The answer is trimmed to
 * `PlaceResult` before it leaves this file. Errors never carry the URL or the point.
 */
export class NominatimGeocoder implements ReverseGeocoder {
  readonly provider = "nominatim";
  readonly remote = true;

  /** `baseUrl` is PLACES_LOOKUP_URL without a trailing slash; a path (a proxy or a self-hosted instance) is kept. */
  constructor(private readonly baseUrl: string) {}

  async reverse(point: Coordinates): Promise<PlaceResult | null> {
    const url = new URL(`${this.baseUrl}/reverse`);
    url.search = new URLSearchParams({
      format: "jsonv2",
      lat: point.latitude.toFixed(6),
      lon: point.longitude.toFixed(6),
      zoom: "18",
      addressdetails: "1",
      "accept-language": "en",
    }).toString();

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": NOMINATIM_USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(PLACE_PROVIDER_TIMEOUT_MS),
        // Our database is the cache (PlaceLookup); every call that gets here must reach the provider.
        cache: "no-store",
      });
    } catch (error) {
      throw sanitized("request failed", error);
    }
    if (REFUSED_STATUSES.has(response.status)) {
      throw new PlaceProviderRefusedError(response.status);
    }
    if (!response.ok) {
      throw new Error(`Nominatim answered ${response.status}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw sanitized("answered with a body that is not JSON", error);
    }
    // "Unable to geocode" arrives as a 200 with an `error` member: the provider has nothing near this point.
    if (body !== null && typeof body === "object" && !Array.isArray(body) && "error" in body) {
      return null;
    }
    const parsed = placeResultSchema.safeParse(body);
    if (!parsed.success) {
      throw new Error("Nominatim answered with an unexpected shape");
    }
    return parsed.data;
  }
}

/**
 * A plain error naming only what failed and the underlying error's type. The fetch layer's own messages can quote the
 * request URL, which holds the point (pattern: integrations/sendgrid's sanitizeError).
 */
function sanitized(what: string, error: unknown): Error {
  const kind = error instanceof Error ? error.name : typeof error;
  return new Error(`Nominatim ${what} (${kind})`);
}
