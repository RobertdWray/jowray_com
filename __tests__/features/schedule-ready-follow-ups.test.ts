import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scheduleReadyFollowUps } from "@/features/memories/ingest-upload";

const tasks: Array<{ name: string; run: () => Promise<void> }> = [];
vi.mock("@/lib/sentry/after-flush", () => ({
  afterWithFlush: (name: string, run: () => Promise<void>) => { tasks.push({ name, run }); },
}));
const deriveMock = vi.fn(async (_input: { mediaId: string; deadlineMs: number }) => undefined);
vi.mock("@/features/memories/derive-media", () => ({ deriveMedia: (input: { mediaId: string; deadlineMs: number }) => deriveMock(input) }));
const gpsMock = vi.fn(async (_input: { mediaId: string }) => "found");
vi.mock("@/features/media/extract-photo-gps", () => ({ extractPhotoGps: (input: { mediaId: string }) => gpsMock(input) }));
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
    { remainingMs: 15_000, deadlineMs: 12_000 },
    { remainingMs: 60_000, deadlineMs: 20_000 },
    { remainingMs: 8_000, deadlineMs: 5_000 },
  ])("allows $deadlineMs ms for derive with $remainingMs ms left", async ({ remainingMs, deadlineMs }) => {
    scheduleReadyFollowUps({ mediaId: "med_admin", mimeType: "image/jpeg", sizeBytes: 1024, deadlineAt: now + remainingMs });

    expect(tasks.map((task) => task.name)).toEqual(["finalize.checksum_and_derive", "finalize.photo_gps"]);
    expect(deriveMock).not.toHaveBeenCalled();
    for (const task of tasks) { await task.run(); }

    expect(findMediaMock).toHaveBeenCalledWith({ where: { id: "med_admin" } });
    expect(deriveMock).toHaveBeenCalledExactlyOnceWith({ mediaId: "med_admin", deadlineMs });
    expect(gpsMock).toHaveBeenCalledExactlyOnceWith({ mediaId: "med_admin" });
  });

  it.each([7_999, 3_000, -1])("leaves derive to cron with only %i ms left, while keeping checksum and photo GPS", async (remainingMs) => {
    scheduleReadyFollowUps({ mediaId: "med_admin", mimeType: "image/jpeg", sizeBytes: 1024, deadlineAt: now + remainingMs });
    for (const task of tasks) { await task.run(); }

    expect(findMediaMock).toHaveBeenCalledWith({ where: { id: "med_admin" } });
    expect(deriveMock).not.toHaveBeenCalled();
    expect(gpsMock).toHaveBeenCalledExactlyOnceWith({ mediaId: "med_admin" });
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
