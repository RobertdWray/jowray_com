/**
 * The two reverse geocoders behind services/places (plan 2026-11-06-photo-gps-places B4): the Nominatim client [C1, C5]
 * and the stub used in Preview and local runs. `fetch` is stubbed: no test ever reaches the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NOMINATIM_USER_AGENT, NominatimGeocoder } from "@/integrations/nominatim/client";
import { StubGeocoder } from "@/integrations/places-stub/client";
import { PlaceProviderRefusedError } from "@/lib/places/errors";
import { placeLabels } from "@/lib/places/label";

const LIBERTY = { latitude: 40.689247, longitude: -74.044502 };
const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("NominatimGeocoder", () => {
  const geocoder = new NominatimGeocoder("https://nominatim.openstreetmap.org");

  it("GETs /reverse as jsonv2 at zoom 18 with address details in English, the point at 6 dp, the identifying User-Agent, a 5 s timeout and no caching", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValueOnce(json({ category: "tourism", type: "attraction", name: "Statue of Liberty", lat: "40.689247", lon: "-74.044502", address: { city: "New York", state: "New York", country_code: "us" } }));
    await geocoder.reverse({ latitude: 40.68924712345, longitude: -74.0445 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=40.689247&lon=-74.044500&zoom=18&addressdetails=1&accept-language=en");
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("user-agent")).toBe("jowray.com family memorial (https://www.jowray.com; memories@jowray.com)");
    expect(NOMINATIM_USER_AGENT).toBe("jowray.com family memorial (https://www.jowray.com; memories@jowray.com)");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(5_000);
  });

  it("keeps a lookup URL's path (a self-hosted or proxied instance) and sends nothing but the point: no name, email, memory id or address", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Unable to geocode" }));
    await new NominatimGeocoder("https://geocoder.example.org/nominatim").reverse(LIBERTY);
    const [url, init] = fetchMock.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe("https://geocoder.example.org/nominatim/reverse");
    expect([...parsed.searchParams.keys()].sort()).toEqual(["accept-language", "addressdetails", "format", "lat", "lon", "zoom"]);
    expect(init?.body).toBeUndefined();
    expect([...new Headers(init?.headers).keys()].sort()).toEqual(["accept", "user-agent"]);
  });

  it("returns the trimmed result: never the house number, road or postcode", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        place_id: 1,
        category: "place",
        type: "house",
        addresstype: "place",
        name: "",
        display_name: "71, Via Guglielmo Marconi, Bologna, 40122, Italy",
        lat: "44.5015307",
        lon: "11.3398676",
        address: { house_number: "71", road: "Via Guglielmo Marconi", city: "Bologna", county: "Bologna", state: "Emilia-Romagna", postcode: "40122", country: "Italy", country_code: "it" },
      })
    );
    const result = await geocoder.reverse(LIBERTY);
    expect(result).toEqual({ name: "", category: "place", type: "house", addresstype: "place", lat: "44.5015307", lon: "11.3398676", address: { city: "Bologna", county: "Bologna", state: "Emilia-Romagna", country: "Italy", country_code: "it" } });
    expect(JSON.stringify(result)).not.toMatch(/house_number|road|postcode|Marconi|40122/);
  });

  it("answers null when the provider has no result for the point (its 200 `error` body)", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Unable to geocode" }));
    expect(await geocoder.reverse(LIBERTY)).toBeNull();
  });

  it.each([403, 429])("throws PlaceProviderRefusedError on %i, once (no retry)", async (status) => {
    fetchMock.mockResolvedValueOnce(json({ error: "blocked" }, status));
    const error = await geocoder.reverse(LIBERTY).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlaceProviderRefusedError);
    expect((error as PlaceProviderRefusedError).status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a sanitized error (no URL, no coordinates) for other statuses, network failures, timeouts and bodies that are not a result, once each", async () => {
    const failures: Array<() => Promise<Response>> = [
      async () => json({ error: "oops" }, 500),
      async () => new Response("<html>Bad gateway</html>", { status: 502 }),
      async () => {
        throw new TypeError("fetch failed: https://nominatim.openstreetmap.org/reverse?lat=40.689247&lon=-74.044502");
      },
      async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
      async () => new Response("not json", { status: 200 }),
      async () => json(["not", "an", "object"]),
      async () => json({ address: "not an object" }),
    ];
    for (const failure of failures) {
      fetchMock.mockReset();
      fetchMock.mockImplementationOnce(failure);
      const error = await geocoder.reverse(LIBERTY).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(PlaceProviderRefusedError);
      const text = `${(error as Error).message} ${String((error as Error).cause ?? "")}`;
      expect(text).toMatch(/^Nominatim/);
      expect(text).not.toMatch(/40\.68|74\.04|https?:\/\//);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });
});

describe("StubGeocoder", () => {
  it("answers one town label naming the point at 2 dp, with no network, so Preview and local checks show GPS arrived", async () => {
    const stub = new StubGeocoder();
    expect(stub.remote).toBe(false);
    const result = await stub.reverse(LIBERTY);
    expect(placeLabels(result)).toEqual([{ text: "Photo location found near 40.69, -74.04 (test)", kind: "town" }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is never confused with a real provider: it is not remote and names itself", () => {
    expect(new StubGeocoder().provider).toBe("stub");
    expect(new NominatimGeocoder("https://nominatim.openstreetmap.org")).toMatchObject({ provider: "nominatim", remote: true });
  });
});
