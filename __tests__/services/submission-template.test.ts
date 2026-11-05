import { describe, expect, it } from "vitest";

import { EMAIL_ASSETS } from "@/lib/email-assets";
import { buildMemoryConfirmation, MEMORY_CONFIRMATION_SUBJECT } from "@/services/email/templates/memory-confirmation";
import { buildSubmissionConfirmation, SUBMISSION_HTML_BUDGET_BYTES, submissionConfirmationSubject } from "@/services/email/templates/submission-confirmation";
import type { ReceiptMediaSummary, SubmissionMemoryContent } from "@/services/email/types";

const JPEG_1PX = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const token = (n: number) => String.fromCharCode(97 + n).repeat(43);
const link = (n: number) => `https://www.jowray.com/m/${token(n)}`;

function photo(over: Partial<ReceiptMediaSummary> = {}): ReceiptMediaSummary {
  return { kind: "PHOTO", durationSeconds: null, preview: null, ...over };
}
function preview(id: string): ReceiptMediaSummary["preview"] {
  return { contentId: `preview-${id}`, contentBase64: JPEG_1PX, width: 1000, height: 750 };
}
function memory(n: number, over: Partial<SubmissionMemoryContent> = {}): SubmissionMemoryContent {
  return { position: n + 1, hasWords: true, media: [], claimLink: link(n), missingFiles: 0, ...over };
}
function build(memories: SubmissionMemoryContent[]) {
  return buildSubmissionConfirmation({ memories });
}
const POISON = '"><img src=x onerror=alert(1)>https://evil.test/x.jpg';

describe("buildSubmissionConfirmation: one memory", () => {
  it("renders byte-for-byte as the single-memory confirmation", () => {
    const media = [photo({ preview: preview("m1") }), photo({ kind: "VOICE", durationSeconds: 30 })];
    const single = buildMemoryConfirmation({ hasWords: true, media, claimLink: link(0) });
    const batch = build([memory(0, { media })]);
    expect(batch).toEqual(single);
    expect(batch.subject).toBe(MEMORY_CONFIRMATION_SUBJECT);
  });
});

describe("buildSubmissionConfirmation: one memory with a missing file", () => {
  it("reads in the singular everywhere and counts the file without naming it", () => {
    const { subject, text, html } = build([memory(0, { missingFiles: 1 })]);
    expect(subject).toBe(MEMORY_CONFIRMATION_SUBJECT);
    expect(text).toContain("Your memory is on its way to Richard, Rob and Tracy.");
    expect(text).not.toMatch(/1 memories/);
    expect(text).toContain("Your private link (keep it private: anyone who has it can edit this memory):");
    expect(text.trimEnd().endsWith("Keep this link private: anyone who has it can edit this memory.")).toBe(true);
    expect(html).toContain("Your private link");
    expect(html).not.toContain("Your private links");
    expect(html).toMatch(/One file didn&#39;t arrive/);
    expect(text).toContain("One file didn't arrive");
  });
});

describe("buildSubmissionConfirmation: several memories (fixed content, issue #46 D1)", () => {
  it("has a plural subject, puts every link first, and heads each memory by its number only", () => {
    const { subject, html, text } = build([memory(0), memory(1), memory(2)]);
    expect(subject).toBe(submissionConfirmationSubject(3));
    expect(subject).toBe("Thank you for sharing 3 memories");
    // Links come before any memory card, in both parts.
    const firstLinkText = text.indexOf(link(0));
    expect(firstLinkText).toBeGreaterThan(-1);
    expect(firstLinkText).toBeLessThan(text.indexOf("What you sent"));
    expect(text.indexOf(link(2))).toBeLessThan(text.indexOf("What you sent"));
    expect(html.indexOf(`href="${link(0)}"`)).toBeLessThan(html.indexOf(">Memory 1</td>"));
    expect(html.indexOf(`href="${link(2)}"`)).toBeLessThan(html.indexOf(">Memory 1</td>"));
    expect(html).toContain(">Memory 1</a>");
    expect(html).toContain(">Memory 3</a>");
    expect(html).toContain(">Memory 2</td>");
    expect(text).toContain("- Memory 1\n  ");
    expect(text).toContain("\nMemory 2\nWhat you sent: your words");
    // No red button: text links only.
    expect(html).not.toContain("v:roundrect");
    expect(text).toContain("Your 3 memories are on their way");
    expect(text).toContain("Thank you. Your 3 memories");
    expect(html).toContain("Your words and details are on each memory");
  });

  it("carries nothing the contributor typed: no name, relationship, date, place, note or filename", () => {
    const { html, text } = build([memory(0, { media: [{ ...photo(), originalFilename: POISON } as ReceiptMediaSummary] }), memory(1, { media: [{ ...photo({ kind: "VOICE", durationSeconds: 4 }), originalFilename: POISON } as ReceiptMediaSummary] })]);
    for (const part of [html, text]) {
      expect(part).not.toContain("evil.test");
      expect(part).not.toContain("x.jpg");
      expect(part).not.toContain("Your name");
      expect(part).not.toContain("How you knew Jo");
      expect(part).not.toContain("When:");
      expect(part).not.toContain("Where:");
      expect(part).not.toContain("Your memory of Jo:");
      expect(part).not.toContain("Your memory of Jo</div>");
    }
    expect(html).not.toContain("<img src=x");
    expect(html).not.toMatch(/src="https?:/);
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
    const cardOne = html.slice(html.lastIndexOf(">Memory 1</td>"), html.lastIndexOf(">Memory 2</td>"));
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

  it("keeps the largest possible send (ten memories, ten files each, ten missing each) under the Gmail budget by dropping the file cards, never words", () => {
    const tenFiles = (n: number) => Array.from({ length: 10 }, (_, i) => photo({ kind: i % 3 === 0 ? "VOICE" : i % 3 === 1 ? "VIDEO" : "PHOTO", durationSeconds: 86400, preview: i % 3 === 1 ? preview(`m${n}-${i}`) : null }));
    const biggest = build(Array.from({ length: 10 }, (_, n) => memory(n, { media: tenFiles(n), missingFiles: 10 })));
    expect(Buffer.byteLength(biggest.html, "utf8")).toBeLessThan(SUBMISSION_HTML_BUDGET_BYTES);
    expect(SUBMISSION_HTML_BUDGET_BYTES).toBeLessThanOrEqual(100 * 1024);
    expect(biggest.html).not.toContain("read it all from its link");
    expect(biggest.html).not.toContain("cid:preview-");
    expect(biggest.attachments.filter((a) => a.contentId.startsWith("preview-"))).toHaveLength(0);
    // The counts still say what arrived, and every link is there.
    expect(biggest.text).toContain("What you sent: your words, 3 photos, 3 videos and 4 voice recordings");
    expect(biggest.text).toContain("10 files didn't arrive");
    for (let n = 0; n < 10; n += 1) {
      expect(biggest.html).toContain(`href="${link(n)}"`);
    }
    // A send that fits keeps its cards.
    const fits = build([memory(0, { media: tenFiles(0) }), memory(1, { media: tenFiles(1) })]);
    expect(Buffer.byteLength(fits.html, "utf8")).toBeLessThan(SUBMISSION_HTML_BUDGET_BYTES);
    expect(fits.html).toContain("cid:preview-");
    expect(fits.html.split("Voice recording · 1440:00").length - 1).toBe(8);
  });

  it("counts the files that did not arrive, with the link to add them again", () => {
    const { html, text } = build([memory(0, { missingFiles: 3 }), memory(1)]);
    expect(text).toContain("3 files didn't arrive — add them again from this link:");
    expect(html).toMatch(/3 files didn&#39;t arrive/);
    expect(build([memory(0, { missingFiles: 1 }), memory(1)]).text).toContain("One file didn't arrive — add it again from this link:");
  });
});
