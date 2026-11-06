import { describe, expect, it } from "vitest";

import { EMAIL_ASSETS } from "@/lib/email-assets";
import { buildMemoryConfirmation, MEMORY_CONFIRMATION_SUBJECT } from "@/services/email/templates/memory-confirmation";
import type { ReceiptMediaSummary } from "@/services/email/types";

const TOKEN = "t".repeat(43);
const LINK = `https://www.jowray.com/m/${TOKEN}`;
const JPEG_1PX = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

function photo(over: Partial<ReceiptMediaSummary> = {}): ReceiptMediaSummary {
  return { kind: "PHOTO", durationSeconds: null, ...over };
}
/** An uploaded thumbnail, as the admin alert's summaries carry it: contributor content, never shown in a receipt (#46 review #6). */
function withPreview(item: ReceiptMediaSummary, id: string): ReceiptMediaSummary {
  return { ...item, preview: { contentId: `preview-${id}`, contentBase64: JPEG_1PX, width: 1000, height: 750 } } as ReceiptMediaSummary;
}
function build(over: Partial<Parameters<typeof buildMemoryConfirmation>[0]> = {}) {
  return buildMemoryConfirmation({ hasWords: true, media: [], claimLink: LINK, ...over });
}
function cids(html: string): string[] {
  return [...html.matchAll(/src="cid:([a-z0-9-]+)"/g)].map((m) => m[1]!);
}
/** A summary that still carries a filename (the admin shape, or a caller that forgot): the receipt must ignore it. */
const POISON = '"><img src=x onerror=alert(1)>https://evil.test/x.jpg';
function poisoned(over: Partial<ReceiptMediaSummary> = {}): ReceiptMediaSummary {
  return { ...photo(over), originalFilename: POISON } as ReceiptMediaSummary;
}

describe("buildMemoryConfirmation: fixed content (issue #46, D1)", () => {
  it("keeps the fixed subject", () => {
    expect(build().subject).toBe(MEMORY_CONFIRMATION_SUBJECT);
  });

  it("names the family contact address in the questions line, as text and as a mailto link (the same address as Reply-To)", () => {
    const { html, text } = build();
    expect(text).toContain("Questions, or a memory that won't fit in a box? Email robwray@gmail.com.");
    expect(html).toContain('<a href="mailto:robwray@gmail.com"');
    expect(html).toContain(">robwray@gmail.com</a>.");
  });

  it("accepts no contributor-written field at all: the input is words-or-not, media kinds and the link", () => {
    const input: Parameters<typeof buildMemoryConfirmation>[0] = { hasWords: true, media: [], claimLink: LINK };
    const keys = Object.keys(input).sort();
    expect(keys).toEqual(["claimLink", "hasWords", "media"]);
  });

  it("never renders a filename, even when a summary carries one", () => {
    const { html, text } = build({ media: [poisoned(), poisoned({ kind: "VOICE", durationSeconds: 134 })] });
    expect(html).not.toContain("evil.test");
    expect(html).not.toContain("x.jpg");
    expect(html).not.toContain("<img src=x");
    expect(text).not.toContain("evil.test");
    expect(html).toContain("Photo</span>");
    expect(html).toContain("Voice recording · 2:14");
  });

  it("never carries an uploaded image: attachments are the fixed brand marks only, even when a summary carries a preview (#6)", () => {
    const { html, attachments } = build({ media: [withPreview(photo(), "m1"), withPreview(photo({ kind: "VIDEO", durationSeconds: 9 }), "v1"), photo({ kind: "VOICE" })] });
    const brand = new Set<string>(Object.values(EMAIL_ASSETS).map((a) => a.contentId));
    for (const a of attachments) {
      expect(brand.has(a.contentId)).toBe(true);
      expect(a.contentType).toBe("image/png");
    }
    expect(attachments.some((a) => a.contentBase64 === JPEG_1PX)).toBe(false);
    expect(html).not.toContain("cid:preview-");
    expect(html).toContain("Photo</span>");
    expect(html).toContain("Video · 0:09");
    expect(cids(html).every((id) => brand.has(id))).toBe(true);
  });

  it("greets without a name and points to the private page for the words", () => {
    const { html, text } = build();
    expect(html).toContain("Thank you.");
    expect(text).toContain("Thank you. Your memory is on its way to Richard, Rob and Tracy.");
    expect(html).toContain("Your words and details are on your private page, exactly as you sent them.");
    expect(html).not.toContain("Your name");
    expect(html).not.toContain("How you knew Jo");
    expect(html).not.toContain("Your memory of Jo</div>");
  });

  it("names what was sent from counts: words, a photo, two videos, a voice recording", () => {
    expect(build().text).toContain("What you sent: your words");
    expect(build({ media: [photo()] }).text).toContain("your words and a photo");
    expect(build({ hasWords: false, media: [photo({ kind: "VIDEO" }), photo({ kind: "VIDEO" })] }).text).toContain("2 videos");
    expect(build({ hasWords: false, media: [photo({ kind: "VOICE", durationSeconds: 134 })] }).text).toContain("a voice recording");
    expect(build({ hasWords: false }).text).toContain("What you sent: your memory");
  });

  it("puts the raw token only in href attributes, the one copyable link text, and the text link line", () => {
    const { html, text } = build({ media: [photo(), photo({ kind: "VOICE" })] });
    const outsideHref = html.replaceAll(`href="${LINK}"`, "");
    expect(outsideHref.split(TOKEN).length - 1).toBe(1);
    expect(outsideHref).toContain(`>${LINK}</a>`);
    expect(text.split(TOKEN).length - 1).toBe(1);
    for (const alt of html.matchAll(/alt="([^"]*)"/g)) {
      expect(alt[1]).not.toContain(TOKEN);
    }
    const preheader = html.match(/<div[^>]*mso-hide:all[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(preheader).not.toContain(TOKEN);
    expect(text.split("\n").filter((line) => line.includes(TOKEN))).toEqual([LINK]);
  });

  it("ends the text part with the privacy line and puts the link alone on a line", () => {
    const { text } = build();
    expect(text.trimEnd().endsWith("Keep this link private: anyone who has it can edit this memory.")).toBe(true);
    expect(text).toContain(`\n${LINK}\n`);
  });

  it("has a hidden preheader and loads nothing from the network", () => {
    const { html } = build({ media: [photo(), photo({ kind: "VOICE" })] });
    expect(html).toMatch(/mso-hide:all[^>]*>Your memory of Jo is safe with the family/);
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/url\(https?:/);
    expect(html).not.toContain("@font-face");
    expect(html).not.toContain("box-shadow");
    expect(html).not.toContain("position:");
  });

  it("escapes the link in attributes", () => {
    const { html } = build({ claimLink: 'https://www.jowray.com/m/x"onmouseover="alert(1)' });
    expect(html).not.toContain('"onmouseover=');
    expect(html).toContain("&quot;onmouseover=&quot;");
  });
});

describe("buildMemoryConfirmation: media cards and attachments", () => {
  it("attaches exactly the brand marks it references, and no badges for a text-only memory", () => {
    const { html, attachments } = build();
    const referenced = new Set(cids(html));
    expect(referenced).toEqual(new Set([EMAIL_ASSETS.heart.contentId, EMAIL_ASSETS.heartStitched.contentId]));
    expect(new Set(attachments.map((a) => a.contentId))).toEqual(referenced);
    expect(html).not.toContain("cid:preview-");
  });

  it("shows badge cards for audio, photo and video, each linked to the private page", () => {
    const { html, attachments } = build({
      media: [photo({ kind: "VOICE", durationSeconds: 134 }), photo(), photo({ kind: "VIDEO" })],
    });
    expect(html).toContain("Voice recording · 2:14");
    expect(html).toContain("Photo</span>");
    expect(html).toContain("Video</span>");
    expect(html).toContain("Tap to play on your private page");
    expect(html).toContain("Tap to see it on your private page");
    const ids = attachments.map((a) => a.contentId);
    expect(ids).toContain(EMAIL_ASSETS.badgeAudio.contentId);
    expect(ids).toContain(EMAIL_ASSETS.badgePhoto.contentId);
    expect(ids).toContain(EMAIL_ASSETS.badgeVideo.contentId);
    expect(ids).not.toContain(EMAIL_ASSETS.badgePlay.contentId);
    // Anchors wrap cell content, never rows.
    expect(html).not.toMatch(/<a [^>]*>\s*<tr/);
    expect(html).not.toMatch(/<a [^>]*>\s*<td/);
  });

  it("shows the bare kind when the duration is unknown", () => {
    expect(build({ media: [photo({ kind: "VOICE" })] }).html).toContain("Voice recording</span>");
  });

  it("lists files in the text part by kind and duration only", () => {
    const { text } = build({ media: [photo({ kind: "VOICE", durationSeconds: 134 }), photo()] });
    expect(text).toContain("- Voice recording (2:14)");
    expect(text).toContain("- Photo");
    expect(text).not.toContain("- Photo:");
  });
});

describe("buildMemoryConfirmation: size", () => {
  it("stays under 100 KB of UTF-8 with the maximum of ten files (ten badge cards)", () => {
    const media = Array.from({ length: 10 }, (_, i) => photo({ kind: i % 3 === 0 ? "VOICE" : i % 3 === 1 ? "VIDEO" : "PHOTO", durationSeconds: 86400 }));
    const { html } = build({ media });
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(100 * 1024);
  });
});

describe("buildMemoryConfirmation: review round 1 (PR #20)", () => {
  it("tells photo readers to see, not play, and keeps play for audio and video", () => {
    const { html } = build({ media: [photo(), photo({ kind: "VOICE" }), photo({ kind: "VIDEO" })] });
    expect(html).toContain("Tap to see it on your private page");
    expect((html.match(/Tap to play on your private page/g) ?? []).length).toBe(2);
  });

  it("breaks stacked lines for Outlook: a <br> between title and subtitle, no unitless line-height under mso-line-height-rule:exactly", () => {
    const { html } = build({ media: [photo({ kind: "VOICE", durationSeconds: 5 })] });
    expect(html).toMatch(/Voice recording · 0:05<\/span><br>/);
    expect(html).not.toMatch(/<span style="display:block[^"]*"><\/span>/);
    for (const style of html.matchAll(/style="([^"]*mso-line-height-rule:exactly[^"]*)"/g)) {
      expect(style[1]).toMatch(/line-height:\d+px/);
    }
  });

  it("does not wrap the decorative badge in its own link", () => {
    const { html } = build({ media: [photo({ kind: "VOICE" })] });
    expect(html).not.toMatch(/<a [^>]*><img src="cid:brand-badge-audio"/);
    expect(html).toMatch(/<img src="cid:brand-badge-audio"[^>]*alt=""/);
  });
});
