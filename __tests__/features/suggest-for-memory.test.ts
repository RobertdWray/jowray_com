/**
 * features/places/suggest-for-memory.ts (plan 2026-11-06-photo-gps-places B7): place labels for the photos of one
 * memory, for the MCP `suggest_places` tool. lookupPlace is mocked (its behaviour is lookup-place.test.ts); the database
 * is a stub that records the query.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as LookupModule from "@/features/places/lookup-place";
import type { PlaceLookupOptions, PlaceLookupResult } from "@/features/places/lookup-place";
import type { PlaceLabel } from "@/lib/places/types";
import type { Coordinates } from "@/lib/validations/memory";

const MEM = "00000000-0000-4000-8000-000000000001";
const LIBERTY = { latitude: 40.689247, longitude: -74.044502 };
const LANDMARK: PlaceLabel = { text: "Statue of Liberty, New York, New York", kind: "landmark", point: { latitude: 40.6892532, longitude: -74.0445482 } };
const TOWN: PlaceLabel = { text: "New York, New York", kind: "town" };

interface MediaRow {
  id: string;
  originalFilename: string | null;
  latitude: number;
  longitude: number;
}
let memory: { deletedAt: Date | null; media: MediaRow[] } | null = null;
const findUnique = vi.fn(async (_args: unknown) => memory);
vi.mock("@/server/db/client", () => ({ getDb: () => ({ memory: { findUnique } }) }));

const lookupMock = vi.fn(async (_point: Coordinates, _options: PlaceLookupOptions): Promise<PlaceLookupResult> => ({ ok: true, labels: [LANDMARK, TOWN], attribution: "© OpenStreetMap contributors" }));
vi.mock("@/features/places/lookup-place", async (importOriginal) => {
  const actual = await importOriginal<typeof LookupModule>();
  return { ...actual, lookupPlace: (point: Coordinates, options: PlaceLookupOptions) => lookupMock(point, options) };
});

import { suggestPlacesForMemory } from "@/features/places/suggest-for-memory";

const photo = (id: string, point: Coordinates, originalFilename: string | null = `${id}.jpg`): MediaRow => ({ id, originalFilename, latitude: point.latitude, longitude: point.longitude });

beforeEach(() => {
  memory = { deletedAt: null, media: [photo("med_1", LIBERTY)] };
  findUnique.mockClear();
  lookupMock.mockReset();
  lookupMock.mockImplementation(async () => ({ ok: true, labels: [LANDMARK, TOWN], attribution: "© OpenStreetMap contributors" }));
});

describe("suggestPlacesForMemory", () => {
  it("looks up each photo's saved point and returns its labels (landmarks with their own point), the photo's point and the credit", async () => {
    expect(await suggestPlacesForMemory(MEM)).toEqual({
      ok: true,
      photos: [{ mediaId: "med_1", originalFilename: "med_1.jpg", coordinates: LIBERTY, labels: [LANDMARK, TOWN] }],
      pending: [],
      attribution: "© OpenStreetMap contributors",
    });
  });

  it("reads only live, READY image files of the memory that have a point, in display order", async () => {
    await suggestPlacesForMemory(MEM);
    const args = findUnique.mock.calls[0]![0] as { where: { id: string }; select: { deletedAt: true; media: { where: Record<string, unknown>; orderBy: unknown } } };
    expect(args.where).toEqual({ id: MEM });
    expect(args.select.media.where).toEqual({ deletedAt: null, status: "READY", mimeType: { startsWith: "image/" }, latitude: { not: null }, longitude: { not: null } });
    expect(args.select.media.orderBy).toBeDefined();
  });

  it("calls the lookup once per unique point (degrees × 1e6), without a viewer key, all under one deadline 20 s from the start", async () => {
    const nearlySame = { latitude: 40.6892472, longitude: -74.0445021 }; // rounds to the same E6 point as LIBERTY
    const elsewhere = { latitude: 44.50155, longitude: 11.33989 };
    memory = { deletedAt: null, media: [photo("med_1", LIBERTY), photo("med_2", elsewhere), photo("med_3", nearlySame)] };
    const before = Date.now();
    const result = await suggestPlacesForMemory(MEM);
    const after = Date.now();
    expect(lookupMock).toHaveBeenCalledTimes(2);
    expect(lookupMock.mock.calls.map(([point]) => point)).toEqual([LIBERTY, elsewhere]);
    for (const [, options] of lookupMock.mock.calls) {
      expect(options).not.toHaveProperty("viewerKey");
      expect(options.deadline).toBeGreaterThanOrEqual(before + 20_000);
      expect(options.deadline).toBeLessThanOrEqual(after + 20_000);
    }
    expect(new Set(lookupMock.mock.calls.map(([, options]) => options.deadline)).size).toBe(1);
    expect(result.ok && result.photos.map((p) => p.mediaId)).toEqual(["med_1", "med_2", "med_3"]);
  });

  it("looks the points up one at a time (the site-wide throttle spaces them anyway)", async () => {
    memory = { deletedAt: null, media: [photo("med_1", LIBERTY), photo("med_2", { latitude: 1, longitude: 2 }), photo("med_3", { latitude: 3, longitude: 4 })] };
    let inFlight = 0;
    let most = 0;
    lookupMock.mockImplementation(async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { ok: true, labels: [TOWN], attribution: "© OpenStreetMap contributors" };
    });
    await suggestPlacesForMemory(MEM);
    expect(most).toBe(1);
  });

  it("busy or failed (retryable): those photos are listed in pending, not in photos", async () => {
    const other = { latitude: 44.50155, longitude: 11.33989 };
    const third = { latitude: 52.5487429714954, longitude: -1.81602098644987 };
    memory = { deletedAt: null, media: [photo("med_1", LIBERTY), photo("med_2", other), photo("med_3", third)] };
    lookupMock
      .mockResolvedValueOnce({ ok: false, code: "busy" })
      .mockResolvedValueOnce({ ok: true, labels: [TOWN], attribution: "© OpenStreetMap contributors" })
      .mockResolvedValueOnce({ ok: false, code: "failed" });
    expect(await suggestPlacesForMemory(MEM)).toEqual({
      ok: true,
      photos: [{ mediaId: "med_2", originalFilename: "med_2.jpg", coordinates: other, labels: [TOWN] }],
      pending: ["med_1", "med_3"],
      attribution: "© OpenStreetMap contributors",
    });
  });

  it.each(["disabled", "daily_limit", "provider_refused"] as const)("%s ends the call with that code (not retryable) and looks nothing else up", async (code) => {
    memory = { deletedAt: null, media: [photo("med_1", LIBERTY), photo("med_2", { latitude: 1, longitude: 2 })] };
    lookupMock.mockResolvedValueOnce({ ok: false, code });
    expect(await suggestPlacesForMemory(MEM)).toEqual({ ok: false, code });
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it("not_found for a missing or a soft-deleted memory, without any lookup", async () => {
    memory = null;
    expect(await suggestPlacesForMemory(MEM)).toEqual({ ok: false, code: "not_found" });
    memory = { deletedAt: new Date(), media: [photo("med_1", LIBERTY)] };
    expect(await suggestPlacesForMemory(MEM)).toEqual({ ok: false, code: "not_found" });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("a memory with no photo that has a point: nothing to look up, an empty answer", async () => {
    memory = { deletedAt: null, media: [] };
    expect(await suggestPlacesForMemory(MEM)).toEqual({ ok: true, photos: [], pending: [], attribution: "© OpenStreetMap contributors" });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("a point that came back with no usable label is a photo with labels: [] (looked up, nothing to offer)", async () => {
    lookupMock.mockResolvedValueOnce({ ok: true, labels: [], attribution: "© OpenStreetMap contributors" });
    expect(await suggestPlacesForMemory(MEM)).toMatchObject({ ok: true, photos: [{ mediaId: "med_1", labels: [] }], pending: [] });
  });
});
