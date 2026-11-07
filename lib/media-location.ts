import { ALLOWED_MIME_TYPES } from "@/lib/media-types";

/** Canonical upload types with a location reader; also usable in database filters. */
export const LOCATION_READER_MIME_TYPES: readonly string[] = ALLOWED_MIME_TYPES.filter(
  (mimeType) => mimeType.startsWith("image/") || mimeType === "video/quicktime" || mimeType === "video/mp4",
);

/** Whether a stored original's type has a photo or video location reader. */
export function hasLocationReader(mimeType: string): boolean {
  return LOCATION_READER_MIME_TYPES.includes(mimeType);
}
