export type ImageDeriveErrorCode =
  | "too_many_pixels"
  | "decode_failed"
  | "timeout"
  | "busy"
  | "too_large"
  | "unsupported_type";

/**
 * Why a derived copy could not be made. Lives in lib/ because both the image
 * service interface (services/) and its implementation (integrations/) use it
 * at runtime, and integrations may import only types from services.
 * `too_many_pixels` carries the ceiling that was in force so a later, higher
 * ceiling can retry the row. `busy` means the decode slot's waiting line was
 * full: nothing was read or decoded, and the caller leaves the work to the
 * cron. `too_many_frames` is terminal: the animation is over the frame cap.
 */
export class ImageDeriveError extends Error {
  readonly code: ImageDeriveErrorCode;
  readonly limit: number | undefined;

  constructor(code: ImageDeriveErrorCode, options?: { limit?: number; cause?: unknown }) {
    super(code, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ImageDeriveError";
    this.code = code;
    this.limit = options?.limit;
  }
}

export function isImageDeriveError(error: unknown): error is ImageDeriveError {
  return error instanceof ImageDeriveError;
}
