import { describe, expect, it } from "vitest";

import { EMAIL_ASSETS } from "@/lib/email-assets";
import { buildMemoryConfirmation, MEMORY_CONFIRMATION_SUBJECT } from "@/services/email/templates/memory-confirmation";
import type { ReceiptMediaSummary } from "@/services/email/types";

const TOKEN = "t".repeat(43);
const LINK = `https://www.jowray.com/m/${TOKEN}`;
const JPEG_1PX = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

function photo(over: Partial<ReceiptMediaSummary> = {}): ReceiptMediaSummary {
  return { kind: "PHOTO", durationSeconds: null, preview: null, ...over };
}
function preview(id: string, width = 1000, height = 750): ReceiptMediaSummary["preview"] {
  return { contentId: `preview-${id}`, contentBase64: JPEG_1PX, width, height };
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
    const { html, text } = build({ media: [photo({ preview: preview("m1") }), photo({ kind: "VOICE" })] });
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
    const { html } = build({ media: [photo({ preview: preview("m1") }), photo({ kind: "VOICE" })] });
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

  it("shows a photo preview as an inline image linked to the private page, with a width capped at 520", () => {
    const { html, attachments } = build({ media: [photo({ preview: preview("m1", 1000, 750) })] });
    expect(html).toMatch(/<a href="[^"]+"[^>]*><img src="cid:preview-m1" width="520"[^>]*alt="Your photo"/);
    expect(html).toContain("max-width:520px");
    expect(attachments.find((a) => a.contentId === "preview-m1")).toMatchObject({ contentType: "image/jpeg", contentBase64: JPEG_1PX, filename: "photo-1.jpg" });
    expect(html).not.toContain(EMAIL_ASSETS.badgePhoto.contentId);
  });

  it("keeps a portrait preview at its own width and omits a height attribute", () => {
    const { html } = build({ media: [photo({ preview: preview("m1", 300, 400) })] });
    expect(html).toMatch(/<img src="cid:preview-m1" width="300"/);
    expect(html).not.toMatch(/<img src="cid:preview-m1"[^>]*height="/);
  });

  it("renders a video poster as the image alone (the play badge is already composited)", () => {
    const { html, attachments } = build({ media: [photo({ kind: "VIDEO", preview: preview("v1") })] });
    expect(html).toMatch(/<img src="cid:preview-v1"[^>]*alt="Your video"/);
    expect(cids(html)).not.toContain(EMAIL_ASSETS.badgePlay.contentId);
    expect(attachments.map((a) => a.contentId)).not.toContain(EMAIL_ASSETS.badgePlay.contentId);
  });

  it("shows badge cards for audio, for a photo without a preview, and for a video without a poster", () => {
    const { html, attachments } = build({
      media: [photo({ kind: "VOICE", durationSeconds: 134 }), photo(), photo({ kind: "VIDEO" })],
    });
    expect(html).toContain("Voice recording · 2:14");
    expect(html).toContain("Photo</span>");
    expect(html).toContain("Video</span>");
    expect(html).toContain("Tap to play on your private page");
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

  it("uses at most four previews; further files fall back to badge cards", () => {
    const media = Array.from({ length: 6 }, (_, i) => photo({ preview: preview(`m${i}`) }));
    const { html, attachments } = build({ media });
    expect(cids(html).filter((id) => id.startsWith("preview-"))).toHaveLength(4);
    expect(attachments.filter((a) => a.contentId.startsWith("preview-"))).toHaveLength(4);
    expect(html.split("Photo</span>").length - 1).toBe(2);
  });

  it("refuses a preview content id that is not cid-safe", () => {
    expect(() => build({ media: [photo({ preview: { contentId: "bad id<", contentBase64: JPEG_1PX, width: 10, height: 10 } })] })).toThrow(/content id/i);
  });

  it("lists files in the text part by kind and duration only", () => {
    const { text } = build({ media: [photo({ kind: "VOICE", durationSeconds: 134 }), photo()] });
    expect(text).toContain("- Voice recording (2:14)");
    expect(text).toContain("- Photo");
    expect(text).not.toContain("- Photo:");
  });
});

describe("buildMemoryConfirmation: size", () => {
  it("stays under 100 KB of UTF-8 with the maximum of ten files (four previews, six badge cards)", () => {
    const media = Array.from({ length: 10 }, (_, i) => photo({ kind: i % 3 === 0 ? "VOICE" : i % 3 === 1 ? "VIDEO" : "PHOTO", durationSeconds: 86400, preview: i < 6 && i % 3 !== 0 ? preview(`m${i}`) : null }));
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

  it("rejects duplicate preview content ids and ids reserved for brand marks", () => {
    expect(() => build({ media: [photo({ preview: preview("same") }), photo({ preview: preview("same") })] })).toThrow(/duplicate/i);
    expect(() => build({ media: [photo({ preview: { contentId: EMAIL_ASSETS.heart.contentId, contentBase64: JPEG_1PX, width: 10, height: 10 } })] })).toThrow(/reserved/i);
  });

  it("does not wrap the decorative badge in its own link", () => {
    const { html } = build({ media: [photo({ kind: "VOICE" })] });
    expect(html).not.toMatch(/<a [^>]*><img src="cid:brand-badge-audio"/);
    expect(html).toMatch(/<img src="cid:brand-badge-audio"[^>]*alt=""/);
  });

  it("falls back to a badge card when a preview has bad dimensions or is too large", () => {
    const big = Buffer.alloc(351 * 1024, 1).toString("base64");
    const { html, attachments } = build({
      media: [
        photo({ preview: { contentId: "preview-a", contentBase64: JPEG_1PX, width: Number.NaN, height: 10 } }),
        photo({ preview: { contentId: "preview-b", contentBase64: JPEG_1PX, width: 0, height: 10 } }),
        photo({ preview: { contentId: "preview-c", contentBase64: big, width: 100, height: 100 } }),
      ],
    });
    expect(attachments.filter((a) => a.contentId.startsWith("preview-"))).toHaveLength(0);
    expect(html.split("Photo</span>").length - 1).toBe(3);
  });
});
