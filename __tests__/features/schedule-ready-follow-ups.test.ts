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
const findMediaMock = vi.fn<() => Promise<{ status: string; checksumSha256: string | null; storageKey?: string }>>(async () => ({ status: "READY", checksumSha256: "a".repeat(64) }));
const updateMediaMock = vi.fn();
vi.mock("@/server/db/client", () => ({ getDb: () => ({ media: { findUnique: findMediaMock, update: updateMediaMock } }) }));
const getMock = vi.fn();
vi.mock("@/services/storage", () => ({ createStorageService: () => ({ get: getMock }) }));
const { infoMock, logErrorMock } = vi.hoisted(() => ({ infoMock: vi.fn(), logErrorMock: vi.fn() }));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ info: infoMock }), logError: logErrorMock, logErrorAndFlush: logErrorMock }));

const now = new Date("2026-11-07T12:00:00Z").getTime();

beforeEach(() => {
  tasks.length = 0;
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
    return controller.signal;
  });
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

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
  ])("leaves derive to cron with only $remainingMs ms left, budgeting checksum and photo GPS", async ({ remainingMs, gpsDeadlineMs }) => {
    scheduleReadyFollowUps({ mediaId: "med_admin", mimeType: "image/jpeg", sizeBytes: 1024, deadlineAt: now + remainingMs });
    for (const task of tasks) { await task.run(); }

    if (remainingMs >= 4_000) {
      expect(findMediaMock).toHaveBeenCalledWith({ where: { id: "med_admin" } });
    } else {
      expect(findMediaMock).not.toHaveBeenCalled();
    }
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

  it("bounds a stalled checksum using the time left when its deferred task starts", async () => {
    findMediaMock.mockResolvedValueOnce({ status: "READY", checksumSha256: null, storageKey: "originals/m/a.jpg" });
    const cancel = vi.fn();
    getMock.mockImplementationOnce(async (_key: string, options?: { signal?: AbortSignal }) => {
      if (!options?.signal) { throw new Error("checksum missing deadline"); }
      return { stream: new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}), cancel }) };
    });
    scheduleReadyFollowUps({ mediaId: "med_admin", mimeType: "image/jpeg", sizeBytes: 1024, deadlineAt: now + 25_000 });
    vi.setSystemTime(now + 10_000);
    const completed = expect(tasks[0]!.run()).resolves.toBeUndefined();
    await Promise.all([completed, vi.advanceTimersByTimeAsync(12_000)]);
    expect(AbortSignal.timeout).toHaveBeenCalledExactlyOnceWith(12_000);
    expect(cancel).toHaveBeenCalledOnce();
    expect(updateMediaMock).not.toHaveBeenCalled();
    expect(deriveMock).not.toHaveBeenCalled();
    expect(infoMock).toHaveBeenCalledWith({ action: "checksum_deferred", mediaId: "med_admin" }, expect.any(String));
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("does not start a checksum if waiting for after consumes its minimum window", async () => {
    scheduleReadyFollowUps({ mediaId: "med_admin", mimeType: "image/jpeg", sizeBytes: 1024, deadlineAt: now + 25_000 });
    vi.setSystemTime(now + 21_001);
    await tasks[0]!.run();
    expect(findMediaMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
    expect(deriveMock).not.toHaveBeenCalled();
  });

  it("propagates a checksum storage failure even if the deadline has also fired", async () => {
    findMediaMock.mockResolvedValueOnce({ status: "READY", checksumSha256: null, storageKey: "originals/m/a.jpg" });
    getMock.mockImplementationOnce(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
      throw new Error("storage unavailable");
    });
    scheduleReadyFollowUps({ mediaId: "med_admin", mimeType: "image/jpeg", sizeBytes: 1024, deadlineAt: now + 15_000 });
    await expect(tasks[0]!.run()).rejects.toThrow("storage unavailable");
    expect(infoMock).not.toHaveBeenCalled();
    expect(updateMediaMock).not.toHaveBeenCalled();
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
    expect(AbortSignal.timeout).not.toHaveBeenCalled();
  });
  it("hashes without a signal and keeps the full derive budget even after a long checksum", async () => {
    findMediaMock.mockResolvedValueOnce({ status: "READY", checksumSha256: null, storageKey: "originals/m/a.jpg" });
    getMock.mockImplementationOnce(async () => {
      vi.setSystemTime(now + 60_000);
      return { stream: new Blob(["abc"]).stream() };
    });
    scheduleReadyFollowUps({ mediaId: "med_claim", mimeType: "image/jpeg", sizeBytes: 3 });
    await tasks[0]!.run();
    expect(getMock).toHaveBeenCalledExactlyOnceWith("originals/m/a.jpg");
    expect(updateMediaMock).toHaveBeenCalledExactlyOnceWith({ where: { id: "med_claim" }, data: { checksumSha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" } });
    expect(deriveMock).toHaveBeenCalledExactlyOnceWith({ mediaId: "med_claim", deadlineMs: 20_000 });
    expect(AbortSignal.timeout).not.toHaveBeenCalled();
  });
});
