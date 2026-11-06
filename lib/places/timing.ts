/**
 * The timing contract of place lookups (plan 2026-11-06-photo-gps-places D8), in one place so the numbers cannot
 * drift apart: the provider client's timeout, the lease and the spacing written in the throttle SQL, and the send
 * budget derived from them. Pure numbers, safe anywhere.
 */

/** How long one provider request may take; the Nominatim client aborts it then (integrations/nominatim/client.ts). */
export const PLACE_PROVIDER_TIMEOUT_MS = 5_000;

/** The lease's life, as the claim SQL writes it (`now() + interval '10 seconds'`, features/places/lookup-place.ts). */
export const PLACE_LEASE_MS = 10_000;

/** The spacing between real sends, as the fence SQL writes it (`now() + interval '1100 milliseconds'`). */
export const PLACE_SEND_SPACING_MS = 1_100;

/** Room for clock reads, the fence statement's own trip and scheduling. */
const PLACE_TIMING_MARGIN_MS = 900;

/**
 * How long after issuing its winning claim a holder may still start its send (3 s). A send started within it ends,
 * at the latest, at the provider timeout, and its fence is then issued at least spacing + margin (2 s) before the
 * lease runs out, so the fence lands on a lease still held and the next claim waits for it. A holder past the budget
 * (stalled on a slow database between claim and send) releases the lease and answers busy instead of sending.
 */
export const PLACE_SEND_BUDGET_MS = PLACE_LEASE_MS - PLACE_PROVIDER_TIMEOUT_MS - PLACE_SEND_SPACING_MS - PLACE_TIMING_MARGIN_MS;
