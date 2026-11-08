import { isMp4Container } from "@/lib/media-location";
import type { Playable } from "@/lib/memories/types";

/**
 * Which originals may be streamed to a public visitor as they are (plan
 * 2026-11-08 D16). Shared by `features/media/serve-media.ts` (the gate on
 * `/api/public-media`) and `features/memories/public.ts` (what the pages
 * offer), so the page never offers a file the route would refuse.
 *
 * - Recordings a browser makes (WebM, Ogg, WAV) and MP3 have no location
 *   reader and no location metadata a phone writes: they play.
 * - MP4-family files (MOV, MP4, M4A) can carry where they were recorded
 *   (`lib/video-gps.ts`): they play only when the location scan has decided,
 *   parsed the whole movie box and found none (`gpsCheckedAt` set,
 *   `gpsScanComplete` true, both coordinates null). A scan that stopped early
 *   (a limit, a malformed or unsupported box) or that ran before the flag
 *   existed is not proof, so that file waits (TCR round 1, B1-1). Until stripped
 *   copies exist (follow-up F1), a file with a location never plays publicly.
 * - Photos never stream their original: only the server-made copies, which
 *   carry no metadata.
 */
const LOCATION_FREE_TYPES: readonly string[] = ["audio/webm", "audio/ogg", "audio/wav", "audio/mpeg", "video/webm"];

export interface LocationFacts {
  mimeType: string;
  gpsCheckedAt: Date | null;
  /** Whether the MP4-family scan parsed the whole movie box; null for other types and for rows decided before it existed. */
  gpsScanComplete: boolean | null;
  latitude: number | null;
  longitude: number | null;
}

/** Whether this original may be streamed publicly as it is. */
export function originalPlayablePublicly(media: LocationFacts): boolean {
  if (LOCATION_FREE_TYPES.includes(media.mimeType)) {
    return true;
  }
  if (isMp4Container(media.mimeType)) {
    return media.gpsCheckedAt !== null && media.gpsScanComplete === true && media.latitude === null && media.longitude === null;
  }
  return false;
}

/** What the public pages may offer for one file: a photo needs its server-made copy; anything else follows `originalPlayablePublicly`. */
export function publicPlayability(media: LocationFacts & { webCopyReady: boolean }): Playable {
  if (media.mimeType.startsWith("image/")) {
    return media.webCopyReady ? "yes" : "waiting";
  }
  return originalPlayablePublicly(media) ? "yes" : "waiting";
}
