import { z } from "zod";

import type { Coordinates } from "@/lib/validations/memory";

/**
 * The browser's call for place suggestions (plan 2026-11-06-photo-gps-places B6): POST /api/places/suggest with the
 * photo's point (a Route Handler, so lookups never queue behind Send, C15) and what each answer means for the card.
 *
 * `labels` is the list to offer (`[]`: looked up, nothing usable) or null for none. `report` is set only for an
 * outcome nobody expects (a network failure, a 5xx other than 503, an answer of the wrong shape), which the caller
 * sends to Sentry; the expected refusals (429 over a daily limit, 503 busy/disabled/refused, 400) stay quiet [C32].
 */
export type PlaceSuggestOutcome = { labels: string[]; report: null } | { labels: null; report: Error | null };

export const PLACE_SUGGEST_URL = "/api/places/suggest";

const answerSchema = z.object({ success: z.literal(true), data: z.object({ labels: z.array(z.string()), attribution: z.string() }) });
const QUIET_STATUSES = new Set([400, 429, 503]);

export async function requestPlaceLabels(point: Coordinates, fetchImpl: typeof fetch = fetch): Promise<PlaceSuggestOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(PLACE_SUGGEST_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ latitude: point.latitude, longitude: point.longitude }),
    });
  } catch (error) {
    return { labels: null, report: error instanceof Error ? error : new Error(String(error)) };
  }
  if (QUIET_STATUSES.has(response.status)) {
    return { labels: null, report: null };
  }
  if (!response.ok) {
    return { labels: null, report: new Error(`place suggestions answered ${response.status}`) };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { labels: null, report: new Error("place suggestions answered 200 with a body that is not JSON") };
  }
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) {
    return { labels: null, report: new Error("place suggestions answered 200 with an unexpected shape") };
  }
  return { labels: parsed.data.data.labels, report: null };
}
