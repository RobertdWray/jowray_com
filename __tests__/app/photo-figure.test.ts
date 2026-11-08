import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PhotoFigure } from "@/app/memories/_components/photo-figure-client";

const photos = [
  { id: "00000000-0000-4000-8000-0000000000b1", width: 1600, height: 1200, alt: "A photo from Joyce's memory", caption: "At the fair" },
  { id: "00000000-0000-4000-8000-0000000000b2", width: null, height: null, alt: "A photo from Joyce's memory", caption: null },
];

/**
 * The memory page's photos fall back like the cards do (TCR round 1, B2-1): every image sits over a placeholder tile
 * the server renders, and a failed load (an exhausted public allowance answers 429) only hides the image, through
 * FallbackImage. The hiding itself happens in the browser; this pins the server-rendered structure.
 */
describe("PhotoFigure fallback (TCR round 1, B2-1)", () => {
  const html = renderToStaticMarkup(createElement(PhotoFigure, { photos, pill: null }));

  it("renders the main photo over a placeholder, worded for both a slow load and a failed one", () => {
    expect(html).toContain('data-photo-placeholder="main"');
    expect(html).toContain("A photo from this memory");
    expect(html).toContain("/api/public-media/00000000-0000-4000-8000-0000000000b1?v=web");
  });

  it("puts a placeholder tile behind every thumbnail", () => {
    expect(html.match(/data-photo-placeholder="thumb"/g)).toHaveLength(2);
  });
});
