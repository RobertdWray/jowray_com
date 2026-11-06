/**
 * extractPhotoGps's statements on real Postgres (plan 2026-11-06-photo-gps-places B3): the attempt claim and the one
 * conditional write that sets the pair and `gpsCheckedAt` together, under the B1 CHECKs (Media_coordinates_pair, the
 * ranges, Media_coordinates_checked). The feature tests mock the database; only Postgres shows the write satisfies them.
 *
 * Like the other integration suites, this runs only when TEST_DATABASE_URL names a database at the latest migration,
 * and every case runs inside a transaction that is always rolled back: `getDb()` is pointed at that transaction.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import { resetEnvCache } from "@/server/config/env";

import { jpegWithGps, liberty, LIBERTY } from "../helpers/photo-gps-fixtures";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) {
  // Skipping silently in CI would make the workflow look green with the statements unproven.
  throw new Error("TEST_DATABASE_URL is not set in CI; the extract-photo-gps integration suite must run there");
}
const client = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) : null;

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
/** The transaction the feature's `getDb()` answers with while a case runs. */
let current: Tx | null = null;
vi.mock("@/server/db/client", () => ({ getDb: () => current }));

const blobs = new Map<string, Uint8Array>();
vi.mock("@/services/storage", () => ({
  createStorageService: () => ({
    readPrefix: async (pathname: string, maxBytes: number) => blobs.get(pathname)?.subarray(0, maxBytes) ?? null,
    get: async (pathname: string) => {
      const bytes = blobs.get(pathname);
      return bytes ? { stream: new Blob([new Uint8Array(bytes)]).stream(), contentType: "image/jpeg", contentLength: bytes.byteLength } : null;
    },
  }),
}));
const captureExceptionMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureExceptionMock(...a), flush: async () => true }));

import { extractPhotoGps } from "@/features/media/extract-photo-gps";

/** Thrown to end a transaction that succeeded, so its writes are never committed. */
class RolledBack extends Error {}

/** Runs `work` with `getDb()` answering a transaction that never commits; resolves with what `work` threw, or `null`. */
async function rolledBack(work: (tx: Tx) => Promise<unknown>): Promise<unknown> {
  try {
    await client!.$transaction(async (tx) => {
      current = tx;
      try {
        await work(tx);
      } finally {
        current = null;
      }
      throw new RolledBack();
    });
  } catch (error) {
    return error instanceof RolledBack ? null : error;
  }
  throw new Error("unreachable: the transaction always throws");
}

/** A READY JPEG on a fresh DRAFT memory, stored under this environment's prefix (dev/originals/ with VERCEL_ENV unset). */
async function freshPhoto(tx: Tx, bytes: Uint8Array): Promise<string> {
  const memorial = await tx.memorial.create({ data: { name: "Photo GPS test", slug: `photo-gps-${crypto.randomUUID()}` } });
  const memory = await tx.memory.create({
    data: { memorialId: memorial.id, type: "PHOTO", source: "OTHER", status: "DRAFT", consentVersion: "test", consentedAt: null, claimTokenHash: crypto.randomUUID().replaceAll("-", "").padEnd(64, "0") },
    select: { id: true },
  });
  const storageKey = `dev/originals/${memory.id}/${crypto.randomUUID()}.jpg`;
  blobs.set(storageKey, bytes);
  const media = await tx.media.create({ data: { memoryId: memory.id, storageKey, mimeType: "image/jpeg", maxBytes: 25 * 1024 * 1024, status: "READY", sizeBytes: bytes.byteLength }, select: { id: true } });
  return media.id;
}

const select = { latitude: true, longitude: true, gpsCheckedAt: true, gpsAttempts: true } as const;

describe.skipIf(!client)("extractPhotoGps on real Postgres", () => {
  beforeEach(() => {
    delete process.env.VERCEL_ENV;
    resetEnvCache();
    blobs.clear();
    captureExceptionMock.mockClear();
  });
  afterAll(async () => {
    await client!.$disconnect();
  });

  it("found: one write sets the pair and the stamp together (the CHECKs accept it); a second run is skipped", async () => {
    const seen: unknown[] = [];
    const error = await rolledBack(async (tx) => {
      const mediaId = await freshPhoto(tx, await jpegWithGps(liberty()));
      seen.push(await extractPhotoGps({ mediaId }));
      seen.push(await tx.media.findUniqueOrThrow({ where: { id: mediaId }, select }));
      seen.push(await extractPhotoGps({ mediaId }));
      seen.push((await tx.media.findUniqueOrThrow({ where: { id: mediaId }, select })).gpsAttempts);
    });
    expect(error).toBeNull();
    expect(captureExceptionMock).not.toHaveBeenCalled();
    const [outcome, row, again, attemptsAfter] = seen as ["found", { latitude: number; longitude: number; gpsCheckedAt: Date; gpsAttempts: number }, string, number];
    expect(outcome).toBe("found");
    expect(row.latitude).toBeCloseTo(LIBERTY.latitude, 9);
    expect(row.longitude).toBeCloseTo(LIBERTY.longitude, 9);
    expect(row.gpsCheckedAt).toBeInstanceOf(Date);
    expect(row.gpsAttempts).toBe(1);
    expect(again).toBe("skipped");
    expect(attemptsAfter).toBe(1);
  });

  it("absent: only the stamp is written; failed: nothing but the claimed attempt, and the row stays undecided", async () => {
    const seen: unknown[] = [];
    const error = await rolledBack(async (tx) => {
      const absentId = await freshPhoto(tx, await jpegWithGps(null));
      seen.push(await extractPhotoGps({ mediaId: absentId }), await tx.media.findUniqueOrThrow({ where: { id: absentId }, select }));
      const failedId = await freshPhoto(tx, new TextEncoder().encode("not an image"));
      seen.push(await extractPhotoGps({ mediaId: failedId }), await tx.media.findUniqueOrThrow({ where: { id: failedId }, select }));
    });
    expect(error).toBeNull();
    expect(seen[0]).toBe("absent");
    expect(seen[1]).toEqual({ latitude: null, longitude: null, gpsCheckedAt: expect.any(Date), gpsAttempts: 1 });
    expect(seen[2]).toBe("failed");
    expect(seen[3]).toEqual({ latitude: null, longitude: null, gpsCheckedAt: null, gpsAttempts: 1 });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});
