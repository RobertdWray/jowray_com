/**
 * The place provider refused the request (HTTP 403, 429 or 509): blocked, over its rate limit, or over its bandwidth
 * limit. Not retryable soon, and a sign the usage policy needs a look, so the lookup reports it as a Sentry warning and
 * answers `provider_refused`.
 *
 * Lives in lib/ because both the service interface (services/places) and its implementation (integrations/nominatim)
 * use it at runtime, and integrations may import only types from services (as lib/image-derive-error.ts).
 */
export class PlaceProviderRefusedError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`place provider refused the request (HTTP ${status})`);
    this.name = "PlaceProviderRefusedError";
    this.status = status;
  }
}

export function isPlaceProviderRefusedError(error: unknown): error is PlaceProviderRefusedError {
  return error instanceof PlaceProviderRefusedError;
}
