import { createHash } from "node:crypto";

// README.md is the one source of truth for the three detailed diagrams on /how-it-was-built. These helpers find
// its Mermaid blocks for scripts/make-readme-diagrams.ts (which renders them to public/diagrams/*.svg) and for
// __tests__/lib/readme-diagrams.test.ts (which fails when README.md changes and the SVGs were not re-rendered).

export interface ReadmeMermaidBlock {
  /** From the `## ` heading above the block, e.g. "how-a-memory-travels"; names the SVG file. */
  slug: string;
  /** That heading's text without its emoji, e.g. "How a memory travels". */
  heading: string;
  /** The block's lines between the fences, exactly as written, joined with "\n". */
  source: string;
}

const FENCE_OPEN = "```mermaid";
const FENCE_CLOSE = "```";

/** Strips the leading emoji and spaces from a README heading ("🧭 How a memory travels" → "How a memory travels"). */
function headingText(line: string): string {
  return line
    .replace(/^##\s+/, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .trim();
}

function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Every ```mermaid block in the markdown, in order, named after the `## ` heading it sits under.
 * Throws on an unclosed fence, a block before any `## ` heading, or two blocks under one heading, because each
 * of those would leave a diagram without a stable file name.
 */
export function readmeMermaidBlocks(markdown: string): ReadmeMermaidBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: ReadmeMermaidBlock[] = [];
  let heading: string | null = null;
  let inside: string[] | null = null;

  for (const line of lines) {
    if (inside) {
      if (line.trim() === FENCE_CLOSE) {
        if (!heading) {
          throw new Error("A Mermaid block in README.md has no `## ` heading above it.");
        }
        const slug = slugify(heading);
        if (blocks.some((block) => block.slug === slug)) {
          throw new Error(`README.md has two Mermaid blocks under "## ${heading}"; give each its own heading.`);
        }
        blocks.push({ slug, heading, source: inside.join("\n") });
        inside = null;
      } else {
        inside.push(line);
      }
      continue;
    }
    if (line.startsWith("## ")) {
      heading = headingText(line);
    } else if (line.trim() === FENCE_OPEN) {
      inside = [];
    }
  }
  if (inside) {
    throw new Error("README.md has a ```mermaid block that is never closed.");
  }
  return blocks;
}

/** The fingerprint the generated manifest records for each block; hex SHA-256 of the source text. */
export function mermaidSourceHash(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}
