import { beforeEach, describe, expect, it, vi } from "vitest";

const captureMock = vi.fn((..._args: unknown[]) => "event-id");
vi.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureMock(...a) }));

import { reportClientError } from "@/lib/sentry/report";

const TEST_TOKEN = "SENTRYTEST_" + "r".repeat(32);

beforeEach(() => {
  captureMock.mockClear();
});

describe("reportClientError (plan §8.6: swallowed browser errors)", () => {
  it("captures the error with surface and step as tags and the rest of the context as scrubbed extra", () => {
    const error = new Error("fetch failed");
    reportClientError(error, { surface: "share-form", step: "upload", mediaId: "med_1", claimToken: TEST_TOKEN, url: `/api/media/1?t=${TEST_TOKEN}` });
    expect(captureMock).toHaveBeenCalledTimes(1);
    const [captured, context] = captureMock.mock.calls[0] as unknown as [unknown, { tags: Record<string, string>; extra: Record<string, unknown> }];
    expect(captured).toBe(error);
    expect(context.tags).toEqual({ surface: "share-form", step: "upload" });
    expect(context.extra).toEqual({ mediaId: "med_1", claimToken: "[Filtered]", url: "/api/media/1" });
    expect(JSON.stringify(context)).not.toContain(TEST_TOKEN);
  });

  it("returns the event id and sends an empty extra when there is nothing beyond surface and step", () => {
    expect(reportClientError("not an Error", { surface: "recorder", step: "stop" })).toBe("event-id");
    expect(captureMock).toHaveBeenCalledWith("not an Error", { tags: { surface: "recorder", step: "stop" }, extra: {} });
  });
});
