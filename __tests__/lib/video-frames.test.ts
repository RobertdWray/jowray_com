import { describe, expect, it } from "vitest";

import { FRAME_SERVER_PREFIX, REDACTED_FRAME_URL, redactFrameUrls } from "@/lib/video-frames";

/**
 * ffmpeg names its input in open and read errors, and the input is the loopback frame server's URL with its port and
 * nonce. These are stderr lines as the two shipped binaries write them (6.0 on darwin, 7.0.2 on linux-x64); the
 * 6.0 lines were captured from the darwin binary on 2026-11-08, the 7.0 ones follow `fftools/ffmpeg_demux.c`.
 */
const NONCE = "0f6a1c7e-3f1a-4b5e-9c2d-1234567890ab";
const URL_6 = `http://127.0.0.1:61234${FRAME_SERVER_PREFIX}${NONCE}`;

describe("redactFrameUrls", () => {
  it("removes the port and nonce from ffmpeg 6.0's input errors, keeping everything else", () => {
    const stderr = [
      "[mov,mp4,m4a,3gp,3g2,mj2 @ 0x14be04a80] moov atom not found",
      `${URL_6}: Invalid data found when processing input`,
      "[tcp @ 0x151e16280] Connection to tcp://127.0.0.1:61234 failed: Connection refused",
      `${URL_6}: Connection refused`,
    ].join("\n");
    const redacted = redactFrameUrls(stderr);
    expect(redacted).toBe([
      "[mov,mp4,m4a,3gp,3g2,mj2 @ 0x14be04a80] moov atom not found",
      `${REDACTED_FRAME_URL}: Invalid data found when processing input`,
      "[tcp @ 0x151e16280] Connection to tcp://127.0.0.1:61234 failed: Connection refused",
      `${REDACTED_FRAME_URL}: Connection refused`,
    ].join("\n"));
    expect(redacted).not.toContain(NONCE);
    expect(REDACTED_FRAME_URL).toBe("http://127.0.0.1/__frames/[nonce]");
  });

  it("removes them from ffmpeg 7.0's `Error opening input file <url>.` form, the sentence's full stop kept", () => {
    const stderr = [
      "[in#0 @ 0x600001d0c000] Error opening input: Invalid data found when processing input",
      `Error opening input file http://127.0.0.1:50000${FRAME_SERVER_PREFIX}${NONCE}.`,
      "Error opening input files: Invalid data found when processing input",
    ].join("\n");
    expect(redactFrameUrls(stderr)).toBe([
      "[in#0 @ 0x600001d0c000] Error opening input: Invalid data found when processing input",
      `Error opening input file ${REDACTED_FRAME_URL}.`,
      "Error opening input files: Invalid data found when processing input",
    ].join("\n"));
  });

  it("is idempotent and leaves other URLs alone", () => {
    const once = redactFrameUrls(`${URL_6}: Server returned 404 Not Found`);
    expect(redactFrameUrls(once)).toBe(once);
    const other = "http://127.0.0.1:61234/elsewhere and https://example.com/__frames/x";
    expect(redactFrameUrls(other)).toBe(other);
  });
});
