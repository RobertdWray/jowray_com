// Renders README.md's Mermaid diagrams to static SVG for the "The detailed version" section of /how-it-was-built.
// Usage: npx tsx scripts/make-readme-diagrams.ts
// Re-run after changing a ```mermaid block in README.md, then commit public/diagrams/*.svg and
// app/how-it-was-built/readme-diagrams.ts. __tests__/lib/readme-diagrams.test.ts fails until you do.
//
// Why this shape (plan docs/plans/2026-11-06-why-and-how-built.md, ruling R9): the real Mermaid renderer needs a
// browser to measure text, so it runs here, once, in the Google Chrome already installed for development, driven
// by playwright-core (no browser download). The build only copies the committed SVGs: no browser, no network, no
// Mermaid code in any bundle, and the page stays static. Like scripts/make-email-assets.ts and TrayVerify's
// `gen:deck-snapshot`, the output is generated, committed and never edited by hand.
//
// Each SVG embeds the Atkinson Hyperlegible weights it uses as data: URLs, because an SVG shown through <img> can
// load no outside fonts. Requests from the page are refused, so the render cannot reach the network either.
// Each SVG's first line records the SHA-256 of the README block it shows, and every file must pass findUnsafeSvg
// (lib/readme-diagrams.ts) before it is written. With fixed ids and a fixed rough.js seed, re-running on an
// unchanged README rewrites nothing.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { MermaidConfig } from "mermaid";
import { chromium } from "playwright-core";

import { findUnsafeSvg, mermaidSourceHash, readmeMermaidBlocks, svgHeader } from "../lib/readme-diagrams";

const ROOT = join(import.meta.dirname, "..");
const README = join(ROOT, "README.md");
const SVG_DIR = join(ROOT, "public", "diagrams");
const MANIFEST = join(ROOT, "app", "how-it-was-built", "readme-diagrams.ts");
const MERMAID_JS = join(ROOT, "node_modules", "mermaid", "dist", "mermaid.min.js");
const FONT_DIR = join(ROOT, "node_modules", "@fontsource", "atkinson-hyperlegible", "files");

/** The site's 17px floor (design/DESIGN.md §4). The render fails if any diagram text computes smaller. */
const MIN_FONT_PX = 17;
const FONT_PX = 18;
const FONT_STACK = '"Atkinson Hyperlegible", system-ui, sans-serif';

// Brand tokens (app/globals.css @theme; design/DESIGN.md §3). Lines and text are walnut, shapes sit on muslin
// with periwinkle-deep borders, groups get the site's dashed periwinkle, and the ground is paper.
const PAPER = "#fffdf8";
const MUSLIN = "#f6efe3";
const WALNUT = "#2e2420";
const WOOD = "#8a7259";
const WOOD_LIGHT = "#e9d9c0";
const PERIWINKLE = "#5b7db1";
const PERIWINKLE_DEEP = "#3f5f94";

const MERMAID_CONFIG: MermaidConfig = {
  startOnLoad: false,
  securityLevel: "strict",
  deterministicIds: true,
  // ER shapes are drawn through rough.js even in the classic look; its default seed (0) is random per run, so an
  // unchanged README would rewrite data-model.svg on every run. A fixed seed makes the output byte-identical.
  handDrawnSeed: 1,
  theme: "base",
  htmlLabels: false, // SVG <text>, not <foreignObject>: it renders inside <img> and in every browser alike
  fontFamily: FONT_STACK,
  fontSize: FONT_PX,
  themeVariables: {
    darkMode: false,
    background: PAPER,
    fontFamily: FONT_STACK,
    fontSize: `${FONT_PX}px`,
    textColor: WALNUT,
    primaryColor: MUSLIN,
    primaryTextColor: WALNUT,
    primaryBorderColor: PERIWINKLE_DEEP,
    secondaryColor: WOOD_LIGHT,
    secondaryTextColor: WALNUT,
    secondaryBorderColor: WOOD,
    tertiaryColor: PAPER,
    tertiaryTextColor: WALNUT,
    tertiaryBorderColor: PERIWINKLE,
    lineColor: WALNUT,
    // flowchart
    nodeTextColor: WALNUT,
    clusterBkg: PAPER,
    clusterBorder: PERIWINKLE,
    titleColor: WALNUT,
    edgeLabelBackground: PAPER,
    // sequence
    actorBkg: MUSLIN,
    actorBorder: PERIWINKLE_DEEP,
    actorTextColor: WALNUT,
    actorLineColor: WOOD,
    signalColor: WALNUT,
    signalTextColor: WALNUT,
    labelBoxBkgColor: WOOD_LIGHT,
    labelBoxBorderColor: WOOD,
    labelTextColor: WALNUT,
    loopTextColor: WALNUT,
    noteBkgColor: WOOD_LIGHT,
    noteBorderColor: WOOD,
    noteTextColor: WALNUT,
    sequenceNumberColor: PAPER,
    // entity relationship
    attributeBackgroundColorOdd: PAPER,
    attributeBackgroundColorEven: MUSLIN,
    relationColor: WALNUT,
    relationLabelBackground: PAPER,
    relationLabelColor: WALNUT,
  },
  // The ER stylesheet hard-codes 14px relationship labels (mermaid 12.2.0 erDiagram getStyles); lift them to the
  // body size. Mermaid scopes themeCSS to the diagram's id, after its own rules, so this one wins.
  themeCSS: `.edgeLabel .label { font-size: ${FONT_PX}px; }`,
  // Break labels only where README.md has a <br/>: Mermaid's default 120px wrap at 18px split
  // "/api/cron/reconcile-uploads" and "MemoryRevision" mid-word. 400px fits the longest README line.
  flowchart: { useMaxWidth: false, wrappingWidth: 400 },
  sequence: {
    useMaxWidth: false,
    actorFontSize: FONT_PX,
    actorFontFamily: FONT_STACK,
    messageFontSize: FONT_PX,
    messageFontFamily: FONT_STACK,
    noteFontSize: FONT_PX,
    noteFontFamily: FONT_STACK,
  },
  er: { useMaxWidth: false, fontSize: FONT_PX },
};

/**
 * `autonumber` badges are the one thing the Mermaid config cannot size: the renderer hard-codes 12px digits in a
 * 6px-radius circle (sequenceDiagram drawMessage / insertSequenceNumber in mermaid 12.2.0). The render resizes
 * them to the type floor in a circle large enough for two digits; the font-size check below proves it took.
 */
const SEQUENCE_NUMBER = { fontPx: MIN_FONT_PX, radius: 13 };

interface RenderArgs {
  id: string;
  source: string;
  config: MermaidConfig;
  minFontPx: number;
  background: string;
  fontFamily: string;
  sequenceNumber: { fontPx: number; radius: number };
  /** font-weight → data: URL of that weight's woff2. */
  fonts: Record<string, string>;
}

interface RenderResult {
  svg: string;
  width: number;
  height: number;
  tooSmall: string[];
}

// Runs inside Chrome, not Node. It is a string so no TypeScript or tsx transform can add helpers the page lacks.
const IN_PAGE = String.raw`
window.renderReadmeDiagram = async function (args) {
  mermaid.initialize({ ...args.config, deterministicIDSeed: args.id });
  const { svg } = await mermaid.render(args.id, args.source);

  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror")) throw new Error("Mermaid returned SVG that is not well-formed XML");
  const root = doc.documentElement;

  for (const circle of root.querySelectorAll('marker[id$="-sequencenumber"] circle')) {
    circle.setAttribute("r", String(args.sequenceNumber.radius));
  }
  for (const number of root.querySelectorAll("text.sequenceNumber")) {
    // Mermaid sets the baseline 4px under the circle's centre for its 12px digits; centre the larger ones.
    number.setAttribute("y", String(Number(number.getAttribute("y")) - 4));
    number.setAttribute("dominant-baseline", "central");
    number.setAttribute("font-size", args.sequenceNumber.fontPx + "px");
    number.setAttribute("font-family", args.fontFamily);
    number.setAttribute("font-weight", "700");
  }

  // Measure in the live page, where the fonts are loaded, before serialising.
  const host = document.createElement("div");
  host.appendChild(document.importNode(root, true));
  document.body.appendChild(host);
  const live = host.querySelector("svg");
  const tooSmall = [];
  const weights = new Set();
  for (const node of live.querySelectorAll("text, tspan")) {
    const label = node.textContent.trim();
    if (!label || node.querySelector("tspan")) continue;
    const style = getComputedStyle(node);
    const size = parseFloat(style.fontSize);
    if (size < args.minFontPx) tooSmall.push(size + "px: " + label.slice(0, 60));
    weights.add(style.fontWeight === "bold" ? "700" : style.fontWeight === "normal" ? "400" : style.fontWeight);
  }
  host.remove();

  const [, , viewWidth, viewHeight] = root.getAttribute("viewBox").split(/[\s,]+/).map(Number);
  const width = Math.ceil(viewWidth);
  const height = Math.ceil(viewHeight);
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  root.setAttribute("style", "background-color: " + args.background);

  const faces = [...weights].sort().map((weight) => {
    const url = args.fonts[weight];
    if (!url) throw new Error("No embedded font for weight " + weight);
    return '@font-face{font-family:"Atkinson Hyperlegible";font-style:normal;font-weight:' + weight +
      ';src:url(' + url + ') format("woff2")}';
  });
  const style = doc.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = faces.join("");
  root.insertBefore(style, root.firstChild);

  return { svg: new XMLSerializer().serializeToString(doc), width, height, tooSmall };
};
`;

function fontDataUrl(weight: "400" | "700"): string {
  const file = join(FONT_DIR, `atkinson-hyperlegible-latin-${weight}-normal.woff2`);
  return `data:font/woff2;base64,${readFileSync(file).toString("base64")}`;
}

interface ManifestEntry {
  slug: string;
  heading: string;
  githubAnchor: string;
  width: number;
  height: number;
  hash: string;
}

/** A JSON string literal with non-ASCII escaped, so the invisible U+FE0F in some GitHub anchors shows in review. */
function asciiString(value: string): string {
  return JSON.stringify(value).replace(/[^\x20-\x7e]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function manifestSource(entries: ManifestEntry[]): string {
  return [
    "// Generated by scripts/make-readme-diagrams.ts from README.md's Mermaid blocks; do not edit by hand.",
    "// After changing a diagram in README.md, run `npx tsx scripts/make-readme-diagrams.ts` and commit the result;",
    "// __tests__/lib/readme-diagrams.test.ts fails until the hashes below match README.md again.",
    "export const README_DIAGRAMS = {",
    ...entries.flatMap((entry) => [
      `  ${JSON.stringify(entry.slug)}: {`,
      `    heading: ${JSON.stringify(entry.heading)},`,
      `    githubAnchor: ${asciiString(entry.githubAnchor)},`,
      `    src: ${JSON.stringify(`/diagrams/${entry.slug}.svg`)},`,
      `    width: ${entry.width},`,
      `    height: ${entry.height},`,
      `    sourceSha256: ${JSON.stringify(entry.hash)},`,
      "  },",
    ]),
    "} as const;",
    "",
    "export type ReadmeDiagramSlug = keyof typeof README_DIAGRAMS;",
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const blocks = readmeMermaidBlocks(readFileSync(README, "utf8"));
  if (blocks.length === 0) {
    throw new Error("README.md has no ```mermaid blocks.");
  }
  const fonts = { "400": fontDataUrl("400"), "700": fontDataUrl("700") };

  const browser = await chromium
    .launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" })
    .catch((error: unknown) => {
      throw new Error(
        `Could not start Google Chrome (${error instanceof Error ? error.message : String(error)}). ` +
          "Install Chrome, or set CHROME_PATH to a Chrome or Chromium binary.",
      );
    });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    await page.route("**/*", (route) => route.abort());
    const faces = Object.entries(fonts)
      .map(([weight, url]) => `@font-face{font-family:"Atkinson Hyperlegible";font-weight:${weight};src:url(${url}) format("woff2")}`)
      .join("");
    await page.setContent(`<!doctype html><html><head><style>${faces}</style></head><body></body></html>`);
    await page.addScriptTag({ path: MERMAID_JS });
    await page.addScriptTag({ content: IN_PAGE });
    await page.evaluate(async (family) => {
      await Promise.all([document.fonts.load(`400 18px ${family}`), document.fonts.load(`700 18px ${family}`)]);
    }, FONT_STACK);

    mkdirSync(SVG_DIR, { recursive: true });
    for (const file of readdirSync(SVG_DIR)) {
      if (file.endsWith(".svg")) {
        rmSync(join(SVG_DIR, file));
      }
    }

    const entries: ManifestEntry[] = [];
    for (const block of blocks) {
      const args: RenderArgs = {
        id: `readme-${block.slug}`,
        source: block.source,
        config: MERMAID_CONFIG,
        minFontPx: MIN_FONT_PX,
        background: PAPER,
        fontFamily: FONT_STACK,
        sequenceNumber: SEQUENCE_NUMBER,
        fonts,
      };
      const result = await page.evaluate<RenderResult, RenderArgs>(
        (renderArgs) =>
          (window as unknown as { renderReadmeDiagram: (a: RenderArgs) => Promise<RenderResult> }).renderReadmeDiagram(
            renderArgs,
          ),
        args,
      );
      if (result.tooSmall.length > 0) {
        throw new Error(`"${block.heading}" has text under ${MIN_FONT_PX}px:\n  ${result.tooSmall.join("\n  ")}`);
      }
      const hash = mermaidSourceHash(block.source);
      const svg = `${svgHeader(block.heading, hash)}${result.svg}\n`;
      const problems = findUnsafeSvg(svg);
      if (problems.length > 0) {
        throw new Error(`"${block.heading}" failed the SVG safety check:\n  ${problems.join("\n  ")}`);
      }
      writeFileSync(join(SVG_DIR, `${block.slug}.svg`), svg);
      entries.push({
        slug: block.slug,
        heading: block.heading,
        githubAnchor: block.githubAnchor,
        width: result.width,
        height: result.height,
        hash,
      });
      console.log(`${block.heading} → public/diagrams/${block.slug}.svg (${result.width}×${result.height})`);
    }
    writeFileSync(MANIFEST, manifestSource(entries));
    console.log("app/how-it-was-built/readme-diagrams.ts updated");
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
