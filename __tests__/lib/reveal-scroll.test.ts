import { describe, expect, it } from "vitest";

import { revealScrollDelta, unionRect } from "@/lib/reveal-scroll";

describe("unionRect", () => {
  it("spans the topmost top to the bottommost bottom of the given boxes", () => {
    expect(unionRect([{ top: 100, bottom: 130 }, { top: 138, bottom: 653 }, { top: 675, bottom: 700 }])).toEqual({ top: 100, bottom: 700 });
  });
});

describe("revealScrollDelta (how far to scroll so label, field and error line are on screen together)", () => {
  it("centres a block that fits: the block's middle lands on the viewport's middle", () => {
    // Block 100..400 (300 tall) in an 844px viewport: centre 250 should move to 422, so scroll up by 172.
    expect(revealScrollDelta({ top: 100, bottom: 400 }, 844)).toBe(-172);
    expect(revealScrollDelta({ top: 900, bottom: 1200 }, 844)).toBe(628);
  });

  it("aligns the top of a block taller than the viewport, so the label and the start of the field (where the caret is) are visible", () => {
    expect(revealScrollDelta({ top: -120, bottom: 700 }, 480)).toBe(-120 - 16);
    expect(revealScrollDelta({ top: 200, bottom: 900 }, 480)).toBe(200 - 16);
  });

  it("rounds to whole pixels", () => {
    expect(Number.isInteger(revealScrollDelta({ top: 101, bottom: 400 }, 845))).toBe(true);
  });
});
