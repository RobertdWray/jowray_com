import { describe, expect, it } from "vitest";

import { EMAIL_ASSETS } from "@/lib/email-assets";
import { buildMemoryConfirmation, MEMORY_CONFIRMATION_SUBJECT } from "@/services/email/templates/memory-confirmation";
import type { MemoryMediaSummary } from "@/services/email/types";

const TOKEN = "t".repeat(43);
const LINK = `https://www.jowray.com/m/${TOKEN}`;
const JPEG_1PX = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

function photo(over: Partial<MemoryMediaSummary> = {}): MemoryMediaSummary {
  return { kind: "PHOTO", originalFilename: "IMG_0001.jpg", durationSeconds: null, preview: null, ...over };
}
function preview(id: string, width = 1000, height = 750): MemoryMediaSummary["preview"] {
  return { contentId: `preview-${id}`, contentBase64: JPEG_1PX, width, height };
}
function build(over: Partial<Parameters<typeof buildMemoryConfirmation>[0]> = {}) {
  return buildMemoryConfirmation({ name: "Kay", relationship: "former student", approxDateText: "Summer 1985", place: "her classroom", note: "She once taught me to quilt.", media: [], claimLink: LINK, ...over });
}
function cids(html: string): string[] {
  return [...html.matchAll(/src="cid:([a-z0-9-]+)"/g)].map((m) => m[1]!);
}

describe("buildMemoryConfirmation: content", () => {
  it("keeps the fixed subject with no user text in it", () => {
    const { subject } = build({ name: "Mallory <script>" });
    expect(subject).toBe(MEMORY_CONFIRMATION_SUBJECT);
    expect(subject).not.toContain("Mallory");
  });

  it("escapes every field in the HTML body and in alt text", () => {
    const { html } = build({
      name: '<a href="https://evil.test">Jo</a>',
      relationship: "<b>x</b>",
      place: "a & b",
      note: "<script>alert(1)</script>",
      media: [photo({ originalFilename: '"><img src=x onerror=alert(1)>.jpg' })],
    });
    expect(html).not.toContain('href="https://evil.test"');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("a &amp; b");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;.jpg");
  });

  it("keeps the note's paragraphs: <br> in HTML, real newlines in text, no space collapsing", () => {
    const note = "First line.\r\n\r\n\r\n\r\nSecond   line\twith\u0007control.\nThird.";
    const { html, text } = build({ note });
    expect(text).toContain("First line.\n\nSecond   line with control.\nThird.");
    expect(html).toContain("First line.<br>");
    expect(html).toContain("Second   line with control.<br>");
    expect(html).not.toContain("\r");
    expect(html).not.toContain("\u0007");
  });

  it("names what was sent: words, a photo, two videos, a voice recording", () => {
    expect(build().text).toContain("your words");
    expect(build({ media: [photo()] }).text).toContain("your words and a photo");
    expect(build({ note: null, media: [photo({ kind: "VIDEO" }), photo({ kind: "VIDEO" })] }).text).toContain("2 videos");
    expect(build({ note: "", media: [photo({ kind: "VOICE", durationSeconds: 134 })] }).text).toContain("a voice recording");
  });

  it("greets by name when there is one and caps the name at 60 characters", () => {
    expect(build().html).toContain("Thank you, Kay.");
    expect(build({ name: null }).html).toContain("Thank you.");
    expect(build({ name: "x".repeat(200) }).html).not.toContain("x".repeat(61));
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
    const { html, attachments } = build({ media: [photo({ kind: "VIDEO", originalFilename: "clip.mov", preview: preview("v1") })] });
    expect(html).toMatch(/<img src="cid:preview-v1"[^>]*alt="Your video"/);
    expect(cids(html)).not.toContain(EMAIL_ASSETS.badgePlay.contentId);
    expect(attachments.map((a) => a.contentId)).not.toContain(EMAIL_ASSETS.badgePlay.contentId);
  });

  it("shows badge cards for audio, for a photo without a preview, and for a video without a poster", () => {
    const { html, attachments } = build({
      media: [
        photo({ kind: "VOICE", originalFilename: "voice.m4a", durationSeconds: 134 }),
        photo({ originalFilename: "IMG_0002.heic" }),
        photo({ kind: "VIDEO", originalFilename: "clip.mov" }),
      ],
    });
    expect(html).toContain("Voice recording · 2:14");
    expect(html).toContain("Photo · IMG_0002.heic");
    expect(html).toContain("Video · clip.mov");
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

  it("falls back to the filename when the duration is unknown, and to the bare title when both are missing", () => {
    expect(build({ media: [photo({ kind: "VOICE", originalFilename: "voice.m4a" })] }).html).toContain("Voice recording · voice.m4a");
    expect(build({ media: [photo({ kind: "VOICE", originalFilename: null })] }).html).toContain("Voice recording</span>");
  });

  it("uses at most four previews; further files fall back to badge cards", () => {
    const media = Array.from({ length: 6 }, (_, i) => photo({ originalFilename: `p${i}.jpg`, preview: preview(`m${i}`) }));
    const { html, attachments } = build({ media });
    expect(cids(html).filter((id) => id.startsWith("preview-"))).toHaveLength(4);
    expect(attachments.filter((a) => a.contentId.startsWith("preview-"))).toHaveLength(4);
    expect(html).toContain("Photo · p4.jpg");
    expect(html).toContain("Photo · p5.jpg");
  });

  it("refuses a preview content id that is not cid-safe", () => {
    expect(() => build({ media: [photo({ preview: { contentId: "bad id<", contentBase64: JPEG_1PX, width: 10, height: 10 } })] })).toThrow(/content id/i);
  });

  it("lists files in the text part with their duration", () => {
    const { text } = build({ media: [photo({ kind: "VOICE", originalFilename: "voice.m4a", durationSeconds: 134 }), photo({ originalFilename: "IMG_0001.jpg" })] });
    expect(text).toContain("- Voice recording (2:14): voice.m4a");
    expect(text).toContain("- Photo: IMG_0001.jpg");
  });
});

describe("buildMemoryConfirmation: size", () => {
  it("stays under 100 KB of UTF-8 with the longest note, longest details and four media cards", () => {
    const chunk = "Spelling <doesn't> count & “never” did — 😊 ligne\n";
    const note = chunk.repeat(Math.ceil(10_000 / chunk.length)).slice(0, 10_000);
    const { html } = build({
      name: "N".repeat(60),
      relationship: "R".repeat(120),
      approxDateText: "D".repeat(120),
      place: "P".repeat(200),
      note,
      media: [
        photo({ originalFilename: "a".repeat(255), preview: preview("m1") }),
        photo({ kind: "VIDEO", originalFilename: "b".repeat(255), preview: preview("m2") }),
        photo({ kind: "VOICE", originalFilename: "c".repeat(255), durationSeconds: 86400 }),
        photo({ originalFilename: "d".repeat(255) }),
      ],
    });
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(100 * 1024);
  });
});

describe("buildMemoryConfirmation: review round 1 (PR #20)", () => {
  it("caps the note at 10,000 characters in both parts", () => {
    const { html, text } = build({ note: "n".repeat(12_000) });
    expect(text).not.toContain("n".repeat(10_001));
    expect(html).not.toContain("n".repeat(10_001));
    expect(text).toContain("n".repeat(10_000));
  });

  it("tells photo readers to see, not play, and keeps play for audio and video", () => {
    const { html } = build({ media: [photo(), photo({ kind: "VOICE" }), photo({ kind: "VIDEO" })] });
    expect(html).toContain("Tap to see it on your private page");
    expect((html.match(/Tap to play on your private page/g) ?? []).length).toBe(2);
  });

  it("breaks stacked lines for Outlook: a <br> between title and subtitle, no unitless line-height under mso-line-height-rule:exactly", () => {
    const { html } = build({ media: [photo({ kind: "VOICE", originalFilename: "voice.m4a", durationSeconds: 5 })] });
    expect(html).toMatch(/Voice recording · 0:05<\/span><br>/);
    expect(html).not.toMatch(/<span style="display:block[^"]*"><\/span>/);
    for (const style of html.matchAll(/style="([^"]*mso-line-height-rule:exactly[^"]*)"/g)) {
      expect(style[1]).toMatch(/line-height:\d+px/);
    }
    // Detail rows stack with block elements Outlook honours.
    expect(html).toMatch(/<div[^>]*>Your name<\/div>\s*<div[^>]*>Kay<\/div>/);
  });

  it("lets long filenames and details wrap instead of widening the email", () => {
    const { html } = build({ media: [photo({ originalFilename: "x".repeat(255) })], place: "y".repeat(200) });
    const titleCell = html.match(/<td[^>]*>\s*<a[^>]*><span[^>]*>Photo · x+/)?.[0] ?? "";
    expect(titleCell).toMatch(/word-break:break-word/);
    expect(html).toMatch(new RegExp(`<div[^>]*word-break:break-word[^>]*>${"y".repeat(200)}</div>`));
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
        photo({ originalFilename: "nan.jpg", preview: { contentId: "preview-a", contentBase64: JPEG_1PX, width: Number.NaN, height: 10 } }),
        photo({ originalFilename: "zero.jpg", preview: { contentId: "preview-b", contentBase64: JPEG_1PX, width: 0, height: 10 } }),
        photo({ originalFilename: "big.jpg", preview: { contentId: "preview-c", contentBase64: big, width: 100, height: 100 } }),
      ],
    });
    expect(attachments.filter((a) => a.contentId.startsWith("preview-"))).toHaveLength(0);
    expect(html).toContain("Photo · nan.jpg");
    expect(html).toContain("Photo · big.jpg");
  });

  it("stays under 100 KB with the maximum of ten files (four previews, six badge cards) and the longest note", () => {
    const chunk = "Spelling <doesn't> count & “never” did — 😊 ligne\n";
    const note = chunk.repeat(Math.ceil(10_000 / chunk.length)).slice(0, 10_000);
    const media = Array.from({ length: 10 }, (_, i) => photo({ kind: i % 3 === 0 ? "VOICE" : i % 3 === 1 ? "VIDEO" : "PHOTO", originalFilename: `${"f".repeat(250)}${i}.bin`, durationSeconds: 86400, preview: i < 6 && i % 3 !== 0 ? preview(`m${i}`) : null }));
    const { html } = build({ name: "N".repeat(60), relationship: "R".repeat(120), approxDateText: "D".repeat(120), place: "P".repeat(200), note, media });
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(100 * 1024);
  });
});
