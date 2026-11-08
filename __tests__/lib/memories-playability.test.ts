import { describe, expect, it } from "vitest";

import { originalPlayablePublicly, publicPlayability } from "@/lib/memories/playability";
import { ALLOWED_MIME_TYPES } from "@/lib/media-types";

const CHECKED = new Date("2026-11-07T12:00:00Z");
/** A complete parse with no location: the only MP4-family state that plays (TCR round 1, B1-1). */
const clean = { gpsCheckedAt: CHECKED, latitude: null, longitude: null, gpsScanComplete: true };
const located = { gpsCheckedAt: CHECKED, latitude: 39.4815, longitude: -76.6447, gpsScanComplete: true };
const unscanned = { gpsCheckedAt: null, latitude: null, longitude: null, gpsScanComplete: null };
/** Decided absent, but the reader stopped early (a limit, a malformed or unsupported box): not vouched for. */
const gaveUp = { gpsCheckedAt: CHECKED, latitude: null, longitude: null, gpsScanComplete: false };
/** Decided absent before the completeness flag existed: waits until a rescan. */
const legacy = { gpsCheckedAt: CHECKED, latitude: null, longitude: null, gpsScanComplete: null };

describe("originalPlayablePublicly (plan 2026-11-08 D16)", () => {
  it.each(["audio/webm", "audio/ogg", "audio/wav", "audio/mpeg", "video/webm"])("plays a %s original without a location scan (no location reader, browser-recorded formats)", (mimeType) => {
    expect(originalPlayablePublicly({ mimeType, ...unscanned })).toBe(true);
  });

  it.each(["video/quicktime", "video/mp4", "audio/mp4", "audio/x-m4a"])("plays a %s original only once a complete scan found no location", (mimeType) => {
    expect(originalPlayablePublicly({ mimeType, ...clean })).toBe(true);
    expect(originalPlayablePublicly({ mimeType, ...unscanned })).toBe(false);
    expect(originalPlayablePublicly({ mimeType, ...located })).toBe(false);
  });

  it.each(["video/quicktime", "video/mp4", "audio/mp4", "audio/x-m4a"])("never plays a %s original whose scan gave up or predates the completeness flag (TCR round 1, B1-1)", (mimeType) => {
    expect(originalPlayablePublicly({ mimeType, ...gaveUp })).toBe(false);
    expect(originalPlayablePublicly({ mimeType, ...legacy })).toBe(false);
  });

  it("refuses a gated original whose coordinates exist even without a decision stamp (never trust a half-written row)", () => {
    expect(originalPlayablePublicly({ mimeType: "video/quicktime", gpsCheckedAt: null, latitude: 39.4, longitude: -76.6, gpsScanComplete: true })).toBe(false);
    expect(originalPlayablePublicly({ mimeType: "video/quicktime", gpsCheckedAt: null, latitude: null, longitude: null, gpsScanComplete: true })).toBe(false);
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
    expect(publicPlayability({ mimeType: "video/mp4", ...gaveUp, webCopyReady: false })).toBe("waiting");
    expect(publicPlayability({ mimeType: "audio/webm", ...unscanned, webCopyReady: false })).toBe("yes");
  });
});
