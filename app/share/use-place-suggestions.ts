import { useEffect, useRef, useState } from "react";

import { type CardsAction, gpsReadsDue, lookupsDue, type MemoryCard } from "@/lib/memory-cards";
import type * as PhotoGps from "@/lib/photo-gps";
import { requestPlaceLabels } from "@/lib/places/suggest-client";
import { createTaskLimiter, sharePerPoint } from "@/lib/places/suggest-queue";
import { reportClientError } from "@/lib/sentry/report";

/**
 * GPS reads at once. A photo with no usable metadata near its start (some WebP and HEIC files) is read whole, so several
 * picked together must not all pull their files at the same moment.
 */
const GPS_READ_CONCURRENCY = 2;
/** Lookups in flight at once; more wait their turn (each may wait on the site-wide provider slot). */
const LOOKUP_CONCURRENCY = 2;

/** A queued read or lookup that threw past its own handling: no suggestions for that photo, and Sentry hears of it. */
function reportQueueError(error: unknown): void {
  reportClientError(error, { surface: "share-form", step: "place_suggest", stage: "queue" });
}

/**
 * Place suggestions for the photos on the cards (plan 2026-11-06-photo-gps-places B6). Called once, by the share form,
 * which owns the cards' state.
 *
 * Each picked photo's GPS is read here, in the browser, only to suggest (D2): the point is never sent to be stored, and
 * the server reads the stored original for that. The parser is loaded on the first photo only [C14]. A photo with a
 * point is then looked up through POST /api/places/suggest. Reads and lookups each run two at a time, first in, first
 * out (`lib/places/suggest-queue.ts`); one whose photo was removed while it waited is skipped (no file read, no
 * request). A point is asked once while its request is in flight and its answer is kept for the page; a failed or
 * refused answer is not kept, so adding the photo again asks again. Results for a photo removed during its work are
 * dropped by the reducer. A restored draft holds no files, so nothing runs for it.
 *
 * Only unexpected outcomes are reported (a GPS read that failed, a network failure, a 5xx other than 503); the expected
 * refusals (over a daily limit, busy, turned off, refused, a 400) just mean no buttons [C32].
 */
export function usePlaceSuggestions(cards: ReadonlyArray<MemoryCard>, dispatch: React.Dispatch<CardsAction>): void {
  /** Work already queued, by media id and kind, so a re-render never queues it twice. */
  const started = useRef(new Set<string>());
  const parser = useRef<Promise<typeof PhotoGps> | null>(null);
  /** The cards as of the latest effect: queued work checks here that its photo still needs it. */
  const current = useRef(cards);
  const [queues] = useState(() => ({
    reads: createTaskLimiter(GPS_READ_CONCURRENCY, reportQueueError),
    lookups: createTaskLimiter(LOOKUP_CONCURRENCY, reportQueueError),
    labelsFor: sharePerPoint((point) =>
      requestPlaceLabels(point).then(({ labels, report }) => {
        if (report) {
          reportClientError(report, { surface: "share-form", step: "place_suggest", stage: "lookup" });
        }
        return labels;
      }),
    ),
  }));

  useEffect(() => {
    current.current = cards;

    for (const { cardId, item } of gpsReadsDue(cards)) {
      const key = `gps:${item.id}`;
      if (started.current.has(key)) {
        continue;
      }
      started.current.add(key);
      queues.reads.push(
        async () => {
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
        },
        () => gpsReadsDue(current.current).some((due) => due.item.id === item.id),
      );
    }

    for (const { cardId, item, point } of lookupsDue(cards)) {
      const key = `places:${item.id}`;
      if (started.current.has(key)) {
        continue;
      }
      started.current.add(key);
      queues.lookups.push(
        async () => {
          dispatch({ type: "setMediaPlaces", id: cardId, mediaId: item.id, labels: await queues.labelsFor(point) });
        },
        () => lookupsDue(current.current).some((due) => due.item.id === item.id),
      );
    }
  }, [cards, dispatch, queues]);
}
