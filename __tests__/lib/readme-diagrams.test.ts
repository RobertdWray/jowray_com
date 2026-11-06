import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { README_DIAGRAMS } from "@/app/how-it-was-built/readme-diagrams";
import {
  findUnsafeSvg,
  githubHeadingAnchor,
  mermaidSourceHash,
  readmeMermaidBlocks,
  svgHeader,
  svgSourceHash,
} from "@/lib/readme-diagrams";

const ROOT = join(import.meta.dirname, "..", "..");
const README = readFileSync(join(ROOT, "README.md"), "utf8");
const SVG_DIR = join(ROOT, "public", "diagrams");
const REGENERATE = "Run `npx tsx scripts/make-readme-diagrams.ts` and commit public/diagrams/ and readme-diagrams.ts.";
const MANIFEST = Object.entries(README_DIAGRAMS);

describe("readmeMermaidBlocks", () => {
  it("names each block after the heading above it and keeps the source exact", () => {
    const markdown = [
      "# Title",
      "## 🧭 How a memory travels",
      "```mermaid",
      "sequenceDiagram",
      "    A->>B: hi<br/>there",
      "```",
      "```ts",
      "const notADiagram = true;",
      "```",
      "## 🗃️ Data model",
      "text",
      "```mermaid",
      "erDiagram",
      "```",
    ].join("\n");
    expect(readmeMermaidBlocks(markdown)).toEqual([
      {
        slug: "how-a-memory-travels",
        heading: "How a memory travels",
        githubAnchor: "-how-a-memory-travels",
        source: "sequenceDiagram\n    A->>B: hi<br/>there",
      },
      { slug: "data-model", heading: "Data model", githubAnchor: "️-data-model", source: "erDiagram" },
    ]);
  });

  it("does not take a `## ` line or a ```mermaid line inside another fenced block for a heading or a diagram", () => {
    const markdown = [
      "## 🏗️ Architecture",
      "```bash",
      "## this is a shell comment, not a heading",
      "```",
      "~~~~text",
      "```mermaid",
      "flowchart LR",
      "```",
      "~~~~",
      "```mermaid",
      "flowchart TB",
      "```",
    ].join("\n");
    expect(readmeMermaidBlocks(markdown)).toEqual([
      { slug: "architecture", heading: "Architecture", githubAnchor: "️-architecture", source: "flowchart TB" },
    ]);
  });

  it("refuses an unclosed block, a block with no heading and two blocks under one heading", () => {
    expect(() => readmeMermaidBlocks("## A\n```mermaid\nflowchart LR")).toThrow(/never closed/);
    expect(() => readmeMermaidBlocks("```mermaid\nflowchart LR\n```")).toThrow(/no `## ` heading/);
    expect(() => readmeMermaidBlocks("## A\n```mermaid\nx\n```\n```mermaid\ny\n```")).toThrow(/two Mermaid blocks/);
  });
});

describe("githubHeadingAnchor", () => {
  it("matches the heading ids GitHub gives README.md (read from the repository page, 2026-11-06)", () => {
    expect(githubHeadingAnchor("## 🧭 How a memory travels")).toBe("-how-a-memory-travels");
    expect(githubHeadingAnchor("## 🏗️ Architecture")).toBe("️-architecture");
    expect(githubHeadingAnchor("## 🗃️ Data model")).toBe("️-data-model");
    expect(githubHeadingAnchor("## 🔐 Security and privacy, in one screen")).toBe("-security-and-privacy-in-one-screen");
  });
});

// The drift guard: README.md is the source of truth, and the page shows SVGs rendered from it. If this fails,
// a README diagram changed (or was added, removed or retitled) without re-rendering.
describe("the detailed diagrams on /how-it-was-built match README.md", () => {
  const blocks = readmeMermaidBlocks(README);

  it("has one rendered diagram per README block, in README order", () => {
    expect(MANIFEST.map(([slug]) => slug), REGENERATE).toEqual(blocks.map((block) => block.slug));
  });

  it.each(blocks.map((block) => [block.heading, block] as const))(
    "%s: the manifest and the SVG were both rendered from the current README text",
    (_, block) => {
      const hash = mermaidSourceHash(block.source);
      const entry = README_DIAGRAMS[block.slug as keyof typeof README_DIAGRAMS];
      expect(entry?.sourceSha256, `README.md's "${block.heading}" diagram changed. ${REGENERATE}`).toBe(hash);
      const svg = readFileSync(join(SVG_DIR, `${block.slug}.svg`), "utf8");
      expect(svgSourceHash(svg), `public/diagrams/${block.slug}.svg is stale. ${REGENERATE}`).toBe(hash);
      expect(entry.heading).toBe(block.heading);
      expect(entry.githubAnchor, REGENERATE).toBe(block.githubAnchor);
    },
  );

  it("has exactly the SVG files the manifest names", () => {
    const files = readdirSync(SVG_DIR)
      .filter((file) => file.endsWith(".svg"))
      .sort();
    expect(files).toEqual(MANIFEST.map(([slug]) => `${slug}.svg`).sort());
    for (const [slug, entry] of MANIFEST) {
      expect(entry.src).toBe(`/diagrams/${slug}.svg`);
    }
  });
});

describe.each(MANIFEST)("public/diagrams/%s.svg", (slug, entry) => {
  const svg = readFileSync(join(SVG_DIR, `${slug}.svg`), "utf8");
  const rootTag = svg.match(/<svg\b[^>]*>/)?.[0] ?? "";

  it("passes the safety check", () => {
    expect(findUnsafeSvg(svg)).toEqual([]);
  });

  it("is sized to the manifest", () => {
    expect(rootTag).toContain(`width="${entry.width}"`);
    expect(rootTag).toContain(`height="${entry.height}"`);
  });

  it("carries its own font, so it renders in Atkinson Hyperlegible inside <img> and opened on its own", () => {
    expect(svg).toMatch(/@font-face\{font-family:"Atkinson Hyperlegible";[^}]*src:url\(data:font\/woff2;base64,/);
  });
});

// The guard must be proven, not assumed: each payload below is spliced into a real committed SVG, and the check
// has to name the reason it is unsafe. The first four are the ones an outside review showed the earlier,
// pattern-matching test let through.
describe("findUnsafeSvg rejects known attacks", () => {
  const base = readFileSync(join(SVG_DIR, `${MANIFEST[0][0]}.svg`), "utf8");
  const beforeClose = (payload: string) => base.replace(/<\/svg>\s*$/, `${payload}</svg>\n`);
  const inStyle = (css: string) => base.replace("<style>", `<style>${css}`);
  const afterHeader = (markup: string) => base.replace("-->\n", `-->\n${markup}`);

  it("accepts the unmodified file", () => {
    expect(findUnsafeSvg(base)).toEqual([]);
  });

  it.each([
    ["an entity-encoded javascript: href", beforeClose('<a href="&#106;avascript:alert(1)"><text>x</text></a>'), /javascript: URL/],
    ["an entity-encoded javascript: href on an allowed element", beforeClose('<g href="&#x6A;ava&#x09;script:alert(1)"/>'), /javascript: URL/],
    ["an <image> loading from another host", beforeClose('<image href="//evil.example/x.png"/>'), /<image>: not an element[\s\S]*not a #id or data: URL/],
    ["@import in the stylesheet", inStyle("@import url(//evil.example/x.css);"), /@import[\s\S]*url\(\/\/evil\.example/],
    ["<set> animating an event handler", beforeClose('<set attributeName="onmouseover" to="alert(1)"/>'), /<set>: not an element[\s\S]*animates onmouseover/],
    ["<animate> swapping an href", beforeClose('<animate attributeName="href" to="javascript:alert(1)"/>'), /animates href/],
    ["an event-handler attribute on an allowed element", beforeClose('<g onclick="alert(1)"/>'), /event-handler attribute/],
    ["<script>", beforeClose("<script>alert(1)</script>"), /<script>: script/],
    ["<foreignObject> with HTML", beforeClose('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>'), /foreignObject can carry HTML/],
    ["an outside url() in an allowed attribute, entity-encoded", beforeClose('<g fill="u&#114;l(//evil.example/x)"/>'), /url\(\/\/evil\.example\/x\) is not a #id/],
    ["an outside url() in a style attribute, upper-case", beforeClose('<rect style="fill:URL(https://evil.example/x)"/>'), /is not a #id or data: URL/],
    ["image-set() in a style attribute", beforeClose("<rect style=\"background:image-set(&quot;//evil.example/x.png&quot; 1x)\"/>"), /image-set/],
    ["a CSS escape disguising @import", inStyle("@\\69mport '//evil.example/x.css';"), /CSS escape/],
    ["a DOCTYPE declaring entities", afterHeader('<!DOCTYPE svg [<!ENTITY x "javascript:alert(1)">]>'), /markup the check cannot read/],
    ["a processing instruction", afterHeader('<?xml-stylesheet href="//evil.example/x.css"?>'), /markup the check cannot read/],
    ["an undeclared entity", beforeClose("<text>&x;</text>"), /not one of XML's character references/],
    ["a single-quoted attribute the tokenizer cannot read", beforeClose("<g fill='url(//evil.example/x)'/>"), /markup the check cannot read/],
    ["an xlink:href to another host", beforeClose('<g xlink:href="https://evil.example/"/>'), /not a #id or data: URL/],
  ])("%s", (_, spoofed, reason) => {
    const problems = findUnsafeSvg(spoofed);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toMatch(reason);
  });
});

describe("svgHeader and svgSourceHash", () => {
  it("round-trip the README block hash", () => {
    const hash = mermaidSourceHash("flowchart LR");
    expect(svgSourceHash(`${svgHeader("Architecture", hash)}<svg/>`)).toBe(hash);
    expect(svgSourceHash("<svg/>")).toBeNull();
  });
});
