import { useEffect, useRef } from "react";

import { type CardsAction, gpsReadsDue, lookupsDue, type MemoryCard } from "@/lib/memory-cards";
import type * as PhotoGps from "@/lib/photo-gps";
import { requestPlaceLabels } from "@/lib/places/suggest-client";
import { reportClientError } from "@/lib/sentry/report";
import type { Coordinates } from "@/lib/validations/memory";

/** Lookups in flight at once; more wait their turn (each may wait on the site-wide provider slot). */
const LOOKUP_CONCURRENCY = 2;

/**
 * Place suggestions for the photos on the cards (plan 2026-11-06-photo-gps-places B6). Called once, by the share form,
 * which owns the cards' state.
 *
 * Each picked photo's GPS is read here, in the browser, only to suggest (D2): the point is never sent to be stored, and
 * the server reads the stored original for that. The parser is loaded on the first photo only [C14]. A photo with a
 * point is then looked up through POST /api/places/suggest, two at a time, the same point once per page; results for a
 * photo removed meanwhile are dropped by the reducer. A restored draft holds no files, so nothing runs for it.
 *
 * Only unexpected outcomes are reported (a GPS read that failed, a network failure, a 5xx other than 503); the expected
 * refusals (over a daily limit, busy, turned off, refused, a 400) just mean no buttons [C32].
 */
export function usePlaceSuggestions(cards: ReadonlyArray<MemoryCard>, dispatch: React.Dispatch<CardsAction>): void {
  /** Work already started, by media id and kind, so a re-render never starts it twice. */
  const started = useRef(new Set<string>());
  const parser = useRef<Promise<typeof PhotoGps> | null>(null);
  /** One request per point (degrees × 1e6) per page: two photos taken at the same spot share the answer. */
  const byPoint = useRef(new Map<string, Promise<string[] | null>>());
  const queue = useRef<Array<() => Promise<void>>>([]);
  const running = useRef(0);

  useEffect(() => {
    const pump = () => {
      while (running.current < LOOKUP_CONCURRENCY && queue.current.length > 0) {
        const task = queue.current.shift()!;
        running.current += 1;
        void task().finally(() => {
          running.current -= 1;
          pump();
        });
      }
    };
    const labelsFor = (point: Coordinates): Promise<string[] | null> => {
      const key = `${Math.round(point.latitude * 1e6)},${Math.round(point.longitude * 1e6)}`;
      let pending = byPoint.current.get(key);
      if (!pending) {
        pending = requestPlaceLabels(point).then(({ labels, report }) => {
          if (report) {
            reportClientError(report, { surface: "share-form", step: "place_suggest", stage: "lookup" });
          }
          return labels;
        });
        byPoint.current.set(key, pending);
      }
      return pending;
    };

    for (const { cardId, item } of gpsReadsDue(cards)) {
      const key = `gps:${item.id}`;
      if (started.current.has(key)) {
        continue;
      }
      started.current.add(key);
      void (async () => {
        try {
          parser.current ??= import("@/lib/photo-gps");
          const read = await (await parser.current).readGpsFromFile(item.file);
          if (read.status === "failed") {
            reportClientError(read.error, { surface: "share-form", step: "place_suggest", stage: "gps_read" });
          }
          dispatch({ type: "setMediaGps", id: cardId, mediaId: item.id, gps: read.status === "found" ? read.coordinates : null });
        } catch (error) {
          // The parser itself could not load (a network blip fetching the chunk): no suggestions for this photo.
          parser.current = null;
          reportClientError(error, { surface: "share-form", step: "place_suggest", stage: "gps_parser" });
          dispatch({ type: "setMediaGps", id: cardId, mediaId: item.id, gps: null });
        }
      })();
    }

    for (const { cardId, item, point } of lookupsDue(cards)) {
      const key = `places:${item.id}`;
      if (started.current.has(key)) {
        continue;
      }
      started.current.add(key);
      queue.current.push(async () => {
        dispatch({ type: "setMediaPlaces", id: cardId, mediaId: item.id, labels: await labelsFor(point) });
      });
    }
    pump();
  }, [cards, dispatch]);
}
