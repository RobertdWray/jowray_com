import { describe, expect, it } from "vitest";

import { EMAIL_ASSETS } from "@/lib/email-assets";
import { ADMIN_TIME_ZONE, adminNewMemorySubject, buildAdminNewMemory } from "@/services/email/templates/admin-new-memory";
import type { AdminNewMemoryContent, MemoryMediaSummary } from "@/services/email/types";

const TOKEN = "t".repeat(43);
const JPEG_1PX = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
/** 2026-11-03 19:38 UTC = 2:38 PM EST (standard time; DST ended 2026-11-01). */
const SUBMITTED = new Date("2026-11-03T19:38:00Z");

function photo(over: Partial<MemoryMediaSummary> = {}): MemoryMediaSummary {
  return { kind: "PHOTO", originalFilename: "IMG_0001.jpg", durationSeconds: null, preview: null, ...over };
}
function preview(id: string, width = 1000, height = 750): MemoryMediaSummary["preview"] {
  return { contentId: `preview-${id}`, contentBase64: JPEG_1PX, width, height };
}
function build(over: Partial<AdminNewMemoryContent> = {}) {
  return buildAdminNewMemory({
    memoryId: "8f1c2d3e-0000-4000-8000-000000000001",
    submittedAt: SUBMITTED,
    name: "Kay Bartholomew",
    relationship: "former student",
    email: "kay@example.com",
    contactOptIn: true,
    mailingListOptIn: false,
    notifyWhenPosted: true,
    approxDateText: "Summer 1985",
    place: "her classroom",
    note: "She once taught me to quilt.",
    visibility: "FAMILY",
    media: [],
    filesNotReady: 0,
    ...over,
  });
}
function cids(html: string): string[] {
  return [...html.matchAll(/src="cid:([a-z0-9-]+)"/g)].map((m) => m[1]!);
}

describe("adminNewMemorySubject", () => {
  it("names the contributor, stripped of control characters and capped at 60", () => {
    expect(adminNewMemorySubject("Kay Bartholomew")).toBe("New memory from Kay Bartholomew");
    expect(adminNewMemorySubject(null)).toBe("New memory");
    expect(adminNewMemorySubject("  ")).toBe("New memory");
    expect(adminNewMemorySubject("Kay\r\nBcc: x")).toBe("New memory from Kay Bcc: x");
    expect(adminNewMemorySubject("x".repeat(200)).length).toBe("New memory from ".length + 60);
  });
});

describe("buildAdminNewMemory: who, date, memory, media, details", () => {
  it("renders the contributor, their email and the three flags", () => {
    const { html, text } = build();
    expect(html).toContain("Kay Bartholomew");
    expect(html).toContain("former student");
    expect(html).toContain("kay@example.com");
    expect(html).toMatch(/Can be contacted<\/div>\s*<div[^>]*>Yes/);
    expect(html).toMatch(/Wants to hear when it&#39;s posted<\/div>\s*<div[^>]*>Yes/);
    expect(html).toMatch(/Mailing list<\/div>\s*<div[^>]*>No/);
    expect(text).toContain("Email: kay@example.com");
    expect(text).toContain("Can be contacted: Yes");
    expect(text).toContain("Mailing list: No");
  });

  it("says 'Not given' for missing who-fields", () => {
    const { html, text } = build({ name: null, relationship: "", email: undefined });
    expect(html).toMatch(/Name<\/div>\s*<div[^>]*>Not given/);
    expect(html).toMatch(/Email<\/div>\s*<div[^>]*>Not given/);
    expect(text).toContain("Name: Not given");
  });

  it("formats the submitted time in the family's zone with a zone abbreviation", () => {
    expect(ADMIN_TIME_ZONE).toBe("America/New_York");
    const winter = build();
    expect(winter.html).toContain("Tue, Nov 3, 2026, 2:38 PM EST");
    expect(winter.text).toContain("Submitted: Tue, Nov 3, 2026, 2:38 PM EST");
    const summer = build({ submittedAt: new Date("2026-07-04T16:05:00Z") });
    expect(summer.html).toContain("Sat, Jul 4, 2026, 12:05 PM EDT");
  });

  it("shows the memory's own date and place, and the note with its paragraphs", () => {
    const { html, text } = build({ note: "First.\r\n\r\n\r\nSecond   line\twith\u0007control." });
    expect(html).toContain("Summer 1985");
    expect(html).toContain("her classroom");
    expect(html).toContain("First.<br><br>Second   line with control.");
    expect(text).toContain("First.\n\nSecond   line with control.");
    expect(html).not.toContain("\u0007");
  });

  it("says so when there is no written note", () => {
    const { html, text } = build({ note: null });
    expect(html).toContain("No written note.");
    expect(text).toContain("No written note.");
  });

  it("labels visibility in words and shows the memory id", () => {
    expect(build({ visibility: "PUBLIC" }).html).toContain("Everyone who visits the memorial");
    expect(build({ visibility: "FAMILY" }).html).toContain("Family only");
    expect(build({ visibility: "PRIVATE" }).html).toContain("Private");
    const { html, text } = build();
    expect(html).toContain("8f1c2d3e-0000-4000-8000-000000000001");
    expect(text).toContain("Memory id: 8f1c2d3e-0000-4000-8000-000000000001");
  });

  it("escapes every field in the HTML body and in alt text", () => {
    const { html } = build({
      name: '<a href="https://evil.test">Jo</a>',
      relationship: "<b>x</b>",
      email: '"><script>',
      place: "a & b",
      note: "<script>alert(1)</script>",
      media: [photo({ originalFilename: '"><img src=x onerror=alert(1)>.jpg' })],
    });
    expect(html).not.toContain('href="https://evil.test"');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("a &amp; b");
    expect(html).not.toContain("<img src=x");
    for (const alt of html.matchAll(/alt="([^"]*)"/g)) {
      expect(alt[1]).not.toContain("<");
    }
  });
});

describe("buildAdminNewMemory: no links, by ruling", () => {
  it("has no anchor, no network image, no mailto and no claim path, while contributor text with URLs survives verbatim", () => {
    const note = `See https://example.com/m/${TOKEN} and http://also.test/path`;
    const { html, text } = build({
      note,
      email: "kay@example.com",
      media: [photo({ preview: preview("m1") }), photo({ originalFilename: "http.jpg" }), photo({ kind: "VOICE", originalFilename: "voice.m4a", durationSeconds: 134 })],
    });
    expect(html).not.toMatch(/<a[\s>]/);
    expect(html).not.toContain("href=");
    expect(html).not.toMatch(/src="https?:/);
    expect(html).not.toMatch(/url\(https?:/);
    expect(html).not.toContain("mailto:");
    expect(html).toContain("See https://example.com/m/");
    expect(html).toContain("http.jpg");
    expect(text).toContain(note);
    // "/m/" shows up only where the contributor typed it (note and its preheader excerpt); nothing else emits a claim path.
    expect(build().html).not.toContain("/m/");
    expect(build().text).not.toContain("/m/");
    expect(html).not.toContain("Tap to");
    expect(text).not.toContain("Tap to");
  });

  it("keeps the shell's static document identifiers (doctype, namespaces) and nothing else from the network", () => {
    const { html } = build();
    expect(html).toContain("http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd");
    expect(html).not.toContain("@font-face");
    expect(html).not.toContain("box-shadow");
    expect(html).not.toContain("position:");
  });
});

describe("buildAdminNewMemory: media cards and attachments", () => {
  it("attaches exactly the brand marks it references for a text-only memory and says 'No files.'", () => {
    const { html, text, attachments } = build();
    const referenced = new Set(cids(html));
    expect(referenced).toEqual(new Set([EMAIL_ASSETS.heart.contentId, EMAIL_ASSETS.heartStitched.contentId]));
    expect(new Set(attachments.map((a) => a.contentId))).toEqual(referenced);
    expect(html).toContain("No files.");
    expect(text).toContain("No files.");
  });

  it("shows previews inline (unlinked) and badge cards for the rest, with the file count", () => {
    const { html, text, attachments } = build({
      media: [
        photo({ preview: preview("m1", 1000, 750) }),
        photo({ kind: "VOICE", originalFilename: "voice.m4a", durationSeconds: 134 }),
        photo({ kind: "VIDEO", originalFilename: "clip.mov" }),
      ],
    });
    expect(html).toMatch(/<td align="center">\s*<img src="cid:preview-m1" width="520"[^>]*alt="Your photo"/);
    expect(html).toContain("Voice recording · 2:14");
    expect(html).toContain("Video · clip.mov");
    expect(html).toContain("3 files");
    expect(text).toContain("3 files");
    expect(text).toContain("- Voice recording (2:14): voice.m4a");
    const ids = attachments.map((a) => a.contentId);
    expect(ids).toContain("preview-m1");
    expect(ids).toContain(EMAIL_ASSETS.badgeAudio.contentId);
    expect(ids).toContain(EMAIL_ASSETS.badgeVideo.contentId);
    expect(ids).not.toContain(EMAIL_ASSETS.badgePhoto.contentId);
    expect(new Set(cids(html))).toEqual(new Set(ids));
  });

  it("uses at most four previews; further files fall back to badge cards", () => {
    const media = Array.from({ length: 6 }, (_, i) => photo({ originalFilename: `p${i}.jpg`, preview: preview(`m${i}`) }));
    const { html, attachments } = build({ media });
    expect(cids(html).filter((id) => id.startsWith("preview-"))).toHaveLength(4);
    expect(attachments.filter((a) => a.contentId.startsWith("preview-"))).toHaveLength(4);
    expect(html).toContain("Photo · p4.jpg");
  });

  it("tells the admins when files are still uploading or did not arrive", () => {
    expect(build({ filesNotReady: 1 }).html).toContain("1 file is still uploading or did not arrive.");
    const two = build({ media: [photo()], filesNotReady: 2 });
    expect(two.html).toContain("2 files are still uploading or did not arrive.");
    expect(two.text).toContain("2 files are still uploading or did not arrive.");
    expect(build().html).not.toContain("still uploading");
  });

  it("attachment filenames satisfy the transport's header-safe contract", () => {
    const { attachments } = build({ media: [photo({ preview: preview("m1") }), photo({ kind: "VOICE" })] });
    for (const a of attachments) {
      expect(a.filename).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(a.contentId).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe("buildAdminNewMemory: size", () => {
  it("stays under 100 KB of UTF-8 with the longest note, longest details and ten files", () => {
    const chunk = "Spelling <doesn't> count & “never” did — 😊 ligne\n";
    const note = chunk.repeat(Math.ceil(10_000 / chunk.length)).slice(0, 10_000);
    const media = Array.from({ length: 10 }, (_, i) =>
      i < 4 ? photo({ originalFilename: "a".repeat(255), preview: preview(`m${i}`) }) : photo({ kind: i % 2 ? "VOICE" : "VIDEO", originalFilename: "b".repeat(255), durationSeconds: 86400 })
    );
    const { html } = build({
      name: "N".repeat(60),
      relationship: "R".repeat(120),
      email: `${"e".repeat(64)}@example.com`,
      approxDateText: "D".repeat(120),
      place: "P".repeat(200),
      note,
      media,
      filesNotReady: 3,
    });
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(100 * 1024);
  });
});
