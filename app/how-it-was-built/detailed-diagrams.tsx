import { REPO_URL } from "../_components/external-links";
import { linkClass } from "../_components/field-classes";
import { DiagramViewer } from "./diagram-viewer-client";
import { README_DIAGRAMS, type ReadmeDiagramSlug } from "./readme-diagrams";

// "The detailed version": README.md's three Mermaid diagrams, for technical readers. The plain-language HTML
// diagrams above stay the accessible summary for everyone (diagrams.tsx).
//
// The SVGs are rendered once, at development time, by scripts/make-readme-diagrams.ts and committed under
// public/diagrams/; the page only points <img> at them. So: no Mermaid in any bundle, no network at build, the
// page stays static, and an SVG shown through <img> cannot run script.
//
// Each image fits its card (DiagramViewer, a small Client Component; this file stays a Server Component). Zoom and
// Full screen reach the natural size, where the script still guarantees 17px or more text. This replaces ruling R9
// of docs/plans/2026-11-06-why-and-how-built.md (natural size in a sideways scroller), which cut the diagrams off at
// the card edge (Rob, 2026-11-06). Plan: docs/plans/2026-11-06-privacy-note-and-diagram-viewer.md.

interface DiagramCopy {
  /** The image's accessible name: what kind of diagram, and what is in it. */
  alt: string;
  /** Shown under the title and linked to the image with aria-describedby. Must agree with plan §6. */
  description: string;
}

// Keyed by the generated manifest, so a README diagram without copy here (or copy for one that is gone) is a type
// error. Order on the page is README order, from the manifest.
const COPY: Record<ReadmeDiagramSlug, DiagramCopy> = {
  "how-a-memory-travels": {
    alt: "Sequence diagram of the numbered steps between the visitor, the browser, the site's Server Functions, Neon Postgres, Vercel Blob, SendGrid and the family's admin page.",
    description:
      "What happens after someone presses Send: the memory is saved in Neon Postgres, each file goes from the browser straight to private Vercel Blob storage and is checked before it counts, and SendGrid sends one receipt with every private link and a family alert with none.",
  },
  architecture: {
    alt: "Flowchart of the system: phones and computers, the Next.js site on Vercel with its Server Functions, route handlers and ten-minute cron, the Neon Postgres and Vercel Blob data stores, SendGrid and Sentry, with arrows for which part talks to which.",
    description:
      "Where each part runs: the Next.js site on Vercel, with its Server Functions, upload routes and ten-minute background job, uses Neon Postgres, Vercel Blob, SendGrid for email and Sentry for error reports. Uploads never pass through the site's own servers.",
  },
  "data-model": {
    alt: "Entity-relationship diagram of the database: Memorial, Person, Contributor, User, Memory, Media, DerivedMedia, MemoryRevision and EmailLog, with the main fields of Memory, Media, DerivedMedia and EmailLog.",
    description:
      "The main database tables and how they connect. The database keeps only a fingerprint (SHA-256) of each private link, never the link itself; the User table is for logins, which come in Phase 3.",
  },
};

const SLUGS = Object.keys(README_DIAGRAMS) as ReadmeDiagramSlug[];

export function DetailedDiagrams() {
  return (
    <div className="flex flex-col gap-12">
      {SLUGS.map((slug) => {
        const diagram = README_DIAGRAMS[slug];
        const { alt, description } = COPY[slug];
        const titleId = `diagram-${slug}-title`;
        const descriptionId = `diagram-${slug}-description`;
        return (
          // figcaption first (title + description), then the scroller, then the full-size and README links.
          <figure key={slug} aria-labelledby={titleId} className="flex min-w-0 flex-col gap-4">
            <figcaption className="flex max-w-[40em] flex-col gap-2">
              <h3 id={titleId} className="font-display text-[24px] font-bold leading-[1.2]">
                {diagram.heading}
              </h3>
              <p id={descriptionId} className="text-body leading-[1.6]">
                {description}
              </p>
            </figcaption>
            <DiagramViewer
              heading={diagram.heading}
              src={diagram.src}
              width={diagram.width}
              height={diagram.height}
              alt={alt}
              descriptionId={descriptionId}
            />
            {/* The README section is the long description: the Mermaid source on GitHub reads as text (the
                "Code" view of README.md) beside the prose around it. Anchors are GitHub's heading ids. The full-size
                link also stays as the way to pan without dragging: the raw SVG scrolls natively (WCAG 2.5.7). */}
            <p className="flex flex-col gap-2 text-[18px] text-walnut-soft sm:flex-row sm:flex-wrap sm:gap-x-3">
              <a href={diagram.src} className={linkClass}>
                Open &ldquo;{diagram.heading}&rdquo; full size
              </a>
              {/* The dot only sits between links on one line; on a phone they stack and it would dangle. */}
              <span aria-hidden="true" className="hidden sm:inline">
                ·
              </span>
              <a href={`${REPO_URL}#${encodeURIComponent(diagram.githubAnchor)}`} className={linkClass}>
                Read &ldquo;{diagram.heading}&rdquo; in the README on GitHub
              </a>
            </p>
          </figure>
        );
      })}
    </div>
  );
}
