import { describe, expect, it } from "vitest";

import { originalPlayablePublicly, publicPlayability } from "@/lib/memories/playability";
import { ALLOWED_MIME_TYPES } from "@/lib/media-types";

const CHECKED = new Date("2026-11-07T12:00:00Z");
const clean = { gpsCheckedAt: CHECKED, latitude: null, longitude: null };
const located = { gpsCheckedAt: CHECKED, latitude: 39.4815, longitude: -76.6447 };
const unscanned = { gpsCheckedAt: null, latitude: null, longitude: null };

describe("originalPlayablePublicly (plan 2026-11-08 D16)", () => {
  it.each(["audio/webm", "audio/ogg", "audio/wav", "audio/mpeg", "video/webm"])("plays a %s original without a location scan (no location reader, browser-recorded formats)", (mimeType) => {
    expect(originalPlayablePublicly({ mimeType, ...unscanned })).toBe(true);
  });

  it.each(["video/quicktime", "video/mp4", "audio/mp4", "audio/x-m4a"])("plays a %s original only once its scan decided there is no location", (mimeType) => {
    expect(originalPlayablePublicly({ mimeType, ...clean })).toBe(true);
    expect(originalPlayablePublicly({ mimeType, ...unscanned })).toBe(false);
    expect(originalPlayablePublicly({ mimeType, ...located })).toBe(false);
  });

  it("refuses a gated original whose coordinates exist even without a decision stamp (never trust a half-written row)", () => {
    expect(originalPlayablePublicly({ mimeType: "video/quicktime", gpsCheckedAt: null, latitude: 39.4, longitude: -76.6 })).toBe(false);
  });

  it.each(["image/jpeg", "image/heic", "image/png", "image/gif", "image/webp", "image/heif"])("never streams a %s original: photos are shown only from server-made copies", (mimeType) => {
    expect(originalPlayablePublicly({ mimeType, ...clean })).toBe(false);
  });

  it.each(["application/pdf", "text/html", "image/svg+xml", "video/avi", "", "constructor"])("refuses an unknown type %j", (mimeType) => {
    expect(originalPlayablePublicly({ mimeType, ...clean })).toBe(false);
  });

  it("decides every type on the upload allowlist explicitly", () => {
    const decided = ALLOWED_MIME_TYPES.map((mimeType) => [mimeType, originalPlayablePublicly({ mimeType, ...clean })]);
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
    expect(publicPlayability({ mimeType: "image/heic", ...located, webCopyReady: true })).toBe("yes");
    expect(publicPlayability({ mimeType: "image/jpeg", ...unscanned, webCopyReady: false })).toBe("waiting");
  });

  it("follows originalPlayablePublicly for recordings and videos", () => {
    expect(publicPlayability({ mimeType: "video/quicktime", ...clean, webCopyReady: false })).toBe("yes");
    expect(publicPlayability({ mimeType: "video/quicktime", ...located, webCopyReady: false })).toBe("waiting");
    expect(publicPlayability({ mimeType: "audio/x-m4a", ...unscanned, webCopyReady: false })).toBe("waiting");
    expect(publicPlayability({ mimeType: "audio/webm", ...unscanned, webCopyReady: false })).toBe("yes");
  });
});
