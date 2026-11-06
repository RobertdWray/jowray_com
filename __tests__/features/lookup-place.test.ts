/**
 * features/places/lookup-place.ts (plan 2026-11-06-photo-gps-places B4): the counters' order (D9), the cache, the
 * site-wide lease and fence (D8) and the outcome codes. Tests first for the throttle [C37].
 *
 * `createPlaceLookup` takes its database, geocoder, ceilings and sleep, so these tests drive it with the in-memory
 * statements in __tests__/helpers/places-fake-db.ts (the claim and fence checked against the brief's SQL verbatim) and
 * a fake provider that records when each request was sent. The real-Postgres proof is
 * __tests__/integration/place-throttle.test.ts.
 */
import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { PlaceProviderRefusedError } from "@/lib/places/errors";
import { PLACE_LEASE_MS, PLACE_PROVIDER_TIMEOUT_MS, PLACE_SEND_BUDGET_MS, PLACE_SEND_SPACING_MS } from "@/lib/places/timing";
import type { PlaceResult } from "@/lib/places/types";
import type { Coordinates } from "@/lib/validations/memory";
import type * as LoggerModule from "@/lib/logger";
import type { ReverseGeocoder } from "@/services/places/types";

import { CLAIM_SQL, createFakePlacesDb, FENCE_SQL, type FakePlacesDb, type StatementKind } from "../helpers/places-fake-db";

const captureExceptionMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureExceptionMock(...a), flush: vi.fn(async () => true) }));
const warnLines: unknown[][] = [];
vi.mock("@/lib/logger", async (importOriginal) => {
  const mod = await importOriginal<typeof LoggerModule>();
  const createLogger: typeof mod.createLogger = (...args) => {
    const real = mod.createLogger(...args);
    const capturing: typeof real = Object.create(real) as typeof real;
    capturing.warn = ((...line: unknown[]) => {
      warnLines.push(line);
    }) as typeof real.warn;
    return capturing;
  };
  return { ...mod, createLogger };
});

import { createPlaceLookup, PLACES_ATTRIBUTION, type PlaceLookupDeps } from "@/features/places/lookup-place";

const LIBERTY: Coordinates = { latitude: 40.689247, longitude: -74.044502 };
const LIBERTY_KEY = "nominatim|40689247|-74044502";
const LIBERTY_RESULT: PlaceResult = {
  name: "Statue of Liberty",
  category: "tourism",
  type: "attraction",
  addresstype: "tourism",
  lat: "40.689247",
  lon: "-74.044502",
  address: { city: "New York", state: "New York", country: "United States", country_code: "us" },
};
const LIBERTY_LABELS = [
  { text: "Statue of Liberty, New York, New York", kind: "landmark", point: { latitude: 40.689247, longitude: -74.044502 } },
  { text: "New York, New York", kind: "town" },
];
const ENV = { PLACES_DAILY_PROVIDER_CALLS: 500, PLACES_VIEWER_DAILY_REQUESTS: 60 };
const viewerScope = (key: string) => `places:viewer:${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;

/** A provider that records the moment each request was sent and answers after `latencyMs`. */
function fakeProvider(answer: (point: Coordinates) => Promise<PlaceResult | null> | PlaceResult | null = () => LIBERTY_RESULT, latencyMs = 0) {
  const sends: Array<{ at: number; point: Coordinates }> = [];
  const geocoder: ReverseGeocoder = {
    provider: "nominatim",
    remote: true,
    reverse: vi.fn(async (point: Coordinates) => {
      sends.push({ at: Date.now(), point });
      if (latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, latencyMs));
      }
      return answer(point);
    }),
  };
  return { geocoder, sends };
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let fake: FakePlacesDb;

function lookup(over: Partial<PlaceLookupDeps> = {}) {
  return createPlaceLookup({ db: fake.db as unknown as PlaceLookupDeps["db"], geocoder: fakeProvider().geocoder, env: ENV, sleep: realSleep, ...over });
}
const kinds = () => fake.log.map((s) => (s.kind === "count" ? `count:${s.scope!.startsWith("places:viewer:") ? "viewer" : s.scope}` : s.kind));

beforeEach(() => {
  fake = createFakePlacesDb();
  captureExceptionMock.mockClear();
  warnLines.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("lookupPlace: outcomes and the counters' order (D9)", () => {
  it("a miss: viewer counted, cache read, lease claimed, cache re-read, provider counted, sent, fenced, cached; labels with the OSM credit", async () => {
    const { geocoder, sends } = fakeProvider();
    const result = await lookup({ geocoder })(LIBERTY, { viewerKey: "203.0.113.7", deadline: Date.now() + 20_000 });
    expect(result).toEqual({ ok: true, labels: LIBERTY_LABELS, attribution: "© OpenStreetMap contributors" });
    expect(PLACES_ATTRIBUTION).toBe("© OpenStreetMap contributors");
    expect(kinds()).toEqual(["count:viewer", "cache_read", "claim", "cache_read", "count:places:provider", "fence", "cache_write"]);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.point).toEqual(LIBERTY);
    expect(fake.counters.get(viewerScope("203.0.113.7"))).toBe(1);
    expect(fake.counters.get("places:provider")).toBe(1);
    expect(fake.cache.get(LIBERTY_KEY)).toEqual(LIBERTY_RESULT);
    expect(fake.throttle.get("nominatim")).toMatchObject({ leaseToken: null, leaseUntil: null });
  });

  it("the viewer counter scope is a hash prefix of the viewer key, never the address itself", async () => {
    await lookup()(LIBERTY, { viewerKey: "203.0.113.7", deadline: Date.now() + 20_000 });
    const scopes = [...fake.counters.keys()];
    expect(scopes).toContain(viewerScope("203.0.113.7"));
    expect(JSON.stringify(scopes)).not.toContain("203.0.113.7");
  });

  it("a cache hit costs only the viewer count: no lease, no provider count, no send", async () => {
    fake.cache.set(LIBERTY_KEY, LIBERTY_RESULT);
    const { geocoder, sends } = fakeProvider();
    expect(await lookup({ geocoder })(LIBERTY, { viewerKey: "v", deadline: Date.now() + 20_000 })).toEqual({ ok: true, labels: LIBERTY_LABELS, attribution: PLACES_ATTRIBUTION });
    expect(kinds()).toEqual(["count:viewer", "cache_read"]);
    expect(sends).toHaveLength(0);
  });

  it("a cached 'no result' (SQL NULL) is a hit with no labels", async () => {
    fake.cache.set(LIBERTY_KEY, Prisma.DbNull);
    const { geocoder, sends } = fakeProvider();
    expect(await lookup({ geocoder })(LIBERTY, { deadline: Date.now() + 20_000 })).toEqual({ ok: true, labels: [], attribution: PLACES_ATTRIBUTION });
    expect(sends).toHaveLength(0);
  });

  it("over the viewer's daily requests: rate_limited before anything else is read, counted or sent", async () => {
    fake.counters.set(viewerScope("v"), 60);
    const { geocoder, sends } = fakeProvider();
    expect(await lookup({ geocoder })(LIBERTY, { viewerKey: "v", deadline: Date.now() + 20_000 })).toEqual({ ok: false, code: "rate_limited" });
    expect(kinds()).toEqual(["count:viewer"]); // the refused count itself, then nothing
    expect(fake.counters.get(viewerScope("v"))).toBe(60);
    expect(sends).toHaveLength(0);
    expect(fake.counters.get("places:provider")).toBeUndefined();
  });

  it("without a viewer key (the MCP path) no viewer counter is touched", async () => {
    await lookup()(LIBERTY, { deadline: Date.now() + 20_000 });
    expect([...fake.counters.keys()]).toEqual(["places:provider"]);
  });

  it("the fresh re-check after the lease: a point cached meanwhile is answered from the cache, the lease released (no fence, no count, no send)", async () => {
    const { geocoder, sends } = fakeProvider();
    let reads = 0;
    const findUnique = fake.db.placeLookup.findUnique;
    fake.db.placeLookup.findUnique = async (args) => {
      reads += 1;
      if (reads === 2) {
        fake.cache.set(LIBERTY_KEY, LIBERTY_RESULT); // another caller's send for the same new point landed
      }
      return findUnique(args);
    };
    const before = { nextAllowedAt: Date.now() - 5_000, leaseToken: null, leaseUntil: null };
    fake.throttle.set("nominatim", { ...before });
    expect(await lookup({ geocoder })(LIBERTY, { deadline: Date.now() + 20_000 })).toEqual({ ok: true, labels: LIBERTY_LABELS, attribution: PLACES_ATTRIBUTION });
    expect(kinds()).toEqual(["cache_read", "claim", "cache_read", "release"]);
    expect(sends).toHaveLength(0);
    expect(fake.counters.get("places:provider")).toBeUndefined();
    expect(fake.throttle.get("nominatim")).toEqual(before); // released: nextAllowedAt untouched, no lease
  });

  it("over the provider's daily calls: daily_limit after the slot is won, the lease released, nothing sent", async () => {
    fake.counters.set("places:provider", 500);
    const { geocoder, sends } = fakeProvider();
    expect(await lookup({ geocoder })(LIBERTY, { deadline: Date.now() + 20_000 })).toEqual({ ok: false, code: "daily_limit" });
    expect(kinds()).toEqual(["cache_read", "claim", "cache_read", "count:places:provider", "release"]);
    expect(sends).toHaveLength(0);
    expect(fake.throttle.get("nominatim")).toMatchObject({ leaseToken: null });
  });

  it("off: disabled after the viewer count, no cache, no lease, no send", async () => {
    expect(await lookup({ geocoder: null })(LIBERTY, { viewerKey: "v", deadline: Date.now() + 20_000 })).toEqual({ ok: false, code: "disabled" });
    expect(kinds()).toEqual(["count:viewer"]);
  });

  it("stub: the stub's labels, no throttle, no provider count, nothing cached", async () => {
    const stub: ReverseGeocoder = { provider: "stub", remote: false, reverse: vi.fn(async () => ({ address: { city: "Photo location found near 40.69, -74.04 (test)" } })) };
    expect(await lookup({ geocoder: stub })(LIBERTY, { viewerKey: "v", deadline: Date.now() + 20_000 })).toEqual({
      ok: true,
      labels: [{ text: "Photo location found near 40.69, -74.04 (test)", kind: "town" }],
      attribution: PLACES_ATTRIBUTION,
    });
    expect(kinds()).toEqual(["count:viewer"]);
    expect(fake.cache.size).toBe(0);
  });

  it("the provider found nothing: cached as SQL NULL (Prisma.DbNull), no labels", async () => {
    const { geocoder } = fakeProvider(() => null);
    expect(await lookup({ geocoder })(LIBERTY, { deadline: Date.now() + 20_000 })).toEqual({ ok: true, labels: [], attribution: PLACES_ATTRIBUTION });
    expect(fake.cache.get(LIBERTY_KEY)).toBe(Prisma.DbNull);
  });

  it("a refusal (403/429): provider_refused, fenced (a request was sent), nothing cached, a Sentry warning", async () => {
    const { geocoder } = fakeProvider(() => {
      throw new PlaceProviderRefusedError(429);
    });
    expect(await lookup({ geocoder })(LIBERTY, { deadline: Date.now() + 20_000 })).toEqual({ ok: false, code: "provider_refused" });
    expect(kinds()).toEqual(["cache_read", "claim", "cache_read", "count:places:provider", "fence"]);
    expect(fake.cache.size).toBe(0);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock.mock.calls[0]![1]).toMatchObject({ level: "warning", tags: { step: "place_lookup" } });
  });

  it("any other provider failure: failed (retryable), fenced, nothing cached, reported to Sentry", async () => {
    const { geocoder } = fakeProvider(() => {
      throw new Error("Nominatim answered 502");
    });
    expect(await lookup({ geocoder })(LIBERTY, { deadline: Date.now() + 20_000 })).toEqual({ ok: false, code: "failed" });
    expect(kinds().at(-1)).toBe("fence");
    expect(fake.cache.size).toBe(0);
    expect(captureExceptionMock.mock.calls[0]![1]).toMatchObject({ tags: { step: "place_lookup" } });
    expect(captureExceptionMock.mock.calls[0]![1]).not.toHaveProperty("level", "warning");
  });

  it("never throws: a database failure anywhere is failed (reported), and a lease it holds is still given back", async () => {
    fake.failNext("count", new Error("connection reset"));
    expect(await lookup()(LIBERTY, { viewerKey: "v", deadline: Date.now() + 20_000 })).toEqual({ ok: false, code: "failed" });
    fake.failNext("cache_read", new Error("connection reset"));
    expect(await lookup()(LIBERTY, { deadline: Date.now() + 20_000 })).toEqual({ ok: false, code: "failed" });
    // Fails after the claim: the re-check throws, so the lease must be released (no send happened).
    let reads = 0;
    const findUnique = fake.db.placeLookup.findUnique;
    fake.db.placeLookup.findUnique = async (args) => {
      reads += 1;
      if (reads === 2) {
        throw new Error("connection reset");
      }
      return findUnique(args);
    };
    const { geocoder, sends } = fakeProvider();
    expect(await lookup({ geocoder })(LIBERTY, { deadline: Date.now() + 20_000 })).toEqual({ ok: false, code: "failed" });
    expect(sends).toHaveLength(0);
    expect(fake.throttle.get("nominatim")).toMatchObject({ leaseToken: null });
    expect(captureExceptionMock).toHaveBeenCalledTimes(3);
  });

  it("a cache write that fails after a good answer still returns the labels (reported)", async () => {
    fake.failNext("cache_write", new Error("connection reset"));
    expect(await lookup()(LIBERTY, { deadline: Date.now() + 20_000 })).toEqual({ ok: true, labels: LIBERTY_LABELS, attribution: PLACES_ATTRIBUTION });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("a fence that matches nothing (the lease expired mid-send) is logged as a warning, and the answer still stands", async () => {
    const { geocoder } = fakeProvider(() => {
      fake.throttle.get("nominatim")!.leaseToken = "someone-else"; // the 10 s lease ran out and another caller claimed
      return LIBERTY_RESULT;
    });
    expect((await lookup({ geocoder })(LIBERTY, { deadline: Date.now() + 20_000 })).ok).toBe(true);
    expect(warnLines.some((line) => (line[0] as { action?: string }).action === "place_lookup_fence_missed")).toBe(true);
    expect(JSON.stringify(warnLines)).not.toMatch(/40\.68|74\.04|40689247/);
  });
});

describe("lookupPlace: the lease, the deadline and busy", () => {
  it("busy: the lease is held past the deadline; it waits in steps of at most 500 ms, never past the deadline, and costs nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date", "performance"] });
    const start = Date.now();
    fake.throttle.set("nominatim", { nextAllowedAt: start, leaseToken: "held", leaseUntil: start + 10_000 });
    const pauses: number[] = [];
    const sleep = (ms: number) => {
      pauses.push(ms);
      return realSleep(ms);
    };
    const { geocoder, sends } = fakeProvider();
    const pending = lookup({ geocoder, sleep })(LIBERTY, { viewerKey: "v", deadline: start + 2_000 });
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ ok: false, code: "busy" });
    expect(Date.now() - start).toBeLessThanOrEqual(2_000);
    expect(pauses.length).toBeGreaterThanOrEqual(3);
    expect(pauses.every((ms) => ms > 0 && ms <= 500)).toBe(true);
    expect(sends).toHaveLength(0);
    expect(fake.counters.get("places:provider")).toBeUndefined();
    expect(fake.throttle.get("nominatim")).toMatchObject({ leaseToken: "held" }); // never touched another caller's lease
  });

  it("waits out the fence of the previous send, then claims and sends", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date", "performance"] });
    const start = Date.now();
    fake.throttle.set("nominatim", { nextAllowedAt: start + 1_100, leaseToken: null, leaseUntil: null });
    const { geocoder, sends } = fakeProvider();
    const pending = lookup({ geocoder })(LIBERTY, { deadline: start + 20_000 });
    await vi.runAllTimersAsync();
    expect((await pending).ok).toBe(true);
    expect(sends[0]!.at).toBeGreaterThanOrEqual(start + 1_100);
  });

  it("a dead holder's lease blocks for at most its 10 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date", "performance"] });
    const start = Date.now();
    fake.throttle.set("nominatim", { nextAllowedAt: start - 60_000, leaseToken: "crashed", leaseUntil: start + 10_000 });
    const { geocoder, sends } = fakeProvider();
    const pending = lookup({ geocoder })(LIBERTY, { deadline: start + 20_000 });
    await vi.runAllTimersAsync();
    expect((await pending).ok).toBe(true);
    expect(sends[0]!.at).toBeGreaterThanOrEqual(start + 10_000);
    expect(sends[0]!.at).toBeLessThan(start + 10_600);
  });

  it("a deadline already past: busy at once, nothing claimed", async () => {
    expect(await lookup()(LIBERTY, { deadline: Date.now() - 1 })).toEqual({ ok: false, code: "busy" });
    expect(fake.throttle.size).toBe(0);
  });
});

describe("lookupPlace: real sends site-wide are at least 1100 ms apart (D8)", () => {
  type Replies = (kind: StatementKind) => number;
  /** Fence replies alternate slow and fast, everything else instant (per test: the state lives in the closure). */
  const alternatingFences = (): Replies => {
    let fences = 0;
    return (kind) => (kind === "fence" ? (fences++ % 2 === 0 ? 900 : 0) : 0);
  };
  const byTurns = (): Replies => {
    let n = 0;
    return () => (n++ % 2 === 0 ? 0 : 900);
  };
  // Each case slows the database's replies differently (0 ms vs 900 ms), and one wakes the retry sleeps late. The
  // alternating-fence case is the one that catches a fence written before its send: one holder would send 900 ms
  // after its fence while the next, whose fence reply is instant, sends 1100 ms after that fence.
  it.each([
    { name: "instant replies", replies: (): Replies => () => 0, late: () => 0 },
    { name: "900 ms replies to every statement", replies: (): Replies => () => 900, late: () => 0 },
    { name: "fence replies alternating 900 / 0 ms, everything else instant", replies: alternatingFences, late: () => 0 },
    { name: "slow claim replies only (900 ms), everything else instant", replies: (): Replies => (kind) => (kind === "claim" ? 900 : 0), late: () => 0 },
    { name: "replies alternating 0 / 900 ms by turns and late timer wakeups", replies: byTurns, late: (n: number) => [0, 350, 1_200][n % 3]! },
  ])("six concurrent lookups of six new points with $name", async ({ replies, late }) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date", "performance"] });
    fake.replyDelayMs = replies();
    let wake = 0;
    const sleep = (ms: number) => realSleep(ms + late(wake++));
    const { geocoder, sends } = fakeProvider(() => LIBERTY_RESULT, 300);
    const start = Date.now();
    const points = Array.from({ length: 6 }, (_, i) => ({ latitude: 10 + i, longitude: 20 + i }));
    const pending = Promise.all(points.map((point) => lookup({ geocoder, sleep })(point, { deadline: start + 120_000 })));
    await vi.runAllTimersAsync();
    const results = await pending;
    expect(results.every((r) => r.ok)).toBe(true);
    expect(sends).toHaveLength(6);
    const times = sends.map((s) => s.at).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]! - times[i - 1]!, `send ${i} after send ${i - 1}`).toBeGreaterThanOrEqual(1_100);
    }
  });
});

describe("lookupPlace: a holder that stalls between its claim and its send (B4 fix round 1)", () => {
  it("the send budget is derived from the lease, the provider timeout and the spacing, which the SQL writes the same way", () => {
    expect(PLACE_SEND_BUDGET_MS).toBe(3_000);
    expect(PLACE_SEND_BUDGET_MS + PLACE_PROVIDER_TIMEOUT_MS + PLACE_SEND_SPACING_MS).toBeLessThan(PLACE_LEASE_MS);
    // The fake database accepts only the brief's SQL verbatim, so these tie the named constants to the statements sent.
    expect(CLAIM_SQL).toContain(`now() + interval '${PLACE_LEASE_MS / 1000} seconds'`);
    expect(FENCE_SQL).toContain(`now() + interval '${PLACE_SEND_SPACING_MS} milliseconds'`);
  });

  // The review's probe: holder A's cache re-check (the third cache read: A's first, B's first, A's re-check) is slow. On
  // the first draft A sent late in its 10 s lease, the lease expired during A's request, B claimed and sent, and the two
  // sends landed under 1.1 s apart. Now a holder starts its send only within the send budget (3 s after issuing its
  // winning claim); a later one releases the lease (no fence) and answers busy.
  it.each([
    { name: "re-check stalls 9.5 s, provider answers in 1 s (sent 500 ms apart on the first draft)", stallMs: 9_500, latencyMs: 1_000, stalledSends: false },
    { name: "re-check stalls 9.0 s, provider answers in 2 s (sent 1000 ms apart on the first draft)", stallMs: 9_000, latencyMs: 2_000, stalledSends: false },
    { name: "control: re-check stalls 8.0 s, provider answers in 1 s (spaced on the first draft too)", stallMs: 8_000, latencyMs: 1_000, stalledSends: false },
    { name: "a stall just under the budget (2.9 s) still sends, spaced", stallMs: 2_900, latencyMs: 1_000, stalledSends: true },
  ])("$name", async ({ stallMs, latencyMs, stalledSends }) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date", "performance"] });
    let reads = 0;
    fake.replyDelayMs = (kind) => (kind === "cache_read" && ++reads === 3 ? stallMs : 0);
    const sends: Array<{ at: number; point: Coordinates }> = [];
    const geocoder: ReverseGeocoder = {
      provider: "nominatim",
      remote: true,
      reverse: async (point) => {
        sends.push({ at: Date.now(), point });
        await new Promise((resolve) => setTimeout(resolve, latencyMs));
        return { address: { city: "Somewhere" } };
      },
    };
    const start = Date.now();
    const a = { latitude: 10, longitude: 20 };
    const b = { latitude: 11, longitude: 21 };
    const pending = Promise.all([lookup({ geocoder })(a, { deadline: start + 30_000 }), lookup({ geocoder })(b, { deadline: start + 30_000 })]);
    await vi.runAllTimersAsync();
    const [resultA, resultB] = await pending;

    // The guarantee, whatever happened: consecutive real sends at least 1100 ms apart.
    const times = sends.map((send) => send.at).sort((x, y) => x - y);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]! - times[i - 1]!, `send ${i} after send ${i - 1}`).toBeGreaterThanOrEqual(1_100);
    }
    expect(resultB.ok).toBe(true);
    if (stalledSends) {
      expect(resultA.ok).toBe(true);
      expect(sends).toHaveLength(2);
    } else {
      // A refused to send so late in its lease: busy (retryable), nothing sent for its point, its lease released.
      expect(resultA).toEqual({ ok: false, code: "busy" });
      expect(sends.map((send) => send.point)).toEqual([b]);
      expect(fake.log.filter((statement) => statement.kind === "release")).toHaveLength(1);
      // A's provider count was already spent and stays spent: over-counting is the safe direction for a quota.
      expect(fake.counters.get("places:provider")).toBe(2);
    }
  });
});
