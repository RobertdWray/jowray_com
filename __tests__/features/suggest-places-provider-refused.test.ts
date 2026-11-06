/**
 * A provider refusal ends the MCP `suggest_places` call (Team Code Review #3/#8), end to end: the real
 * NominatimGeocoder (fetch stubbed, so no test reaches the network), the real lookupPlace over the in-memory places
 * database (__tests__/helpers/places-fake-db.ts), and suggestPlacesForMemory. A refusal answers `provider_refused`
 * after one request, as a Sentry warning, and is never listed in `pending` for the caller to retry. 509 ("Bandwidth
 * Limit Exceeded") is what OSM ops answered during the February 2026 anti-scraper measures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as EnvModule from "@/server/config/env";

import { createFakePlacesDb, type FakePlacesDb } from "../helpers/places-fake-db";

const MEM = "00000000-0000-4000-8000-000000000001";
const LIBERTY = { latitude: 40.689247, longitude: -74.044502 };
const BOLOGNA = { latitude: 44.50155, longitude: 11.33989 };

const captureExceptionMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureExceptionMock(...a), flush: vi.fn(async () => true) }));

let fake: FakePlacesDb;
const memory = {
  deletedAt: null,
  media: [
    { id: "med_1", originalFilename: "liberty.jpg", ...LIBERTY },
    { id: "med_2", originalFilename: "bologna.jpg", ...BOLOGNA },
  ],
};
vi.mock("@/server/db/client", () => ({ getDb: () => ({ ...fake.db, memory: { findUnique: async () => memory } }) }));
vi.mock("@/server/config/env", async (importOriginal) => ({
  ...(await importOriginal<typeof EnvModule>()),
  getPlacesEnv: () => ({
    PLACES_PROVIDER: "nominatim",
    PLACES_LOOKUP_URL: "https://nominatim.openstreetmap.org",
    PLACES_DAILY_PROVIDER_CALLS: 500,
    PLACES_VIEWER_DAILY_REQUESTS: 60,
  }),
}));

import { suggestPlacesForMemory } from "@/features/places/suggest-for-memory";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fake = createFakePlacesDb();
  captureExceptionMock.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("suggest_places when Nominatim refuses", () => {
  it.each([403, 429, 509])("HTTP %i ends the call with provider_refused after one request, as a Sentry warning, and nothing is pending or cached", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "refused" }), { status, headers: { "content-type": "application/json" } }));

    expect(await suggestPlacesForMemory(MEM)).toEqual({ ok: false, code: "provider_refused" });

    expect(fetchMock).toHaveBeenCalledTimes(1); // the second photo's point is never asked for
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock.mock.calls[0]![1]).toMatchObject({ level: "warning", tags: { step: "place_lookup", provider: "nominatim" } });
    expect(fake.cache.size).toBe(0);
    // The send happened, so the fence moved next-allowed and released the lease.
    expect(fake.log.map((entry) => entry.kind)).toContain("fence");
    expect(fake.throttle.get("nominatim")?.leaseToken).toBeNull();
  });
});
