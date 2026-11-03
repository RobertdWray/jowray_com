import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { EMAIL_ASSETS, PLAY_BADGE_COMPOSITE } from "@/lib/email-assets";

describe("email brand assets", () => {
  it("ships every asset as a transparent PNG with the declared dimensions and a cid-safe id", async () => {
    const ids = new Set<string>();
    for (const asset of Object.values(EMAIL_ASSETS)) {
      expect(asset.contentType).toBe("image/png");
      expect(asset.contentId).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(asset.contentId)).toBe(false);
      ids.add(asset.contentId);
      const meta = await sharp(Buffer.from(asset.contentBase64, "base64")).metadata();
      expect(meta.format).toBe("png");
      expect(meta.hasAlpha).toBe(true);
      expect({ width: meta.width, height: meta.height }).toEqual({ width: asset.width, height: asset.height });
    }
  });

  it("renders the marks at 2x so a 44px heart and 56px badges stay crisp on retina screens", () => {
    expect(EMAIL_ASSETS.heart.width).toBe(88);
    expect(EMAIL_ASSETS.heartStitched.width).toBe(80);
    expect(EMAIL_ASSETS.badgePlay.width).toBe(112);
    expect(EMAIL_ASSETS.badgeAudio.width).toBe(112);
    expect(EMAIL_ASSETS.badgeVideo.width).toBe(112);
    expect(EMAIL_ASSETS.badgePhoto.width).toBe(112);
  });

  it("keeps a larger play badge for compositing onto video posters", async () => {
    const meta = await sharp(Buffer.from(PLAY_BADGE_COMPOSITE.contentBase64, "base64")).metadata();
    expect(meta.width).toBe(160);
    expect(meta.hasAlpha).toBe(true);
  });

  it("stays small enough to attach to every email", () => {
    const total = Object.values(EMAIL_ASSETS).reduce((sum, a) => sum + Buffer.from(a.contentBase64, "base64").length, 0);
    expect(total).toBeLessThan(40 * 1024);
  });
});

describe("composite play badge id", () => {
  it("is cid-safe and distinct from the attached marks", () => {
    expect(PLAY_BADGE_COMPOSITE.contentId).toMatch(/^[a-z0-9-]+$/);
    expect(Object.values(EMAIL_ASSETS).map((a) => a.contentId)).not.toContain(PLAY_BADGE_COMPOSITE.contentId);
  });
});
