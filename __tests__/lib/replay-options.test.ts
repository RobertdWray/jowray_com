import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { REPLAY_OPTIONS } from "@/lib/sentry/replay-options";

describe("Replay unmasking (R12, D20)", () => {
  it("records text, inputs, media and attributes, including placeholders", () => {
    expect(REPLAY_OPTIONS).toEqual({
      maskAllText: false,
      maskAllInputs: false,
      blockAllMedia: false,
      maskAttributes: [],
      networkCaptureBodies: true,
    });
  });

  it("uses the tested options in the browser integration alongside the runtime settings", () => {
    const source = readFileSync(new URL("../../instrumentation-client.ts", import.meta.url), "utf8");
    expect(source).toMatch(/import\s*\{\s*REPLAY_OPTIONS\s*\}\s*from\s*["']@\/lib\/sentry\/replay-options["']/);
    expect(source).toMatch(/Sentry\.replayIntegration\(\{\s*\.\.\.REPLAY_OPTIONS,/);
    expect(source).toContain("networkDetailAllowUrls: [window.location.origin]");
    expect(source).toContain("beforeAddRecordingEvent: scrubRecordingEvent");
  });
});
