/**
 * extractPhotoGps's statements on real Postgres (plan 2026-11-06-photo-gps-places B3): the attempt claim and the one
 * conditional write that sets the pair and `gpsCheckedAt` together, under the B1 CHECKs (Media_coordinates_pair, the
 * ranges, Media_coordinates_checked). The feature tests mock the database; only Postgres shows the write satisfies them.
 *
 * Like the other integration suites, this runs only when TEST_DATABASE_URL names a database at the latest migration,
 * and every case runs inside a transaction that is always rolled back: `getDb()` is pointed at that transaction.
 */
import { readFileSync } from "node:fs";

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
/** Runs inside the first read, after the claim and before the decision (to remove the photo while it is being read). */
let onRead: (() => Promise<void>) | null = null;
vi.mock("@/services/storage", () => ({
  createStorageService: () => ({
    head: async (pathname: string) => {
      const bytes = blobs.get(pathname);
      return bytes ? { size: bytes.byteLength } : null;
    },
    readRange: async (pathname: string, offset: number, length: number) => {
      await onRead?.();
      return blobs.get(pathname)?.subarray(offset, offset + length) ?? null;
    },
    readPrefix: async (pathname: string, maxBytes: number) => {
      await onRead?.();
      return blobs.get(pathname)?.subarray(0, maxBytes) ?? null;
    },
    get: async (pathname: string) => {
      const bytes = blobs.get(pathname);
      return bytes ? { stream: new Blob([new Uint8Array(bytes)]).stream(), contentType: "image/jpeg", contentLength: bytes.byteLength } : null;
    },
  }),
}));
const captureExceptionMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureExceptionMock(...a), flush: async () => true }));

import { extractPhotoGps, GPS_STALE_CLAIM_MS } from "@/features/media/extract-photo-gps";

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

const select = { latitude: true, longitude: true, gpsCheckedAt: true, gpsAttempts: true, gpsClaimedAt: true } as const;

describe.skipIf(!client)("extractPhotoGps on real Postgres", () => {
  beforeEach(() => {
    delete process.env.VERCEL_ENV;
    resetEnvCache();
    blobs.clear();
    onRead = null;
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
    expect(seen[1]).toEqual({ latitude: null, longitude: null, gpsCheckedAt: expect.any(Date), gpsAttempts: 1, gpsClaimedAt: null });
    expect(seen[2]).toBe("failed");
    // A failure leaves its claim in place, to expire (final review, item 2).
    expect(seen[3]).toEqual({ latitude: null, longitude: null, gpsCheckedAt: null, gpsAttempts: 1, gpsClaimedAt: expect.any(Date) });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { fixture: "location-mdta.mov", mimeType: "video/quicktime", outcome: "found" },
    { fixture: "location-xyz.mp4", mimeType: "video/mp4", outcome: "found" },
    { fixture: "no-location.mov", mimeType: "video/quicktime", outcome: "absent" },
  ])("video $fixture satisfies the coordinate CHECKs and stamps $outcome", async ({ fixture, mimeType, outcome }) => {
    const error = await rolledBack(async (tx) => {
      const mediaId = await freshPhoto(tx, new Uint8Array(readFileSync(new URL(`../fixtures/${fixture}`, import.meta.url))));
      await tx.media.update({ where: { id: mediaId }, data: { mimeType } });
      expect(await extractPhotoGps({ mediaId })).toBe(outcome);
      const row = await tx.media.findUniqueOrThrow({ where: { id: mediaId }, select });
      expect(row).toMatchObject({ gpsCheckedAt: expect.any(Date), gpsAttempts: 1, gpsClaimedAt: null });
      if (outcome === "found") {
        expect(row.latitude).toBeCloseTo(40.6892, 4);
        expect(row.longitude).toBeCloseTo(-74.0445, 4);
      } else {
        expect(row).toMatchObject({ latitude: null, longitude: null });
      }
      expect(await extractPhotoGps({ mediaId })).toBe("skipped");
    });
    expect(error).toBeNull();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("the claim is a lease (final review, item 2): a live claim is skipped with no read and no attempt spent; a stale one is taken over and cleared", async () => {
    const seen: unknown[] = [];
    const error = await rolledBack(async (tx) => {
      const mediaId = await freshPhoto(tx, await jpegWithGps(liberty()));
      const live = new Date(Date.now() - 5_000);
      await tx.media.update({ where: { id: mediaId }, data: { gpsAttempts: 1, gpsClaimedAt: live } });
      seen.push(await extractPhotoGps({ mediaId }), await tx.media.findUniqueOrThrow({ where: { id: mediaId }, select }));
      await tx.media.update({ where: { id: mediaId }, data: { gpsClaimedAt: new Date(Date.now() - GPS_STALE_CLAIM_MS - 1_000) } });
      seen.push(await extractPhotoGps({ mediaId }), await tx.media.findUniqueOrThrow({ where: { id: mediaId }, select }));
    });
    expect(error).toBeNull();
    expect(seen[0]).toBe("skipped");
    expect(seen[1]).toMatchObject({ gpsAttempts: 1, gpsCheckedAt: null, latitude: null });
    expect(seen[2]).toBe("found");
    const taken = seen[3] as { latitude: number; gpsAttempts: number; gpsClaimedAt: Date | null; gpsCheckedAt: Date };
    expect(taken.gpsAttempts).toBe(2);
    expect(taken.gpsClaimedAt).toBeNull();
    expect(taken.latitude).toBeCloseTo(LIBERTY.latitude, 9);
  });

  it("the decision write refuses a photo removed, or whose memory was deleted, while it was read (final review, item 5)", async () => {
    const seen: Array<{ outcome: string; row: unknown }> = [];
    const error = await rolledBack(async (tx) => {
      for (const remove of ["file", "memory"] as const) {
        const mediaId = await freshPhoto(tx, await jpegWithGps(liberty()));
        const { memoryId } = await tx.media.findUniqueOrThrow({ where: { id: mediaId }, select: { memoryId: true } });
        onRead = async () => {
          onRead = null;
          if (remove === "file") {
            await tx.media.update({ where: { id: mediaId }, data: { deletedAt: new Date() } });
          } else {
            await tx.memory.update({ where: { id: memoryId }, data: { deletedAt: new Date() } });
          }
        };
        const outcome = await extractPhotoGps({ mediaId });
        seen.push({ outcome, row: await tx.media.findUniqueOrThrow({ where: { id: mediaId }, select }) });
      }
    });
    expect(error).toBeNull();
    expect(seen).toHaveLength(2);
    for (const { outcome, row } of seen) {
      expect(outcome).toBe("skipped");
      expect(row).toMatchObject({ latitude: null, longitude: null, gpsCheckedAt: null, gpsAttempts: 1 });
    }
  });
});

