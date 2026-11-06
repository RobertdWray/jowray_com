/**
 * lib/places/suggest-client.ts (plan 2026-11-06-photo-gps-places B6): the browser's call to POST /api/places/suggest
 * and what each answer means for the card. Only unexpected outcomes are reported (network, a 5xx other than 503, a
 * malformed answer); the expected refusals (429, 503, 400) are quiet "no suggestions" [C32].
 */
import { describe, expect, it, vi } from "vitest";

import { requestPlaceLabels } from "@/lib/places/suggest-client";

const LIBERTY = { latitude: 40.689247, longitude: -74.044502 };

function answer(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

describe("requestPlaceLabels", () => {
  it("POSTs the point as JSON to /api/places/suggest and answers the labels of a 200", async () => {
    const fetchImpl = answer(200, { success: true, data: { labels: ["Statue of Liberty, New York, New York", "New York, New York"], attribution: "© OpenStreetMap contributors" } });
    expect(await requestPlaceLabels(LIBERTY, fetchImpl)).toEqual({ labels: ["Statue of Liberty, New York, New York", "New York, New York"], report: null });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(url).toBe("/api/places/suggest");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual(LIBERTY);
  });

  it("an empty list is a real answer: looked up, nothing usable", async () => {
    expect(await requestPlaceLabels(LIBERTY, answer(200, { success: true, data: { labels: [], attribution: "© OpenStreetMap contributors" } }))).toEqual({ labels: [], report: null });
  });

  it.each([
    { status: 429, code: "rate_limited" },
    { status: 429, code: "daily_limit" },
    { status: 503, code: "busy" },
    { status: 503, code: "disabled" },
    { status: 503, code: "provider_refused" },
    { status: 400, code: "invalid" },
  ])("$status $code: no suggestions, nothing reported", async ({ status, code }) => {
    expect(await requestPlaceLabels(LIBERTY, answer(status, { error: { code, message: "m" } }))).toEqual({ labels: null, report: null });
  });

  it.each([500, 502, 504])("%i: no suggestions, reported (with the status, never the point)", async (status) => {
    const outcome = await requestPlaceLabels(LIBERTY, answer(status, { error: { code: "failed", message: "m" } }));
    expect(outcome.labels).toBeNull();
    expect(outcome.report).toBeInstanceOf(Error);
    expect(outcome.report!.message).toContain(String(status));
    expect(outcome.report!.message).not.toMatch(/40\.68|74\.04/);
  });

  it("a network failure: no suggestions, the error reported as it is", async () => {
    const offline = new TypeError("Failed to fetch");
    const outcome = await requestPlaceLabels(LIBERTY, vi.fn(async () => Promise.reject(offline)));
    expect(outcome).toEqual({ labels: null, report: offline });
  });

  it.each([
    { name: "a body that is not JSON", body: "<html>gateway</html>" },
    { name: "a body of another shape", body: { success: true, data: { labels: "New York" } } },
    { name: "labels that are not text", body: { success: true, data: { labels: [1, 2], attribution: "x" } } },
  ])("a 200 with $name: no suggestions, reported", async ({ body }) => {
    const outcome = await requestPlaceLabels(LIBERTY, answer(200, body));
    expect(outcome.labels).toBeNull();
    expect(outcome.report).toBeInstanceOf(Error);
  });
});
