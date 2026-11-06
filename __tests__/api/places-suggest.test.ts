/**
 * POST /api/places/suggest (plan 2026-11-06-photo-gps-places B5): a public Route Handler, not a Server Function
 * [C15, C16], whose guard is lookupPlace's counters. Body `{ latitude, longitude }` (PR #60's coordinatesSchema, 0/0
 * refused); answers `{ success, data: { labels: string[], attribution } }` or `{ error: { code, message } }` with
 * 400 / 429 / 503 / 502. lookupPlace is mocked here; its own behaviour is __tests__/features/lookup-place.test.ts.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaceLookupResult } from "@/features/places/lookup-place";
import type { Coordinates } from "@/lib/validations/memory";

const lookupPlaceMock = vi.fn(async (_point: Coordinates, _options: { viewerKey?: string; deadline: number }): Promise<PlaceLookupResult> => ({
  ok: true,
  labels: [
    { text: "Statue of Liberty, New York, New York", kind: "landmark", point: { latitude: 40.689247, longitude: -74.044502 } },
    { text: "New York, New York", kind: "town" },
  ],
  attribution: "© OpenStreetMap contributors",
}));
vi.mock("@/features/places/lookup-place", () => ({ lookupPlace: (point: Coordinates, options: { viewerKey?: string; deadline: number }) => lookupPlaceMock(point, options) }));

import { maxDuration, POST } from "@/app/api/places/suggest/route";

const LIBERTY = { latitude: 40.689247, longitude: -74.044502 };

function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
  return POST(new NextRequest("http://localhost:3000/api/places/suggest", { method: "POST", body, headers: { "content-type": "application/json", ...headers } }));
}

beforeEach(() => {
  lookupPlaceMock.mockClear();
});

describe("POST /api/places/suggest", () => {
  it("answers the labels' text and the OSM credit; the landmark's own point stays on the server", async () => {
    const res = await post(JSON.stringify(LIBERTY), { "x-real-ip": "203.0.113.7" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { labels: ["Statue of Liberty, New York, New York", "New York, New York"], attribution: "© OpenStreetMap contributors" } });
  });

  it("looks the point up for this viewer (the client address Vercel reports) with a deadline 20 s from now", async () => {
    const before = Date.now();
    await post(JSON.stringify(LIBERTY), { "x-forwarded-for": "198.51.100.4, 10.0.0.1" });
    const after = Date.now();
    expect(lookupPlaceMock).toHaveBeenCalledTimes(1);
    const [point, options] = lookupPlaceMock.mock.calls[0]!;
    expect(point).toEqual(LIBERTY);
    expect(options.viewerKey).toBe("198.51.100.4");
    expect(options.deadline).toBeGreaterThanOrEqual(before + 20_000);
    expect(options.deadline).toBeLessThanOrEqual(after + 20_000);
  });

  it("counts a request without address headers as the shared `unknown` viewer (still counted, never unguarded)", async () => {
    await post(JSON.stringify(LIBERTY));
    expect(lookupPlaceMock.mock.calls[0]![1].viewerKey).toBe("unknown");
  });

  it("allows up to the route's 30 s, above the lookup's 20 s deadline plus the provider's 5 s timeout", () => {
    expect(maxDuration).toBe(30);
  });

  it.each([
    { code: "rate_limited", status: 429 },
    { code: "daily_limit", status: 429 },
    { code: "busy", status: 503 },
    { code: "disabled", status: 503 },
    { code: "provider_refused", status: 503 },
    { code: "failed", status: 502 },
  ] as const)("maps $code to $status with { error: { code, message } }", async ({ code, status }) => {
    lookupPlaceMock.mockResolvedValueOnce({ ok: false, code });
    const res = await post(JSON.stringify(LIBERTY));
    expect(res.status).toBe(status);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body).toEqual({ error: { code, message: expect.any(String) } });
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it("tells a client over a daily limit when the counters roll over (Retry-After, seconds to the next UTC day)", async () => {
    for (const code of ["rate_limited", "daily_limit"] as const) {
      lookupPlaceMock.mockResolvedValueOnce({ ok: false, code });
      const res = await post(JSON.stringify(LIBERTY));
      const seconds = Number(res.headers.get("retry-after"));
      expect(seconds).toBeGreaterThanOrEqual(1);
      expect(seconds).toBeLessThanOrEqual(24 * 60 * 60);
    }
    lookupPlaceMock.mockResolvedValueOnce({ ok: false, code: "busy" });
    expect((await post(JSON.stringify(LIBERTY))).headers.get("retry-after")).toBeNull();
  });

  it.each([
    { name: "not JSON", body: "not json" },
    { name: "an empty body", body: "" },
    { name: "truncated JSON", body: '{"latitude": 40.6' },
  ])("answers 400 invalid for a malformed body ($name) and never looks anything up", async ({ body }) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "invalid", message: "The body must be JSON" } });
    expect(lookupPlaceMock).not.toHaveBeenCalled();
  });

  it.each([
    { name: "JSON that is not an object", body: [40.689247, -74.044502] },
    { name: "a missing longitude", body: { latitude: 40.689247 } },
    { name: "coordinates as strings", body: { latitude: "40.689247", longitude: "-74.044502" } },
    { name: "a latitude over 90", body: { latitude: 90.5, longitude: 0.5 } },
    { name: "a longitude under -180", body: { latitude: 0.5, longitude: -180.5 } },
    { name: "0/0 (no GPS fix)", body: { latitude: 0, longitude: 0 } },
    { name: "an extra key (the schema is strict)", body: { ...LIBERTY, mediaId: "med_1" } },
    { name: "null", body: null },
  ])("answers 400 invalid for $name, without echoing the body, and never looks anything up", async ({ body }) => {
    const res = await post(JSON.stringify(body));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe("invalid");
    expect(JSON.stringify(json)).not.toMatch(/40\.68|74\.04|90\.5|180\.5|med_1/);
    expect(lookupPlaceMock).not.toHaveBeenCalled();
  });
});
