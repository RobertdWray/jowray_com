import { describe, expect, it } from "vitest";

import { EMAIL_ASSETS } from "@/lib/email-assets";
import { buildMemoryConfirmation, MEMORY_CONFIRMATION_SUBJECT } from "@/services/email/templates/memory-confirmation";
import { buildSubmissionConfirmation, SUBMISSION_HTML_BUDGET_BYTES, submissionConfirmationSubject } from "@/services/email/templates/submission-confirmation";
import type { MemoryMediaSummary, SubmissionMemoryContent } from "@/services/email/types";

const JPEG_1PX = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const token = (n: number) => String.fromCharCode(97 + n).repeat(43);
const link = (n: number) => `https://www.jowray.com/m/${token(n)}`;

function photo(over: Partial<MemoryMediaSummary> = {}): MemoryMediaSummary {
  return { kind: "PHOTO", originalFilename: "IMG_0001.jpg", durationSeconds: null, preview: null, ...over };
}
function preview(id: string): MemoryMediaSummary["preview"] {
  return { contentId: `preview-${id}`, contentBase64: JPEG_1PX, width: 1000, height: 750 };
}
function memory(n: number, over: Partial<SubmissionMemoryContent> = {}): SubmissionMemoryContent {
  return { position: n + 1, approxDateText: `Summer 198${n}`, place: n === 0 ? "her classroom" : null, note: `Memory number ${n + 1}.`, media: [], claimLink: link(n), missingFiles: [], ...over };
}
function build(memories: SubmissionMemoryContent[], over: { name?: string | null; relationship?: string | null } = {}) {
  return buildSubmissionConfirmation({ name: "Kay", relationship: "former student", memories, ...over });
}

describe("buildSubmissionConfirmation: one memory", () => {
  it("renders byte-for-byte as the single-memory confirmation", () => {
    const single = buildMemoryConfirmation({ name: "Kay", relationship: "former student", approxDateText: "Summer 1980", place: "her classroom", note: "Memory number 1.", media: [photo({ preview: preview("m1") }), photo({ kind: "VOICE", durationSeconds: 30 })], claimLink: link(0) });
    const batch = build([memory(0, { media: [photo({ preview: preview("m1") }), photo({ kind: "VOICE", durationSeconds: 30 })] })]);
    expect(batch).toEqual(single);
    expect(batch.subject).toBe(MEMORY_CONFIRMATION_SUBJECT);
  });
});

describe("buildSubmissionConfirmation: one memory with a missing file", () => {
  it("reads in the singular everywhere and names the file", () => {
    const { subject, text, html } = build([memory(0, { missingFiles: ["IMG_2231.MOV"] })]);
    expect(subject).toBe(MEMORY_CONFIRMATION_SUBJECT);
    expect(text).toContain("Your memory is on its way to Richard, Rob and Tracy.");
    expect(text).not.toMatch(/1 memories/);
    expect(text).toContain("Your private link (keep it private: anyone who has it can edit this memory):");
    expect(text.trimEnd().endsWith("Keep this link private: anyone who has it can edit this memory.")).toBe(true);
    expect(html).toContain("Your private link");
    expect(html).not.toContain("Your private links");
    expect(html).toContain("IMG_2231.MOV");
  });
});

describe("buildSubmissionConfirmation: several memories", () => {
  it("has a plural subject, puts every link first, and names each memory", () => {
    const { subject, html, text } = build([memory(0), memory(1), memory(2)]);
    expect(subject).toBe(submissionConfirmationSubject(3));
    expect(subject).toBe("Thank you for sharing 3 memories");
    expect(subject).not.toContain("Kay");
    // Links come before any words, in both parts.
    const firstLinkText = text.indexOf(link(0));
    expect(firstLinkText).toBeGreaterThan(-1);
    expect(firstLinkText).toBeLessThan(text.indexOf("Memory number 1."));
    expect(text.indexOf(link(2))).toBeLessThan(text.indexOf("Memory number 1."));
    expect(html.indexOf(`href="${link(0)}"`)).toBeLessThan(html.indexOf("Memory number 1."));
    expect(html.indexOf(`href="${link(2)}"`)).toBeLessThan(html.indexOf("Memory number 1."));
    // Each memory has a stable heading and a label built from its details.
    expect(html).toContain("Memory 1");
    expect(html).toContain("Memory 3");
    expect(text).toContain("Memory 1 · Summer 1980 · her classroom");
    expect(text).toContain("Memory 2 · Summer 1981");
    // No red button: text links only.
    expect(html).not.toContain("v:roundrect");
    expect(text).toContain("Your 3 memories are on their way");
  });

  it("puts each token only in its own memory's links, never in alt text or the preheader", () => {
    const { html, text } = build([memory(0, { media: [photo({ preview: preview("m1") })] }), memory(1, { media: [photo({ kind: "VOICE" })] })]);
    for (const n of [0, 1]) {
      const outsideHref = html.replaceAll(`href="${link(n)}"`, "");
      // The one copyable link text per memory.
      expect(outsideHref.split(token(n)).length - 1).toBe(1);
      expect(outsideHref).toContain(`>${link(n)}</a>`);
      // Text part: the links card line plus the memory's own line.
      expect(text.split("\n").filter((line) => line.includes(token(n)))).toHaveLength(2);
    }
    for (const alt of html.matchAll(/alt="([^"]*)"/g)) {
      expect(alt[1]).not.toContain(token(0));
      expect(alt[1]).not.toContain(token(1));
    }
    const preheader = html.match(/<div[^>]*mso-hide:all[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(preheader).not.toContain(token(0));
    // A memory's media card links to that memory, not to another.
    // The memory cards follow the links card, so the last headings are the cards' own.
    const cardOne = html.slice(html.lastIndexOf(">Memory 1 ·"), html.lastIndexOf(">Memory 2 ·"));
    expect(cardOne).toContain(`href="${link(0)}"`);
    expect(cardOne).not.toContain(token(1));
  });

  it("uses at most four previews per send, with unique content ids, and attaches the brand marks once", () => {
    const memories = Array.from({ length: 3 }, (_, n) => memory(n, { media: [photo({ preview: preview(`m${n}a`) }), photo({ preview: preview(`m${n}b`) })] }));
    const { html, attachments } = build(memories);
    const previews = attachments.filter((a) => a.contentId.startsWith("preview-"));
    expect(previews.map((a) => a.contentId)).toEqual(["preview-m0a", "preview-m0b", "preview-m1a", "preview-m1b"]);
    expect([...html.matchAll(/src="cid:preview-([a-z0-9-]+)"/g)]).toHaveLength(4);
    // The other two photos fall back to badge cards.
    expect(html.split(`cid:${EMAIL_ASSETS.badgePhoto.contentId}`).length - 1).toBeGreaterThanOrEqual(2);
    expect(attachments.filter((a) => a.contentId === EMAIL_ASSETS.heart.contentId)).toHaveLength(1);
    expect(attachments.filter((a) => a.contentId === EMAIL_ASSETS.badgePhoto.contentId)).toHaveLength(1);
    expect(new Set(attachments.map((a) => a.contentId)).size).toBe(attachments.length);
    expect(() => build([memory(0, { media: [photo({ preview: preview("dup") })] }), memory(1, { media: [photo({ preview: preview("dup") })] })])).toThrow(/duplicate/);
  });

  it("keeps ten memories with maximum-length notes under the Gmail budget by shortening the words, and never shortens when it fits", () => {
    const chunk = "Spelling <doesn't> count & “never” did — 😊 ligne\n";
    const note = chunk.repeat(Math.ceil(10_000 / chunk.length)).slice(0, 10_000);
    const big = build(Array.from({ length: 10 }, (_, n) => memory(n, { note, approxDateText: "D".repeat(120), place: "P".repeat(200), media: [photo({ originalFilename: "f".repeat(255) }), photo({ kind: "VOICE", durationSeconds: 86400 })] })), { name: "N".repeat(60), relationship: "R".repeat(120) });
    expect(Buffer.byteLength(big.html, "utf8")).toBeLessThan(SUBMISSION_HTML_BUDGET_BYTES);
    expect(SUBMISSION_HTML_BUDGET_BYTES).toBeLessThanOrEqual(100 * 1024);
    expect(big.html).toContain("read it all from its link");
    expect(big.text).toContain("read it all from its link");
    // Links still come first even when the words were shortened.
    expect(big.text.indexOf(link(9))).toBeLessThan(big.text.indexOf("Spelling"));
    const small = build([memory(0, { note }), memory(1)]);
    expect(small.html).not.toContain("read it all from its link");
    expect(small.html).toContain("Spelling &lt;doesn&#39;t&gt; count");
  });

  it("never cuts an emoji in half when shortening the words", () => {
    // Every note ends in emoji so that any cap lands on, or next to, a surrogate pair.
    const note = `${"x".repeat(151)}${"😊".repeat(5_000)}`;
    const { html, text } = build(Array.from({ length: 10 }, (_, n) => memory(n, { note })));
    expect(html).toContain("read it all from its link");
    for (const part of [html, text]) {
      expect(part).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
      expect(part).not.toContain("\uFFFD");
    }
  });

  it("names the files that did not arrive, with the link to add them again", () => {
    const { html, text } = build([memory(0, { missingFiles: ["IMG_2231.MOV"] }), memory(1)]);
    expect(text).toContain("IMG_2231.MOV");
    expect(text).toMatch(/didn.t arrive/);
    expect(html).toContain("IMG_2231.MOV");
    expect(html).toMatch(/didn&#39;t arrive|didn’t arrive/);
  });

  it("escapes every field and loads nothing from the network", () => {
    const { html } = build([memory(0, { note: "<script>alert(1)</script>", place: "a & b" }), memory(1, { media: [photo({ originalFilename: '"><img src=x>.jpg' })] })], { name: '<a href="https://evil.test">Jo</a>' });
    expect(html).not.toContain('href="https://evil.test"');
    expect(html).not.toContain("<script>");
    expect(html).toContain("a &amp; b");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toMatch(/src="https?:/);
  });
});
