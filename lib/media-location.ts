import { ALLOWED_MIME_TYPES } from "@/lib/media-types";

/**
 * Stored types in an MP4-family container (ISO BMFF: MOV, MP4, M4A), whose location is read by
 * `readVideoLocation` from the `moov` metadata. Audio-only M4A uses the same container, so an iPhone
 * Voice Memo can carry a location just like a video (plan 2026-11-08 D16).
 */
export const MP4_CONTAINER_MIME_TYPES: readonly string[] = ["video/quicktime", "video/mp4", "audio/mp4", "audio/x-m4a"];

/** Canonical upload types with a location reader; also usable in database filters. */
export const LOCATION_READER_MIME_TYPES: readonly string[] = ALLOWED_MIME_TYPES.filter(
  (mimeType) => mimeType.startsWith("image/") || MP4_CONTAINER_MIME_TYPES.includes(mimeType),
);

/** Whether a stored original's type has a photo or MP4-container location reader. */
export function hasLocationReader(mimeType: string): boolean {
  return LOCATION_READER_MIME_TYPES.includes(mimeType);
}

/** Whether the location reader for this type is the MP4-container one (`readVideoLocation`), not a photo's EXIF. */
export function isMp4Container(mimeType: string): boolean {
  return MP4_CONTAINER_MIME_TYPES.includes(mimeType);
}
