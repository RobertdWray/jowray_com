import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MediaGallery } from "@/app/admin/media-gallery";
import type { AdminMediaView } from "@/features/admin/get-memory";

const VIDEO_ID = "00000000-0000-4000-8000-0000000000e1";

function video(over: Partial<AdminMediaView> = {}): AdminMediaView {
  return {
    id: VIDEO_ID, status: "READY", mimeType: "video/mp4", originalFilename: "clip.mp4", durationSeconds: 30, width: 1920, height: 1080,
    caption: null, approxDateText: null, place: null, sortOrder: 0, replacesMediaId: null, webReady: false, thumbReady: false, posterReady: true, purged: false,
    ...over,
  };
}

/** The `<video>` opening tag of the gallery's markup. */
function videoTag(media: AdminMediaView[]): string {
  const tag = /<video\b[^>]*>/.exec(renderToStaticMarkup(createElement(MediaGallery, { media })))?.[0];
  if (!tag) {
    throw new Error("no <video> in the markup");
  }
  return tag;
}

/**
 * The admin gallery's videos (video posters T12, [C26]): with `preload="none"` no frame loads before play, so a
 * READY POSTER is shown through `poster`, from the cookie-gated admin route's `?v=thumb` (D7: an image or a 404,
 * never the video). Without one the player is as it was.
 */
describe("MediaGallery video posters (video posters T12)", () => {
  it("points the player's poster at the admin thumb route when the POSTER is READY, and still preloads nothing", () => {
    const tag = videoTag([video()]);
    expect(tag).toContain(`poster="/admin/media/${VIDEO_ID}?v=thumb"`);
    expect(tag).toContain(`src="/admin/media/${VIDEO_ID}"`);
    expect(tag).toContain('preload="none"');
  });

  it("has no poster attribute while the POSTER is not READY", () => {
    const tag = videoTag([video({ posterReady: false })]);
    expect(tag).not.toMatch(/\bposter=/);
    expect(tag).toContain('preload="none"');
  });
});
