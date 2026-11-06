import { type NextRequest, NextResponse } from "next/server";

import { secondsUntilNextUtcDay, viewerKeyFrom } from "@/features/media/egress";
import { lookupPlace, type PlaceLookupCode } from "@/features/places/lookup-place";
import { placeSuggestInputSchema } from "@/lib/validations/places";

/** The lookup's own deadline is 20 s; the provider call it may start is bounded at 5 s. */
export const maxDuration = 30;

const LOOKUP_DEADLINE_MS = 20_000;

/** Each lookup outcome as an HTTP answer: 429 for the daily limits, 503 for "not now / not here", 502 for a failure. */
const REFUSALS: Record<PlaceLookupCode, { status: number; message: string }> = {
  rate_limited: { status: 429, message: "Too many place lookups from here today" },
  daily_limit: { status: 429, message: "Place lookups are used up for today" },
  busy: { status: 503, message: "Place lookups are busy; try again shortly" },
  disabled: { status: 503, message: "Place lookups are turned off" },
  provider_refused: { status: 503, message: "The place service is not answering us right now" },
  failed: { status: 502, message: "The place lookup failed; try again" },
};

/**
 * Place names near a photo's point, for the "Where" buttons on /share (plan 2026-11-06-photo-gps-places B5).
 *
 * A Route Handler, not a Server Function: Server Actions run one at a time per client, and a lookup waiting for the
 * provider's slot must never hold up Send [C15]. The point travels in a POST body, so it stays out of URLs and logs
 * [C17]. Like any server endpoint it is public [C16]; lookupPlace's per-viewer and site-wide daily counters are its guard.
 *
 * Body `{ latitude, longitude }`. Answers `{ success: true, data: { labels, attribution } }` (each label's text only:
 * a landmark's own point is for the MCP path), or `{ error: { code, message } }` with 400 `invalid`, 429
 * `rate_limited` / `daily_limit` (with Retry-After), 503 `busy` / `disabled` / `provider_refused`, or 502 `failed`.
 */
export async function POST(request: NextRequest): Promise<Response> {
  // Request-time reads first (Cache Components), then the lookup. A body that is not JSON is a 400, never an error
  // report, and it is never logged: it would carry the point.
  const viewerKey = viewerKeyFrom(request.headers);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refuse(400, "invalid", "The body must be JSON");
  }
  const parsed = placeSuggestInputSchema.safeParse(body);
  if (!parsed.success) {
    return refuse(400, "invalid", "Send { latitude, longitude } in WGS 84 degrees (not 0, 0)");
  }

  const now = Date.now();
  const result = await lookupPlace(parsed.data, { viewerKey, deadline: now + LOOKUP_DEADLINE_MS });
  if (result.ok) {
    return NextResponse.json({ success: true, data: { labels: result.labels.map((label) => label.text), attribution: result.attribution } });
  }
  const { status, message } = REFUSALS[result.code];
  const headers = status === 429 ? { "Retry-After": String(secondsUntilNextUtcDay(new Date(now))) } : undefined;
  return refuse(status, result.code, message, headers);
}

function refuse(status: number, code: string, message: string, headers?: Record<string, string>): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}
