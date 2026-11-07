import "server-only";

import { LIVE_MEDIA_ORDER } from "@/features/memories/media-state";
import { lookupPlace, PLACES_ATTRIBUTION } from "@/features/places/lookup-place";
import { LOCATION_READER_MIME_TYPES } from "@/lib/media-location";
import type { PlaceLabel } from "@/lib/places/types";
import { coordinatesOf, type Coordinates } from "@/lib/validations/memory";
import { getDb } from "@/server/db/client";

/** One lookup round's budget: the MCP route allows 30 s (`maxDuration`), and a started provider call may take 5 s more. */
const SUGGEST_DEADLINE_MS = 20_000;

export interface PhotoPlaces {
  mediaId: string;
  originalFilename: string | null;
  /** Where the camera was (the file's saved GPS), never to be proposed as the memory's coordinates (D13). */
  coordinates: Coordinates;
  /** Labels near that point; a landmark carries the matched place's own point, the only point fit to propose (D13). */
  labels: PlaceLabel[];
}

/** Keeps the existing `photos` wire key for both photos and videos. */
export type SuggestPlacesResult =
  | { ok: true; photos: PhotoPlaces[]; pending: string[]; attribution: string }
  | { ok: false; code: "not_found" | "disabled" | "daily_limit" | "provider_refused" };

/**
 * Place labels for the photos and videos of one memory, for the MCP `suggest_places` tool.
 *
 * It reads the memory's live, READY photos and supported videos with a saved point (read from the original, D2)
 * and asks lookupPlace once per unique point (degrees × 1e6), one at a time: the site-wide throttle spaces real sends
 * anyway, and repeated points are cache hits. There is no viewer key (the caller is Rob's connector, behind its
 * secret) and one deadline, 20 s from the start, covers every point.
 *
 * A point that came back `busy` or `failed` lists its files in `pending` (retryable; results are cached, so a second
 * call is cheap). `disabled`, `daily_limit` and `provider_refused` end the call with that code. A missing or
 * soft-deleted memory is `not_found`.
 */
export async function suggestPlacesForMemory(memoryId: string): Promise<SuggestPlacesResult> {
  const deadline = Date.now() + SUGGEST_DEADLINE_MS;
  const memory = await getDb().memory.findUnique({
    where: { id: memoryId },
    select: {
      deletedAt: true,
      media: {
        where: { deletedAt: null, status: "READY", mimeType: { in: [...LOCATION_READER_MIME_TYPES] }, latitude: { not: null }, longitude: { not: null } },
        select: { id: true, originalFilename: true, latitude: true, longitude: true },
        orderBy: [...LIVE_MEDIA_ORDER],
      },
    },
  });
  if (!memory || memory.deletedAt !== null) {
    return { ok: false, code: "not_found" };
  }

  // Files grouped by point, in display order of each point's first file.
  const byPoint = new Map<string, { point: Coordinates; media: Array<{ id: string; originalFilename: string | null }> }>();
  for (const item of memory.media) {
    const point = coordinatesOf(item);
    if (!point) {
      continue;
    }
    const key = `${Math.round(point.latitude * 1e6)},${Math.round(point.longitude * 1e6)}`;
    const group = byPoint.get(key) ?? { point, media: [] };
    group.media.push({ id: item.id, originalFilename: item.originalFilename });
    byPoint.set(key, group);
  }

  const labelsByMedia = new Map<string, PlaceLabel[]>();
  const pending: string[] = [];
  for (const { point, media } of byPoint.values()) {
    const result = await lookupPlace(point, { deadline });
    if (result.ok) {
      for (const item of media) {
        labelsByMedia.set(item.id, result.labels);
      }
    } else if (result.code === "disabled" || result.code === "daily_limit" || result.code === "provider_refused") {
      // These end the whole call: nothing to gain from trying again soon.
      return { ok: false, code: result.code };
    } else {
      // busy or failed: retryable. (rate_limited cannot happen here: there is no viewer key.)
      pending.push(...media.map((item) => item.id));
    }
  }

  const photos: PhotoPlaces[] = [];
  for (const item of memory.media) {
    const labels = labelsByMedia.get(item.id);
    const coordinates = coordinatesOf(item);
    if (labels && coordinates) {
      photos.push({ mediaId: item.id, originalFilename: item.originalFilename, coordinates, labels });
    }
  }
  return { ok: true, photos, pending, attribution: PLACES_ATTRIBUTION };
}
