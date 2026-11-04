import { beforeEach, describe, expect, it, vi } from "vitest";

const countMock = vi.fn();
const distributionMock = vi.fn();
vi.mock("@sentry/nextjs", () => ({ metrics: { count: (...a: unknown[]) => countMock(...a), distribution: (...a: unknown[]) => distributionMock(...a) } }));

import { confirmationSent, memoryCreated, reconcileRun, uploadFinalized } from "@/lib/sentry/metrics";

beforeEach(() => {
  countMock.mockClear();
  distributionMock.mockClear();
});

describe("metrics wrappers (plan §8.7)", () => {
  it("memoryCreated counts the memories of a send", () => {
    memoryCreated(3);
    expect(countMock).toHaveBeenCalledWith("memory.created", 3);
  });

  it("uploadFinalized counts one upload with its status", () => {
    uploadFinalized("READY");
    expect(countMock).toHaveBeenCalledWith("upload.finalized", 1, { attributes: { status: "READY" } });
  });

  it("confirmationSent counts one confirmation with its outcome", () => {
    confirmationSent("sent");
    confirmationSent("already_sent");
    expect(countMock.mock.calls).toEqual([
      ["confirmation.sent", 1, { attributes: { outcome: "sent" } }],
      ["confirmation.sent", 1, { attributes: { outcome: "already_sent" } }],
    ]);
  });

  it("reconcileRun records the run's duration in milliseconds with its error count", () => {
    reconcileRun(1234, 2);
    expect(distributionMock).toHaveBeenCalledWith("reconcile.run", 1234, { unit: "millisecond", attributes: { errors: 2 } });
  });
});
