import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MemoryCard, VideoSlot } from "@/app/memories/_components/memory-card";
import type { PublicMemory } from "@/lib/memories/types";

const VIDEO_ID = "00000000-0000-4000-8000-0000000000d1";

function videoMemory(overrides: Partial<PublicMemory> = {}): PublicMemory {
  return {
    id: "00000000-0000-4000-8000-000000000001", kind: "VIDEO", who: "Ellen Kerrigan", relationship: null, note: null,
    when: "Summer 1998", year: 1998, month: null, place: null, point: null, tags: [],
    durationSeconds: 125, photos: [], poster: { mediaId: VIDEO_ID, width: 1000, height: 562 }, playable: "yes",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** The opening tag of the first element whose class list holds every one of `classes`. */
function tagWithClasses(html: string, ...classes: string[]): string {
  for (const [tag] of html.matchAll(/<[a-z]+\b[^>]*\bclass="[^"]*"[^>]*>/g)) {
    const list = /\bclass="([^"]*)"/.exec(tag)?.[1]?.split(/\s+/) ?? [];
    if (classes.every((c) => list.includes(c))) {
      return tag;
    }
  }
  throw new Error(`no element with classes ${classes.join(" ")}`);
}

/**
 * The video card's picture (video posters T11, [C27]): the server-made POSTER as a decorative fill image over
 * today's dashed slot. The fill image is absolutely positioned, so it would paint over the play badge and the
 * duration pill unless both sit in positioned layers above it. A failed load only removes the image (FallbackImage),
 * which leaves the slot exactly as it was before posters.
 */
describe("VideoSlot with a poster (video posters T11)", () => {
  const html = renderToStaticMarkup(createElement(VideoSlot, { memory: videoMemory() }));

  it("renders the poster as a decorative fill image from the public thumb route, before the badge", () => {
    const img = /<img\b[^>]*>/.exec(html)?.[0] ?? "";
    expect(img).toContain(`src="/api/public-media/${VIDEO_ID}?v=thumb"`);
    expect(img).toContain('alt=""');
    expect(img).toContain('data-nimg="fill"');
    expect(img).toMatch(/\bclass="[^"]*\bobject-cover\b/);
    expect(img).not.toMatch(/\bsrcset=/);
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("<svg"));
  });

  it("clips the image to the rounded slot and keeps the slot hidden from assistive tech", () => {
    const slot = tagWithClasses(html, "aspect-video");
    expect(slot).toMatch(/\bclass="[^"]*\boverflow-hidden\b/);
    expect(slot).toMatch(/\bclass="[^"]*\brelative\b/);
    expect(slot).toContain('aria-hidden="true"');
  });

  it("lifts the play badge and the duration pill above the image", () => {
    const badgeLayer = /<([a-z]+)\b[^>]*\bclass="([^"]*)"[^>]*><svg\b/.exec(html);
    expect(badgeLayer?.[2]?.split(/\s+/)).toEqual(expect.arrayContaining(["relative", "z-[1]"]));
    const pill = tagWithClasses(html, "bg-jo-red");
    expect(pill).toMatch(/\bclass="[^"]*\babsolute\b/);
    expect(pill).toMatch(/\bclass="[^"]*\bz-\[1\]/);
    expect(html).toContain("2 min");
  });
});

describe("VideoSlot without a poster (video posters T11)", () => {
  const html = renderToStaticMarkup(createElement(VideoSlot, { memory: videoMemory({ poster: null }) }));

  it("renders no image: the dashed slot, the badge and the pill as before", () => {
    expect(html).not.toContain("<img");
    expect(html).toContain("<svg");
    expect(tagWithClasses(html, "aspect-video", "border-dashed", "bg-wood-light")).toContain('aria-hidden="true"');
    expect(html).toContain("2 min");
  });
});

describe("MemoryCard for a video (video posters T11)", () => {
  it("shows the poster in the card, which keeps its own label", () => {
    const html = renderToStaticMarkup(createElement(MemoryCard, { memory: videoMemory(), index: 0 }));
    expect(html).toContain(`src="/api/public-media/${VIDEO_ID}?v=thumb"`);
    expect(html).toContain('aria-label="Open the memory from Ellen Kerrigan, Summer 1998"');
  });

  it("shows no image for a video memory still waiting for its poster", () => {
    const html = renderToStaticMarkup(createElement(MemoryCard, { memory: videoMemory({ poster: null }), index: 0 }));
    expect(html).not.toContain("<img");
  });
});
