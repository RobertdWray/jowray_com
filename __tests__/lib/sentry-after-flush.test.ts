import { beforeEach, describe, expect, it, vi } from "vitest";

const afterCalls: Array<() => Promise<void>> = [];
vi.mock("next/server", () => ({ after: (cb: () => Promise<void>) => { afterCalls.push(cb); } }));

const startSpanMock = vi.fn(async (_options: unknown, callback: () => Promise<void>) => callback());
const flushMock = vi.fn(async (_timeout: number) => true);
vi.mock("@sentry/nextjs", () => ({ startSpan: (options: unknown, callback: () => Promise<void>) => startSpanMock(options, callback), flush: (timeout: number) => flushMock(timeout) }));

const logErrorMock = vi.fn();
const warnMock = vi.fn();
vi.mock("@/lib/logger", () => ({ logError: (...a: unknown[]) => logErrorMock(...a), logger: { warn: (...a: unknown[]) => warnMock(...a) } }));

import { afterWithFlush } from "@/lib/sentry/after-flush";

async function runDeferred(): Promise<void> {
  const callback = afterCalls.shift();
  if (!callback) {
    throw new Error("nothing was deferred");
  }
  await callback();
}

beforeEach(() => {
  afterCalls.length = 0;
  startSpanMock.mockClear();
  flushMock.mockClear();
  logErrorMock.mockClear();
  warnMock.mockClear();
});

describe("afterWithFlush (plan §8.9: one span per deferred task, catch and flush kept)", () => {
  it("defers the callback, runs it inside a named task span and flushes afterwards", async () => {
    const work = vi.fn(async () => undefined);
    afterWithFlush("finalize.derive", work);
    expect(work).not.toHaveBeenCalled();
    await runDeferred();
    expect(startSpanMock).toHaveBeenCalledWith({ name: "finalize.derive", op: "task" }, expect.any(Function));
    expect(work).toHaveBeenCalledTimes(1);
    expect(flushMock).toHaveBeenCalledWith(5000);
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("records a failing callback and still flushes", async () => {
    const failure = new Error("boom");
    afterWithFlush("upload.callback", async () => {
      throw failure;
    });
    await runDeferred();
    expect(logErrorMock).toHaveBeenCalledWith("after() callback failed", failure, { category: "api", task: "upload.callback" });
    expect(flushMock).toHaveBeenCalledTimes(1);
  });

  it("warns when the flush times out", async () => {
    flushMock.mockResolvedValueOnce(false);
    afterWithFlush("completion.alerts", async () => undefined);
    await runDeferred();
    expect(warnMock).toHaveBeenCalledWith({ category: "api", action: "sentry_flush_timeout", task: "completion.alerts" }, expect.stringContaining("flush timed out"));
  });
});
