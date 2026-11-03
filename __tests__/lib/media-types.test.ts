import { describe, expect, it } from "vitest";

import {
  ACCEPT_ATTRIBUTE,
  extensionFor,
  isAllowedMime,
  isRenderableIn,
  maxBytesFor,
  memoryTypeFor,
  normalizeMime,
} from "@/lib/media-types";

describe("normalizeMime", () => {
  it("strips parameters and lower-cases", () => {
    expect(normalizeMime("audio/webm;codecs=opus", "clip.webm")).toBe("audio/webm");
    expect(normalizeMime("Image/JPEG", "a.jpg")).toBe("image/jpeg");
  });

  it("maps an empty browser type from the extension", () => {
    expect(normalizeMime("", "IMG_0001.HEIC")).toBe("image/heic");
    expect(normalizeMime("", "clip.mov")).toBe("video/quicktime");
    expect(normalizeMime("", "voice.m4a")).toBe("audio/x-m4a");
    expect(normalizeMime("", "x.mp4")).toBe("video/mp4");
  });

  it("returns null when nothing usable is known", () => {
    expect(normalizeMime("", "notes.txt")).toBeNull();
    expect(normalizeMime("application/octet-stream", "blob")).toBeNull();
  });
});

describe("allowlist and limits", () => {
  it("allows the iPhone defaults and rejects svg/html", () => {
    for (const m of ["image/heic", "video/quicktime", "audio/mp4", "image/jpeg", "audio/webm"]) {
      expect(isAllowedMime(m)).toBe(true);
    }
    expect(isAllowedMime("image/svg+xml")).toBe(false);
    expect(isAllowedMime("text/html")).toBe(false);
  });

  it("caps sizes per type", () => {
    expect(maxBytesFor("image/png")).toBe(25 * 1024 * 1024);
    expect(maxBytesFor("audio/mpeg")).toBe(100 * 1024 * 1024);
    expect(maxBytesFor("video/webm")).toBe(500 * 1024 * 1024);
  });

  it("maps MIME to memory type and extension", () => {
    expect(memoryTypeFor("image/heic")).toBe("PHOTO");
    expect(memoryTypeFor("audio/mp4")).toBe("VOICE");
    expect(memoryTypeFor("video/mp4")).toBe("VIDEO");
    expect(extensionFor("audio/webm")).toBe("webm");
    expect(extensionFor("video/quicktime")).toBe("mov");
    expect(extensionFor("image/jpeg")).toBe("jpg");
  });

  it("exposes an accept attribute built from the allowlist", () => {
    expect(ACCEPT_ATTRIBUTE).toContain("image/heic");
    expect(ACCEPT_ATTRIBUTE).toContain(".heic");
    expect(ACCEPT_ATTRIBUTE).not.toContain("svg");
  });
});

describe("isRenderableIn", () => {
  const safari =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1";
  const chrome =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

  it("HEIC renders only in Safari", () => {
    expect(isRenderableIn("image/heic", safari)).toBe(true);
    expect(isRenderableIn("image/heic", chrome)).toBe(false);
    expect(isRenderableIn("image/heic", null)).toBe(false);
  });

  it("common types render everywhere", () => {
    expect(isRenderableIn("image/jpeg", chrome)).toBe(true);
    expect(isRenderableIn("video/mp4", null)).toBe(true);
  });
});
