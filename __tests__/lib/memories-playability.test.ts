import { describe, expect, it } from "vitest";

import { originalPlayablePublicly, publicPlayability } from "@/lib/memories/playability";
import { ALLOWED_MIME_TYPES } from "@/lib/media-types";

const RECORDINGS_AND_VIDEOS = ["video/quicktime", "video/mp4", "video/webm", "audio/mp4", "audio/x-m4a", "audio/mpeg", "audio/webm", "audio/ogg", "audio/wav"];

describe("originalPlayablePublicly (Rob, 2026-11-08: recordings and videos play as recorded)", () => {
  it.each(RECORDINGS_AND_VIDEOS)("plays a %s original as it is, location and all", (mimeType) => {
    expect(originalPlayablePublicly(mimeType)).toBe(true);
  });

  it.each(["image/jpeg", "image/heic", "image/png", "image/gif", "image/webp", "image/heif"])("never streams a %s original: photos are shown only from server-made copies", (mimeType) => {
    expect(originalPlayablePublicly(mimeType)).toBe(false);
  });

  it.each(["application/pdf", "text/html", "image/svg+xml", "video/avi", "", "constructor"])("refuses an unknown type %j", (mimeType) => {
    expect(originalPlayablePublicly(mimeType)).toBe(false);
  });

  it("decides every type on the upload allowlist explicitly", () => {
    const decided = ALLOWED_MIME_TYPES.map((mimeType) => [mimeType, originalPlayablePublicly(mimeType)]);
    expect(Object.fromEntries(decided)).toEqual({
      "image/jpeg": false,
      "image/png": false,
      "image/webp": false,
      "image/heic": false,
      "image/heif": false,
      "image/gif": false,
      "audio/mp4": true,
      "audio/x-m4a": true,
      "audio/mpeg": true,
      "audio/webm": true,
      "audio/ogg": true,
      "audio/wav": true,
      "video/mp4": true,
      "video/quicktime": true,
      "video/webm": true,
    });
  });
});

describe("publicPlayability", () => {
  it("is yes for a photo with a ready server-made copy and waiting without one", () => {
    expect(publicPlayability({ mimeType: "image/heic", webCopyReady: true })).toBe("yes");
    expect(publicPlayability({ mimeType: "image/jpeg", webCopyReady: false })).toBe("waiting");
  });

  it.each(RECORDINGS_AND_VIDEOS)("is yes for a %s at once: there is no copy to wait for", (mimeType) => {
    expect(publicPlayability({ mimeType, webCopyReady: false })).toBe("yes");
  });

  it("is waiting for a type the site does not accept", () => {
    expect(publicPlayability({ mimeType: "video/avi", webCopyReady: false })).toBe("waiting");
  });
});
