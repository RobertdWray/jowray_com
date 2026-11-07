import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as PhotoGpsModule from "@/features/media/extract-photo-gps";
import { scheduleReadyFollowUps } from "@/features/memories/ingest-upload";

const tasks: Array<{ name: string; run: () => Promise<void> }> = [];
vi.mock("@/lib/sentry/after-flush", () => ({
  afterWithFlush: (name: string, run: () => Promise<void>) => { tasks.push({ name, run }); },
}));
const deriveMock = vi.fn(async (_input: { mediaId: string; deadlineMs: number }) => undefined);
vi.mock("@/features/memories/derive-media", () => ({ deriveMedia: (input: { mediaId: string; deadlineMs: number }) => deriveMock(input) }));
const gpsMock = vi.fn(async (_input: { mediaId: string; deadlineMs?: number }) => "found");
vi.mock("@/features/media/extract-photo-gps", async (importOriginal) => ({
  ...await importOriginal<typeof PhotoGpsModule>(),
  extractPhotoGps: (input: { mediaId: string; deadlineMs?: number }) => gpsMock(input),
}));
const findMediaMock = vi.fn(async () => ({ status: "READY", checksumSha256: "a".repeat(64) }));
vi.mock("@/server/db/client", () => ({ getDb: () => ({ media: { findUnique: findMediaMock } }) }));

const now = new Date("2026-11-07T12:00:00Z").getTime();

beforeEach(() => {
  tasks.length = 0;
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => { vi.useRealTimers(); });

describe("scheduleReadyFollowUps with a caller deadline", () => {
  it.each([
    { remainingMs: 15_000, deadlineMs: 12_000, gpsDeadlineMs: 12_000 },
    { remainingMs: 60_000, deadlineMs: 20_000, gpsDeadlineMs: 15_000 },
    { remainingMs: 8_000, deadlineMs: 5_000, gpsDeadlineMs: 5_000 },
  ])("allows $deadlineMs ms for derive with $remainingMs ms left", async ({ remainingMs, deadlineMs, gpsDeadlineMs }) => {
    scheduleReadyFollowUps({ mediaId: "med_admin", mimeType: "image/jpeg", sizeBytes: 1024, deadlineAt: now + remainingMs });

    expect(tasks.map((task) => task.name)).toEqual(["finalize.checksum_and_derive", "finalize.photo_gps"]);
    expect(deriveMock).not.toHaveBeenCalled();
    expect(gpsMock).not.toHaveBeenCalled();
    for (const task of tasks) { await task.run(); }

    expect(findMediaMock).toHaveBeenCalledWith({ where: { id: "med_admin" } });
    expect(deriveMock).toHaveBeenCalledExactlyOnceWith({ mediaId: "med_admin", deadlineMs });
    expect(gpsMock).toHaveBeenCalledExactlyOnceWith({ mediaId: "med_admin", deadlineMs: gpsDeadlineMs });
  });

  it.each([
    { remainingMs: 7_999, gpsDeadlineMs: 4_999 },
    { remainingMs: 4_000, gpsDeadlineMs: 1_000 },
    { remainingMs: 3_999, gpsDeadlineMs: null },
    { remainingMs: 3_000, gpsDeadlineMs: null },
    { remainingMs: -1, gpsDeadlineMs: null },
  ])("leaves derive to cron with only $remainingMs ms left, while keeping checksum and budgeting photo GPS", async ({ remainingMs, gpsDeadlineMs }) => {
    scheduleReadyFollowUps({ mediaId: "med_admin", mimeType: "image/jpeg", sizeBytes: 1024, deadlineAt: now + remainingMs });
    for (const task of tasks) { await task.run(); }

    expect(findMediaMock).toHaveBeenCalledWith({ where: { id: "med_admin" } });
    expect(deriveMock).not.toHaveBeenCalled();
    if (gpsDeadlineMs === null) {
      expect(gpsMock).not.toHaveBeenCalled();
    } else {
      expect(gpsMock).toHaveBeenCalledExactlyOnceWith({ mediaId: "med_admin", deadlineMs: gpsDeadlineMs });
    }
  });

  it("subtracts time spent waiting for after() before choosing the photo GPS deadline", async () => {
    scheduleReadyFollowUps({ mediaId: "med_admin", mimeType: "image/jpeg", sizeBytes: 1024, deadlineAt: now + 25_000 });
    vi.setSystemTime(now + 15_000);
    await tasks[1]!.run();

    expect(gpsMock).toHaveBeenCalledExactlyOnceWith({ mediaId: "med_admin", deadlineMs: 7_000 });
    expect(deriveMock).not.toHaveBeenCalled();
  });

  it("leaves photo GPS to cron if waiting for after() consumes its minimum window", async () => {
    scheduleReadyFollowUps({ mediaId: "med_admin", mimeType: "image/jpeg", sizeBytes: 1024, deadlineAt: now + 25_000 });
    vi.setSystemTime(now + 21_001);
    await tasks[1]!.run();

    expect(gpsMock).not.toHaveBeenCalled();
  });

  it("subtracts time spent waiting for after() and the checksum before choosing derive's deadline", async () => {
    scheduleReadyFollowUps({ mediaId: "med_admin", mimeType: "image/jpeg", sizeBytes: 1024, deadlineAt: now + 20_000 });
    vi.setSystemTime(now + 4_000);
    findMediaMock.mockImplementationOnce(async () => {
      vi.setSystemTime(now + 10_000);
      return { status: "READY", checksumSha256: "a".repeat(64) };
    });
    await tasks[0]!.run();

    expect(deriveMock).toHaveBeenCalledExactlyOnceWith({ mediaId: "med_admin", deadlineMs: 7_000 });
  });

  it("skips derive if the checksum consumes the remaining minimum window", async () => {
    scheduleReadyFollowUps({ mediaId: "med_admin", mimeType: "image/jpeg", sizeBytes: 1024, deadlineAt: now + 20_000 });
    findMediaMock.mockImplementationOnce(async () => {
      vi.setSystemTime(now + 12_001);
      return { status: "READY", checksumSha256: "a".repeat(64) };
    });
    await tasks[0]!.run();

    expect(deriveMock).not.toHaveBeenCalled();
  });
});

describe("scheduleReadyFollowUps without a caller deadline", () => {
  it("preserves the claim page's derive budget and photo GPS call", async () => {
    scheduleReadyFollowUps({ mediaId: "med_claim", mimeType: "image/jpeg", sizeBytes: 1024 });
    vi.setSystemTime(now + 60_000);
    for (const task of tasks) { await task.run(); }

    expect(deriveMock).toHaveBeenCalledExactlyOnceWith({ mediaId: "med_claim", deadlineMs: 20_000 });
    expect(gpsMock).toHaveBeenCalledExactlyOnceWith({ mediaId: "med_claim" });
  });
});
