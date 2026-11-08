import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The frame service runs only `ffmpeg-static`'s own binary, the one `scripts/check-traces.ts` verifies against its
 * pinned SHA-256 (TCR B1-1). `ffmpeg-static` returns `FFMPEG_BIN`'s value instead of that binary's path when the
 * variable is set, so the factory refuses to start while it is set, in every environment.
 */

const PACKAGE_BINARY = "/repo/node_modules/ffmpeg-static/ffmpeg";
vi.mock("ffmpeg-static", () => ({ default: PACKAGE_BINARY }));

/** The factory from a fresh module graph, and the binary path of a service it made. */
async function freshFactory() {
  vi.resetModules();
  const { createVideoFrameService, FfmpegVideoFrameService } = await import("@/services/video-frames");
  const binaryOf = (service: unknown) => {
    expect(service).toBeInstanceOf(FfmpegVideoFrameService);
    return (service as InstanceType<typeof FfmpegVideoFrameService>).binaryPath;
  };
  return { createVideoFrameService, binaryOf };
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createVideoFrameService and FFMPEG_BIN", () => {
  it("runs ffmpeg-static's own binary when FFMPEG_BIN is not set", async () => {
    vi.stubEnv("FFMPEG_BIN", "");
    const { createVideoFrameService, binaryOf } = await freshFactory();
    expect(binaryOf(createVideoFrameService())).toBe(PACKAGE_BINARY);
  });

  it.each(["production", "development", "test"])("refuses to start while FFMPEG_BIN is set (NODE_ENV %s), naming the variable", async (nodeEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("FFMPEG_BIN", "/tmp/another-ffmpeg");
    const { createVideoFrameService, binaryOf } = await freshFactory();
    expect(() => createVideoFrameService()).toThrow(/FFMPEG_BIN is set/);
    // Never cached: once the variable is gone, the next call starts on the pinned binary.
    vi.stubEnv("FFMPEG_BIN", "");
    expect(binaryOf(createVideoFrameService())).toBe(PACKAGE_BINARY);
  });

  it("does not echo the variable's value in the refusal", async () => {
    vi.stubEnv("FFMPEG_BIN", "/secret/path/ffmpeg");
    const { createVideoFrameService } = await freshFactory();
    expect(() => createVideoFrameService()).toThrow(expect.objectContaining({ message: expect.not.stringContaining("/secret/path") }));
  });
});
