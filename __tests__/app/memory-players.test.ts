import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AudioPlayer } from "@/app/memories/_components/audio-player-client";
import { publicMediaHref } from "@/app/memories/_components/hrefs";
import { VideoPlayer } from "@/app/memories/_components/video-player";
import type { PublicMediaItem } from "@/lib/memories/types";

const VOICE_ID = "00000000-0000-4000-8000-0000000000c1";
const VIDEO_ID = "00000000-0000-4000-8000-0000000000c2";

/** The `<source>` element of the markup, so attribute checks cannot be satisfied by something else on the page. */
function sourceTag(html: string): string {
  const tag = /<source\b[^>]*>/.exec(html)?.[0];
  if (!tag) {
    throw new Error("no <source> in the markup");
  }
  return tag;
}

/**
 * The public players (PR #94, Team Code Review round 1, B1-1 and B1-2):
 * - `preload="none"`: opening a memory page requests nothing from `/api/public-media`, so a page view charges no
 *   viewer the whole original against the public allowance until they press play (plan D6 as amended).
 * - no `type` on the single `<source>`: a browser that answers `canPlayType` with "" for the stored mime type
 *   (Chrome for `video/quicktime`) skips a typed source without fetching it (HTML resource selection algorithm,
 *   plan [C50]); without the hint it sniffs the file, which it can often play.
 */
describe("public memory players (PR #94 TCR round 1, B1-1 and B1-2)", () => {
  it("renders the voice recording player with preload none and an untyped source", () => {
    const html = renderToStaticMarkup(createElement(AudioPlayer, { src: publicMediaHref(VOICE_ID, "web"), durationSeconds: 47, bars: [12, 30, 44] }));
    expect(html).toMatch(/<audio\b[^>]*\bpreload="none"/);
    expect(html).not.toContain('preload="metadata"');
    const source = sourceTag(html);
    expect(source).toContain(`src="/api/public-media/${VOICE_ID}?v=web"`);
    expect(source).not.toMatch(/\btype=/);
  });

  it("renders an iPhone MOV with preload none, inline controls, the web route and an untyped source", () => {
    const item: PublicMediaItem = {
      id: VIDEO_ID,
      kind: "VIDEO",
      mimeType: "video/quicktime",
      caption: "At the lake",
      durationSeconds: 125,
      width: 1920,
      height: 1080,
      hasThumb: false,
      playable: "yes",
    };
    const html = renderToStaticMarkup(createElement(VideoPlayer, { item }));
    const video = /<video\b[^>]*>/.exec(html)?.[0] ?? "";
    expect(video).toContain('preload="none"');
    expect(video).toMatch(/\bcontrols(=""|\s|>)/);
    expect(video).toMatch(/\bplaysinline(=""|\s|>)/i);
    expect(html).not.toContain('preload="metadata"');
    const source = sourceTag(html);
    expect(source).toContain(`src="/api/public-media/${VIDEO_ID}?v=web"`);
    expect(source).not.toMatch(/\btype=/);
    expect(html).not.toContain("video/quicktime");
    expect(html).toContain("At the lake · 2 min");
  });

  it("says nothing plays until pressed when a video has neither a caption nor a duration", () => {
    const item: PublicMediaItem = {
      id: VIDEO_ID,
      kind: "VIDEO",
      mimeType: "video/mp4",
      caption: null,
      durationSeconds: null,
      width: null,
      height: null,
      hasThumb: false,
      playable: "yes",
    };
    const html = renderToStaticMarkup(createElement(VideoPlayer, { item }));
    expect(html).toContain("Nothing plays until you press it.");
  });
});
