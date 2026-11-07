import { describe, expect, it } from "vitest";

import { hasLocationReader, LOCATION_READER_MIME_TYPES } from "@/lib/media-location";
import { ALLOWED_MIME_TYPES } from "@/lib/media-types";

describe("media location eligibility", () => {
  const supported = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif", "video/quicktime", "video/mp4"];

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
