import { describe, expect, it } from "vitest";

import { hasLocationReader, isMp4Container, LOCATION_READER_MIME_TYPES, MP4_CONTAINER_MIME_TYPES } from "@/lib/media-location";
import { ALLOWED_MIME_TYPES } from "@/lib/media-types";

describe("media location eligibility", () => {
  // M4A (audio/mp4, audio/x-m4a) is the same container as MOV/MP4 and can carry a location (plan 2026-11-08 D16).
  const supported = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif", "video/quicktime", "video/mp4", "audio/mp4", "audio/x-m4a"];

  it.each(supported)("has a location reader for %s", (mimeType) => {
    expect(hasLocationReader(mimeType)).toBe(true);
  });

  it.each([...ALLOWED_MIME_TYPES.filter((mimeType) => !supported.includes(mimeType)), "image/svg+xml", "image/tiff", "video/avi", "application/octet-stream", "", "constructor"])("has no location reader for %s", (mimeType) => {
    expect(hasLocationReader(mimeType)).toBe(false);
  });

  it("exposes exactly the supported canonical types for database queries", () => {
    expect([...LOCATION_READER_MIME_TYPES].sort()).toEqual([...supported].sort());
  });
});

describe("isMp4Container", () => {
  it("routes MOV, MP4 and M4A to the MP4-container reader and nothing else", () => {
    expect([...MP4_CONTAINER_MIME_TYPES].sort()).toEqual(["audio/mp4", "audio/x-m4a", "video/mp4", "video/quicktime"]);
    for (const mimeType of ["video/quicktime", "video/mp4", "audio/mp4", "audio/x-m4a"]) {
      expect(isMp4Container(mimeType)).toBe(true);
    }
    for (const mimeType of ["image/jpeg", "image/heic", "video/webm", "audio/webm", "audio/mpeg", ""]) {
      expect(isMp4Container(mimeType)).toBe(false);
    }
  });
});
