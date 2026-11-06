import type { Metadata } from "next";
import Link from "next/link";

import { PrimaryLink, secondaryButtonClass } from "../_components/buttons";
import { REPO_URL, ROB_URL } from "../_components/external-links";
import { linkClass, quietLinkClass } from "../_components/field-classes";
import { StitchedHeart } from "../_components/hearts";
import { DetailedDiagrams } from "./detailed-diagrams";
import { StackDiagram, StitchedSteps, type DiagramItem } from "./diagrams";

export const metadata: Metadata = {
  title: "How this site was built — Jo Wray",
  description:
    "Why Rob Wray built jowray.com for his mom, Jo, and how it works: the trip a memory takes, what runs where, and how it was built with AI in three days.",
};

// Every claim on this page is checked against the code in the plan's fact table:
// docs/plans/2026-11-06-why-and-how-built.md §6 (F1–F25). Re-check a row there before changing its sentence.
// Static page: no request-time data, so it prerenders at build like /obituary.

const stats = [
  { value: "3 days", label: "to build the first version, November 2–4, 2026" }, // F2
  { value: "37", label: "pull requests in those three days" }, // F3: merged PRs, Eastern days
  { value: "1,200+", label: "automated tests" }, // F4: 1,221 at 95f4df4 (2026-11-06)
  { value: "0", label: "accounts to make" }, // F5
] as const;

const memorySteps: readonly DiagramItem[] = [
  {
    title: "You share.",
    body: "Type a few words, record your voice, or pick photos and videos. No account needed.",
  },
  {
    title: "Your words are saved.",
    body: "Your name, your words and when you sent them go into the family's database.",
  },
  {
    title: "Files go straight to private storage.",
    body: "Photos, videos and recordings travel directly from your phone to a private store. Each file is checked to make sure it really is a photo, video or recording, and photos get a web-sized copy with the location data removed.",
  },
  {
    title: "You get a private link.",
    body: "It's on the thank-you screen and in an email, so you can come back to fix a typo or add a photo.",
  },
  {
    title: "The family reads it.",
    body: "Jo's family gets a note that a memory arrived and reads it on their private page.",
  },
];

const stackTiers: readonly DiagramItem[] = [
  {
    title: "Your phone or computer",
    body: "The share page, the recorder and the uploads, all in your web browser.",
  },
  {
    title: "The website, on Vercel",
    body: "Next.js 16 and React 19: the pages, the code that saves memories, the upload and media routes, and the ten-minute background job.",
  },
];

const stackServices: readonly DiagramItem[] = [
  { title: "Neon Postgres", body: "Memories, names and their edit history." },
  {
    title: "Vercel Blob",
    body: "Photos, videos and recordings, kept private. Uploads arrive here straight from your browser.",
  },
  { title: "SendGrid", body: "Your receipt and the family's alert." },
  { title: "Sentry", body: "Error reports and recordings of visits, so problems get fixed fast." },
];

const buildSteps: readonly DiagramItem[] = [
  { title: "Rob decides.", body: "What the site should do, how it should feel, and every call about Jo." },
  {
    title: "A written plan.",
    body: 'An agent writes a plan with Rob\'s decisions quoted word for word, plus a "premortem": imagine it failed, then ask why.',
  },
  {
    title: "Built on its own branch.",
    body: "Every change, even an urgent fix, gets its own branch, with tests written first for the risky parts like uploads and email.",
  },
  {
    title: "Reviewed.",
    body: "A fresh AI reviewer reads the whole change, and for bigger changes two more AI models, Google's Gemini and OpenAI's Codex, review it independently.",
  },
  {
    title: "Rob approves, and it ships.",
    body: "Automated checks must pass before anything reaches the live site.",
  },
];

const builtWith = [
  "Next.js 16",
  "React 19",
  "TypeScript",
  "Tailwind CSS 4",
  "Prisma 7",
  "Neon Postgres 18",
  "Vercel (hosting, Blob storage, cron)",
  "SendGrid",
  "Sentry",
  "sharp and heic-decode (libheif in WebAssembly)",
  "Vitest",
  "Claude Code",
] as const;

const h2Class = "font-display text-h2-sm font-bold sm:text-h2";

export default function HowItWasBuiltPage() {
  return (
    // Padding on the full-width landmark and the 1200px cap on the box inside it, as in site-header.tsx: on one
    // box, the 5% resolves against the whole window and eats into the cap.
    <main className="flex flex-1 flex-col px-[max(16px,5%)] py-10">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-16">
        <section aria-labelledby="page-heading" className="flex flex-col gap-6">
          <StitchedHeart size={40} />
          <div className="flex flex-col gap-3">
            <p className="text-body font-bold uppercase tracking-[0.08em] text-jo-red-deep">Behind the scenes</p>
            <h1 id="page-heading" className="font-display text-display-sm font-extrabold sm:text-display">
              How this site was built
            </h1>
          </div>
          <p className="max-w-[34em] text-lead">
            Jo&apos;s family wanted one place where everyone who knew her could leave a memory without making
            an account, installing anything, or being good with computers. Many of the people sharing are over
            70 and on a phone, so every choice starts there.
          </p>
          <p className="text-body">
            By{" "}
            <a href={ROB_URL} className={quietLinkClass}>
              Rob Wray
            </a>
            , Jo&apos;s son.{" "}
            <Link href="/#why" className={linkClass}>
              Why I built it
            </Link>
            .
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <a href={REPO_URL} className={`${secondaryButtonClass} min-w-0`}>
              See the code on GitHub
            </a>
          </div>
          <ul
            role="list"
            aria-label="The first version in numbers"
            className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4"
          >
            {stats.map((stat) => (
              <li
                key={stat.label}
                className="flex flex-col gap-1 rounded-card border-[3px] border-wood-light bg-paper px-5 py-4 shadow-card"
              >
                <span className="font-display text-[44px] font-extrabold leading-none text-jo-red">{stat.value}</span>
                <span className="text-body">{stat.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="trip-heading" className="flex flex-col gap-6">
          <h2 id="trip-heading" className={h2Class}>
            The trip a memory takes
          </h2>
          <StitchedSteps
            label="What happens after you press Send"
            steps={memorySteps}
            caption="Every ten minutes, a background job looks for uploads that reached storage but still need finishing, and for emails that need another try. If an upload is interrupted, you may need to send that file again."
          />
        </section>

        <section aria-labelledby="stack-heading" className="flex flex-col gap-6">
          <h2 id="stack-heading" className={h2Class}>
            What runs where
          </h2>
          <StackDiagram
            label="Where each part of the site runs, from your browser down"
            tiers={stackTiers}
            services={stackServices}
            servicesLabel="Services the website uses"
            caption="Inside, the code is layered so each part only talks to the ones below it: pages, then features, then services, then the outside vendors. A linter enforces it."
          />
        </section>

        <section aria-labelledby="build-heading" className="flex flex-col gap-6">
          <h2 id="build-heading" className={h2Class}>
            How Rob and AI built it
          </h2>
          <p className="max-w-[40em] text-body leading-[1.6]">
            The first version took three days and 37 pull requests. Rob decided what to build and made every
            call about Jo. AI coding agents, mostly Anthropic&apos;s Claude with OpenAI&apos;s Codex on some
            features, planned, built, tested and documented the work, and independent AI reviewers checked it.
          </p>
          <StitchedSteps
            label="How each change was made"
            steps={buildSteps}
            caption="Then around again. You can read the plans, decisions and review notes in the repository."
          />
        </section>

        <section aria-labelledby="people-heading" className="flex flex-col gap-6">
          <h2 id="people-heading" className={h2Class}>
            Made for Jo&apos;s people
          </h2>
          <ul className="flex max-w-[40em] list-disc flex-col gap-3 pl-7 text-body leading-[1.6] marker:text-jo-red">
            <li>Large text in Atkinson Hyperlegible, a typeface made for low-vision readers.</li>
            <li>Big buttons, and nothing hidden behind a hover.</li>
            <li>iPhone photos work as they are, including Apple&apos;s HEIC format.</li>
            <li>The heart is the logo because Jo&apos;s maiden name was Hart.</li>
          </ul>
        </section>

        <section aria-labelledby="stack-list-heading" className="flex flex-col gap-6">
          <h2 id="stack-list-heading" className={h2Class}>
            Built with
          </h2>
          <ul role="list" className="flex list-none flex-wrap gap-3 p-0">
            {builtWith.map((tool) => (
              <li
                key={tool}
                className="rounded-full border-[3px] border-dashed border-periwinkle bg-paper px-4 py-2 text-label font-bold"
              >
                {tool}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="privacy-heading" className="flex flex-col gap-6">
          <h2 id="privacy-heading" className={h2Class}>
            Privacy, in plain words
          </h2>
          <ul className="flex max-w-[40em] list-disc flex-col gap-3 pl-7 text-body leading-[1.6] marker:text-jo-red">
            <li>
              Your private link lets you see, correct or add to your memory. The site&apos;s database keeps only
              a scrambled fingerprint of the link, never the link itself. Jo&apos;s family can also make
              corrections from their private page.
            </li>
            <li>Files sit in private storage. Photos are shown from a copy with the location data removed.</li>
            {/* Goes stale when the Phase 2 gallery ships (issue #37): reword it in that PR (plan §12 F4). */}
            <li>Nothing you share is public yet. The family reads every memory first.</li>
            {/* Alpha telemetry (AGENTS.md § Sentry). When the alpha settings end, UPDATE this line in the same
                commit; do not delete it: replays continue at 10% after the alpha (telemetry plan §13, plan §12 F3).
                The footer's Privacy note (app/_components/privacy-note-client.tsx) says the same thing in Rob's
                words: update both together. */}
            <li>
              One honest note: during this early version, Rob uses detailed error reports and recordings of
              visits, including what people type and the photos on screen, to find and fix problems. Reports can
              include your name and email address. The family approved this. Some recordings, and screenshots
              sent with a problem report, can include private links.
            </li>
          </ul>
        </section>

        {/* README.md's Mermaid diagrams, for technical readers; the HTML diagrams above stay the plain summary
            (plan R9). Rendered by scripts/make-readme-diagrams.ts; see detailed-diagrams.tsx. */}
        <section aria-labelledby="detail-heading" className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <p className="text-body font-bold uppercase tracking-[0.08em] text-walnut-soft">For the technically curious</p>
            <h2 id="detail-heading" className={h2Class}>
              The detailed version
            </h2>
          </div>
          <p className="max-w-[40em] text-body leading-[1.6]">
            The pictures above are the simple version. These three are the ones the programmers use, from the
            project&apos;s README on GitHub. Each one fits the screen: zoom in to read the small print, drag to move
            around once zoomed in, or open it full screen.
          </p>
          <DetailedDiagrams />
        </section>

        <section aria-labelledby="open-heading" className="flex flex-col gap-6">
          <h2 id="open-heading" className={h2Class}>
            The code is open
          </h2>
          <p className="max-w-[40em] text-body leading-[1.6]">
            The code, the plans and the decisions are{" "}
            <a href={REPO_URL} className={linkClass}>
              on GitHub
            </a>
            .
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <PrimaryLink href="/share" className="min-w-0">
              <StitchedHeart size={26} color="#fff" />
              Leave a memory of Jo
            </PrimaryLink>
          </div>
        </section>
      </div>
    </main>
  );
}
