/**
 * features/media/extract-photo-gps.ts (plan 2026-11-06-photo-gps-places B3): GPS read from the stored original in its
 * own durable step, independent of derived copies. Tests first [C37].
 *
 * The database is an in-memory table driven by the shared Prisma `where` interpreter; storage serves real fixture
 * bytes (sharp JPEGs at the Statue of Liberty, the HEIC files), so the read path runs the real lib/photo-gps.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as LoggerModule from "@/lib/logger";
import { resetEnvCache } from "@/server/config/env";

import { jpegWithGps, liberty, LIBERTY, PREFIX_BYTES, readFixture, withLateExif } from "../helpers/photo-gps-fixtures";
import { matchesWhere, type Where } from "../helpers/prisma-where";

interface MediaRow {
  id: string;
  memoryId: string;
  status: "PENDING" | "READY" | "FAILED";
  mimeType: string;
  storageKey: string;
  deletedAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  gpsCheckedAt: Date | null;
  gpsAttempts: number;
  gpsClaimedAt: Date | null;
  memory: { deletedAt: Date | null };
}

let media: MediaRow[] = [];
/** Runs before each updateMany applies, to inject a failure (by throwing) or a concurrent writer. */
let beforeUpdate: ((args: { where: Where; data: Record<string, unknown> }) => void) | null = null;
const db = {
  media: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const row = media.find((m) => m.id === where.id);
      return row ? { ...row, memory: { ...row.memory } } : null;
    }),
    updateMany: vi.fn(async (args: { where: Where; data: Record<string, unknown> }) => {
      beforeUpdate?.(args);
      const rows = media.filter((m) => matchesWhere(m as unknown as Record<string, unknown>, args.where));
      for (const row of rows) {
        for (const [key, value] of Object.entries(args.data)) {
          if (value !== null && typeof value === "object" && "increment" in value) {
            (row as unknown as Record<string, number>)[key] += (value as { increment: number }).increment;
          } else {
            (row as unknown as Record<string, unknown>)[key] = value;
          }
        }
      }
      return { count: rows.length };
    }),
  },
};
vi.mock("@/server/db/client", () => ({ getDb: () => db }));

/** The store: pathname → bytes. */
const blobs = new Map<string, Uint8Array>();
const readPrefixMock = vi.fn(async (pathname: string, maxBytes: number, _options?: { signal?: AbortSignal }): Promise<Uint8Array | null> => blobs.get(pathname)?.subarray(0, maxBytes) ?? null);
const getMock = vi.fn(async (pathname: string, _options?: { signal?: AbortSignal }) => {
  const bytes = blobs.get(pathname);
  return bytes ? { stream: new Blob([new Uint8Array(bytes)]).stream(), contentType: "application/octet-stream", contentLength: bytes.byteLength } : null;
});
vi.mock("@/services/storage", () => ({ createStorageService: () => ({ readPrefix: readPrefixMock, get: getMock, head: vi.fn(), put: vi.fn(), del: vi.fn(), presignGet: vi.fn() }) }));

const captureExceptionMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureExceptionMock(...a), flush: vi.fn(async () => true) }));

/** Every line the feature's logger writes, at any level (the real logger is silent under test). */
const logLines: Array<{ level: string; line: unknown[] }> = [];
vi.mock("@/lib/logger", async (importOriginal) => {
  const mod = await importOriginal<typeof LoggerModule>();
  const createLogger: typeof mod.createLogger = (...args) => {
    const real = mod.createLogger(...args);
    const capturing: typeof real = Object.create(real) as typeof real;
    for (const level of ["debug", "info", "warn", "error"] as const) {
      capturing[level] = ((...line: unknown[]) => {
        logLines.push({ level, line });
      }) as typeof real.info;
    }
    return capturing;
  };
  return { ...mod, createLogger };
});

import { extractPhotoGps, GPS_READ_DEADLINE_MS, GPS_STALE_CLAIM_MS, MAX_GPS_ATTEMPTS } from "@/features/media/extract-photo-gps";

const KEY = "dev/originals/mem_1/0f6a1c7e-3f1a-4b5e-9c2d-1234567890ab.jpg";

function photo(over: Partial<MediaRow> = {}): MediaRow {
  return { id: "med_1", memoryId: "mem_1", status: "READY", mimeType: "image/jpeg", storageKey: KEY, deletedAt: null, latitude: null, longitude: null, gpsCheckedAt: null, gpsAttempts: 0, gpsClaimedAt: null, memory: { deletedAt: null }, ...over };
}

function expectLibertyStored(row: MediaRow | undefined) {
  expect(row?.latitude).toBeCloseTo(LIBERTY.latitude, 9);
  expect(row?.longitude).toBeCloseTo(LIBERTY.longitude, 9);
  expect(row?.gpsCheckedAt).toBeInstanceOf(Date);
}

/** No log line may carry a coordinate (C44): neither the keys nor the digits of the fixture point. */
function expectNoCoordinatesLogged() {
  const text = JSON.stringify(logLines);
  expect(text).not.toMatch(/latitude|longitude/i);
  expect(text).not.toContain("40.68");
  expect(text).not.toContain("74.04");
}

function photoGpsLines() {
  return logLines.filter((l) => (l.line[0] as { action?: string } | undefined)?.action === "photo_gps").map((l) => ({ level: l.level, ...(l.line[0] as object) }));
}

beforeEach(() => {
  delete process.env.VERCEL_ENV;
  resetEnvCache();
  media = [photo()];
  blobs.clear();
  beforeUpdate = null;
  logLines.length = 0;
  readPrefixMock.mockClear();
  getMock.mockClear();
  captureExceptionMock.mockClear();
  db.media.findUnique.mockClear();
  db.media.updateMany.mockClear();
});

describe("extractPhotoGps: outcomes", () => {
  it("found: a JPEG whose EXIF sits in the 128 KiB prefix; one prefix read, no whole-file read, coordinates and the stamp in one conditional write", async () => {
    blobs.set(KEY, await jpegWithGps(liberty()));
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("found");
    expect(readPrefixMock).toHaveBeenCalledWith(KEY, PREFIX_BYTES, { signal: expect.any(AbortSignal) });
    expect(getMock).not.toHaveBeenCalled();
    expectLibertyStored(media[0]);
    expect(media[0]!.gpsAttempts).toBe(1);
    const write = db.media.updateMany.mock.calls.at(-1)![0];
    expect(write.where).toEqual({ id: "med_1", gpsCheckedAt: null, deletedAt: null, memory: { deletedAt: null } });
    expect(Object.keys(write.data).sort()).toEqual(["gpsCheckedAt", "gpsClaimedAt", "latitude", "longitude"]);
    expect(write.data.gpsClaimedAt).toBeNull();
    expect(photoGpsLines()).toEqual([{ level: "info", action: "photo_gps", mediaId: "med_1", outcome: "found", attempt: 1 }]);
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expectNoCoordinatesLogged();
  });

  it("absent: a JPEG with no GPS whose metadata ends inside the prefix sets only the stamp", async () => {
    blobs.set(KEY, await jpegWithGps(null));
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("absent");
    expect(getMock).not.toHaveBeenCalled();
    expect(media[0]).toMatchObject({ latitude: null, longitude: null, gpsAttempts: 1, gpsCheckedAt: expect.any(Date) });
    expect(db.media.updateMany.mock.calls.at(-1)![0].data).toEqual({ gpsCheckedAt: expect.any(Date), gpsClaimedAt: null });
    expect(photoGpsLines()).toEqual([{ level: "info", action: "photo_gps", mediaId: "med_1", outcome: "absent", attempt: 1 }]);
  });

  it("absent for Android's 0/0 and for blank refs (D12)", async () => {
    blobs.set(KEY, await jpegWithGps({ GPSLatitudeRef: "N", GPSLatitude: "0/1 0/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "0/1 0/1 0/1" }));
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("absent");
    media = [photo()];
    blobs.set(KEY, await jpegWithGps(liberty({ lat: " ", lon: " " })));
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("absent");
  });

  it("escalates to the whole original when the prefix ends before the JPEG's metadata does (late EXIF), and finds the point", async () => {
    const late = withLateExif(await jpegWithGps(liberty()));
    blobs.set(KEY, late);
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("found");
    expect(readPrefixMock).toHaveBeenCalledWith(KEY, PREFIX_BYTES, { signal: expect.any(AbortSignal) });
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
    expectLibertyStored(media[0]);
  });

  it("escalates the same way for a late-EXIF JPEG without GPS, and only then decides absent", async () => {
    blobs.set(KEY, withLateExif(await jpegWithGps(null)));
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("absent");
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it("reads other image types whole: gps.heic is found, tiny.heic is absent, and no prefix is read for either", async () => {
    const heicKey = KEY.replace(/\.jpg$/, ".heic");
    blobs.set(heicKey, readFixture("gps.heic"));
    media = [photo({ mimeType: "image/heic", storageKey: heicKey })];
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("found");
    expectLibertyStored(media[0]);
    blobs.set(heicKey, readFixture("tiny.heic"));
    media = [photo({ mimeType: "image/heic", storageKey: heicKey })];
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("absent");
    expect(readPrefixMock).not.toHaveBeenCalled();
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it("failed: bytes that are no image leave the row undecided, report to Sentry with tag step=photo_gps and warn, never throw", async () => {
    blobs.set(KEY, new TextEncoder().encode("not an image at all"));
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("failed");
    expect(media[0]).toMatchObject({ gpsCheckedAt: null, latitude: null, gpsAttempts: 1 });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect(captureExceptionMock.mock.calls[0]![1]).toMatchObject({ tags: { step: "photo_gps", media_id: "med_1" } });
    expect(photoGpsLines()).toEqual([{ level: "warn", action: "photo_gps", mediaId: "med_1", outcome: "failed", attempt: 1, errorType: "Error" }]);
  });

  it("failed: a READY row whose original is missing from the store (prefix and whole reads both answer null)", async () => {
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("failed");
    const heicKey = KEY.replace(/\.jpg$/, ".heic");
    media = [photo({ mimeType: "image/heic", storageKey: heicKey })];
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("failed");
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
    expect(media[0]!.gpsCheckedAt).toBeNull();
  });

  it("failed, never thrown: a storage error, a database error on the first read, and a whole read past its deadline", async () => {
    readPrefixMock.mockRejectedValueOnce(new Error("blob store unavailable"));
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("failed");
    db.media.findUnique.mockRejectedValueOnce(new Error("database down"));
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("failed");
    // A stalled download is aborted at the deadline (the signal reaches the store), not waited for.
    const heicKey = KEY.replace(/\.jpg$/, ".heic");
    media = [photo({ mimeType: "image/heic", storageKey: heicKey })];
    getMock.mockImplementationOnce(async (_pathname, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(options.signal?.reason))));
    expect(await extractPhotoGps({ mediaId: "med_1", deadlineMs: 20 })).toBe("failed");
    expect(captureExceptionMock).toHaveBeenCalledTimes(3);
    for (const [, context] of captureExceptionMock.mock.calls) {
      expect(context).toMatchObject({ tags: { step: "photo_gps" } });
    }
  });
});

describe("extractPhotoGps: one deadline for both reads (B3 fix round 1)", () => {
  it("an aborted prefix read (a stalled store) is failed, reported, and leaves the row undecided at its claimed attempt", async () => {
    blobs.set(KEY, await jpegWithGps(liberty()));
    readPrefixMock.mockImplementationOnce(async (_pathname, _maxBytes, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(options.signal?.reason))));
    expect(await extractPhotoGps({ mediaId: "med_1", deadlineMs: 20 })).toBe("failed");
    expect(media[0]).toMatchObject({ gpsCheckedAt: null, latitude: null, longitude: null, gpsAttempts: 1 });
    expect(getMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock.mock.calls[0]![1]).toMatchObject({ tags: { step: "photo_gps" } });
    expect(photoGpsLines()).toEqual([{ level: "warn", action: "photo_gps", mediaId: "med_1", outcome: "failed", attempt: 1, errorType: "TimeoutError" }]);
  });

  it("the prefix read and the whole-file read share one deadline signal", async () => {
    blobs.set(KEY, withLateExif(await jpegWithGps(liberty())));
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("found");
    const prefixSignal = readPrefixMock.mock.calls[0]![2]?.signal;
    expect(prefixSignal).toBeInstanceOf(AbortSignal);
    expect(getMock.mock.calls[0]![1]?.signal).toBe(prefixSignal);
  });
});

describe("extractPhotoGps: eligibility, the claim and the cap", () => {
  it.each([
    { name: "a missing row", rows: [] },
    { name: "a PENDING row", rows: [photo({ status: "PENDING" })] },
    { name: "a FAILED row", rows: [photo({ status: "FAILED" })] },
    { name: "a video", rows: [photo({ mimeType: "video/mp4" })] },
    { name: "a voice note", rows: [photo({ mimeType: "audio/mp4" })] },
    { name: "a removed file", rows: [photo({ deletedAt: new Date() })] },
    { name: "a file of a deleted memory", rows: [photo({ memory: { deletedAt: new Date() } })] },
    { name: "an already decided row", rows: [photo({ gpsCheckedAt: new Date() })] },
    { name: "a row at the attempt cap", rows: [photo({ gpsAttempts: MAX_GPS_ATTEMPTS })] },
    { name: "another environment's file (a production row copied into this branch)", rows: [photo({ storageKey: "originals/mem_1/x.jpg" })] },
  ])("skips $name: no claim, no read, no write", async ({ rows }) => {
    media = rows;
    blobs.set(KEY, await jpegWithGps(liberty()));
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("skipped");
    expect(db.media.updateMany).not.toHaveBeenCalled();
    expect(readPrefixMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("claims an attempt before reading a byte, conditional on the row still being undecided at the count it read", async () => {
    blobs.set(KEY, await jpegWithGps(liberty()));
    media = [photo({ gpsAttempts: 1 })];
    await extractPhotoGps({ mediaId: "med_1" });
    const claim = db.media.updateMany.mock.calls[0]![0];
    expect(claim).toEqual({
      where: { id: "med_1", gpsCheckedAt: null, gpsAttempts: 1, OR: [{ gpsClaimedAt: null }, { gpsClaimedAt: { lt: expect.any(Date) } }] },
      data: { gpsAttempts: { increment: 1 }, gpsClaimedAt: expect.any(Date) },
    });
    expect(db.media.updateMany.mock.invocationCallOrder[0]!).toBeLessThan(readPrefixMock.mock.invocationCallOrder[0]!);
    expect(photoGpsLines()[0]).toMatchObject({ attempt: 2 });
  });

  it("a concurrent claim: of two workers that read the same row, one extracts and the other is skipped", async () => {
    blobs.set(KEY, await jpegWithGps(liberty()));
    const outcomes = await Promise.all([extractPhotoGps({ mediaId: "med_1" }), extractPhotoGps({ mediaId: "med_1" })]);
    expect(outcomes.sort()).toEqual(["found", "skipped"]);
    expect(readPrefixMock).toHaveBeenCalledTimes(1);
    expect(media[0]!.gpsAttempts).toBe(1);
    expectLibertyStored(media[0]);
  });

  it("a decision written elsewhere between the claim and this write is kept: the conditional write matches nothing and the run is skipped", async () => {
    blobs.set(KEY, await jpegWithGps(liberty()));
    const elsewhere = new Date("2026-11-06T12:00:00Z");
    beforeUpdate = ({ data }) => {
      if ("gpsCheckedAt" in data) {
        Object.assign(media[0]!, { gpsCheckedAt: elsewhere });
      }
    };
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("skipped");
    expect(media[0]).toMatchObject({ gpsCheckedAt: elsewhere, latitude: null, longitude: null });
  });

  it("caps the attempts at three: a third failure leaves the row undecided, and the next run does not read it again", async () => {
    blobs.set(KEY, new TextEncoder().encode("not an image"));
    media = [photo({ gpsAttempts: MAX_GPS_ATTEMPTS - 1 })];
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("failed");
    expect(media[0]).toMatchObject({ gpsAttempts: MAX_GPS_ATTEMPTS, gpsCheckedAt: null });
    readPrefixMock.mockClear();
    getMock.mockClear();
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("skipped");
    expect(readPrefixMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
    expect(MAX_GPS_ATTEMPTS).toBe(3);
  });

  it("fail once, then recover: the first coordinate write throws, the row stays undecided, and the second run writes", async () => {
    blobs.set(KEY, await jpegWithGps(liberty()));
    let failNextCoordinateWrite = true;
    beforeUpdate = ({ data }) => {
      if ("latitude" in data && failNextCoordinateWrite) {
        failNextCoordinateWrite = false;
        throw new Error("connection reset while writing coordinates");
      }
    };
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("failed");
    expect(media[0]).toMatchObject({ gpsAttempts: 1, gpsCheckedAt: null, latitude: null, longitude: null, gpsClaimedAt: expect.any(Date) });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock.mock.calls[0]![1]).toMatchObject({ tags: { step: "photo_gps" } });

    // The failed attempt's claim is left to expire; once it is stale, the next run takes it over.
    media[0]!.gpsClaimedAt = new Date(Date.now() - GPS_STALE_CLAIM_MS - 1_000);
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("found");
    expect(media[0]!.gpsAttempts).toBe(2);
    expectLibertyStored(media[0]);
    expect(photoGpsLines().map((l) => [l.level, (l as { outcome?: string }).outcome, (l as { attempt?: number }).attempt])).toEqual([
      ["warn", "failed", 1],
      ["info", "found", 2],
    ]);
    expectNoCoordinatesLogged();
  });
});

describe("extractPhotoGps: the claim is a lease (final review, item 2)", () => {
  it("the stale window outlasts a whole read: a live worker's claim is never taken over while its deadline runs", () => {
    expect(GPS_STALE_CLAIM_MS).toBeGreaterThanOrEqual(GPS_READ_DEADLINE_MS + 15_000);
  });

  it("a worker starting while another holds a live claim is skipped: no download, no attempt spent, nothing written", async () => {
    blobs.set(KEY, await jpegWithGps(liberty()));
    const held = new Date(Date.now() - 5_000);
    media = [photo({ gpsAttempts: 1, gpsClaimedAt: held })];
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("skipped");
    expect(readPrefixMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
    expect(db.media.updateMany).not.toHaveBeenCalled();
    expect(media[0]).toMatchObject({ gpsAttempts: 1, gpsClaimedAt: held, gpsCheckedAt: null });
    expect(photoGpsLines()).toEqual([expect.objectContaining({ outcome: "skipped", reason: "claimed_elsewhere" })]);
  });

  it("a claim taken by another worker after this one read the row makes the conditional claim match nothing: skipped, no read", async () => {
    blobs.set(KEY, await jpegWithGps(liberty()));
    beforeUpdate = ({ data }) => {
      if ("gpsAttempts" in data && beforeUpdate) {
        Object.assign(media[0]!, { gpsClaimedAt: new Date(), gpsAttempts: 1 }); // the other worker's claim lands first
        beforeUpdate = null;
      }
    };
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("skipped");
    expect(readPrefixMock).not.toHaveBeenCalled();
    expect(media[0]!.gpsAttempts).toBe(1);
  });

  it("a stale claim (a worker that died) is taken over: the attempt is spent, the point read and the claim cleared", async () => {
    blobs.set(KEY, await jpegWithGps(liberty()));
    media = [photo({ gpsAttempts: 1, gpsClaimedAt: new Date(Date.now() - GPS_STALE_CLAIM_MS - 1_000) })];
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("found");
    expect(media[0]!.gpsAttempts).toBe(2);
    expect(media[0]!.gpsClaimedAt).toBeNull();
    expectLibertyStored(media[0]);
  });

  it("every decision clears the claim; a failure leaves it to expire, so an immediate retry is skipped without spending an attempt", async () => {
    blobs.set(KEY, await jpegWithGps(liberty()));
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("found");
    expect(media[0]!.gpsClaimedAt).toBeNull();

    blobs.set(KEY, await jpegWithGps(null));
    media = [photo()];
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("absent");
    expect(media[0]).toMatchObject({ gpsClaimedAt: null, gpsCheckedAt: expect.any(Date) });

    blobs.set(KEY, new TextEncoder().encode("not an image"));
    media = [photo()];
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("failed");
    expect(media[0]).toMatchObject({ gpsAttempts: 1, gpsClaimedAt: expect.any(Date), gpsCheckedAt: null });
    readPrefixMock.mockClear();
    getMock.mockClear();
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("skipped");
    expect(readPrefixMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
    expect(media[0]!.gpsAttempts).toBe(1);
  });
});

describe("extractPhotoGps: no decision for a photo removed while it was read (final review, item 5)", () => {
  it.each([
    { name: "the file was removed", remove: (row: MediaRow) => Object.assign(row, { deletedAt: new Date() }) },
    { name: "its memory was deleted", remove: (row: MediaRow) => Object.assign(row, { memory: { deletedAt: new Date() } }) },
  ])("$name between the claim and the decision: nothing is stored and the run is skipped", async ({ remove }) => {
    blobs.set(KEY, await jpegWithGps(liberty()));
    beforeUpdate = ({ data }) => {
      if ("gpsCheckedAt" in data) {
        remove(media[0]!);
      }
    };
    expect(await extractPhotoGps({ mediaId: "med_1" })).toBe("skipped");
    expect(media[0]).toMatchObject({ latitude: null, longitude: null, gpsCheckedAt: null });
    const decision = db.media.updateMany.mock.calls.at(-1)![0];
    expect(decision.where).toEqual({ id: "med_1", gpsCheckedAt: null, deletedAt: null, memory: { deletedAt: null } });
    expectNoCoordinatesLogged();
  });
});

