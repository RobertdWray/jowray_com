import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { listPublicMemories } from "@/features/memories/public";
import { KIND_TEXT } from "@/lib/memories/format";
import { buildTimeline, type TimelineDecade, type TimelineModel } from "@/lib/memories/timeline";
import { PUBLIC_KINDS, type PublicMemory } from "@/lib/memories/types";
import { parseTimelineQuery } from "@/lib/validations/public-memories";
import { getPublicMemoriesEnv } from "@/server/config/env";

import { SolidHeart } from "../../_components/hearts";
import { OpeningSoon } from "../_components/bands";
import { bandClass, chipOffClass, chipOnClass, eyebrowClass, innerClass } from "../_components/chips";
import { DecadeBars } from "../_components/decade-bars";
import { shareHref, timelineHref } from "../_components/hrefs";
import { MemoryCard } from "../_components/memory-card";
import { TimelineDecades, type TimelineDecadeItem } from "../_components/timeline-decades-client";
import { ViewNav } from "../_components/view-nav";

export const metadata: Metadata = {
  title: "Memories by year — Jo Wray",
  description: "The Jo stories on one thread, first to last, decade by decade.",
  robots: { index: false, follow: false },
};

export default function TimelinePage(props: PageProps<"/memories/timeline">) {
  return (
    <main className="flex flex-1 flex-col motion-safe:scroll-smooth">
      <div className={`${bandClass} pt-4 sm:pt-6`}>
        <p className={`${innerClass} ${eyebrowClass}`}>Memories of Jo · by year</p>
      </div>
      <Suspense fallback={<p className={`${bandClass} py-8 text-body text-walnut-soft`}>Loading…</p>}>
        <TimelineContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function TimelineContent({ searchParams }: { searchParams: PageProps<"/memories/timeline">["searchParams"] }) {
  await connection();
  if (!getPublicMemoriesEnv().PUBLIC_MEMORIES_ENABLED) {
    return (
      <>
        <h1 className={`${bandClass} pb-6 pt-3 font-display text-display-sm font-extrabold sm:text-display`}>
          <span className={innerClass}>Jo stories, first to last</span>
        </h1>
        <OpeningSoon />
      </>
    );
  }
  const { kind } = parseTimelineQuery(await searchParams);
  const model = buildTimeline(await listPublicMemories(), kind);
  return (
    <>
      <section aria-labelledby="timeline-h" className={`${bandClass} pb-4 pt-3 sm:pb-10 sm:pt-5`}>
        <div className={`${innerClass} flex flex-col gap-3 sm:gap-5`}>
          <h1 id="timeline-h" className="max-w-[14em] font-display text-display-sm font-extrabold sm:text-display">
            {model.title ?? "Jo stories, first to last"}
          </h1>
          <p className="max-w-[36em] text-label font-normal sm:hidden">Dates are as people remembered them. &ldquo;Summer 1985&rdquo; counts.</p>
          <p className="hidden max-w-[36em] text-lead sm:block">
            The thread runs from a girl folding paper crowns on an Army post to a grandmother with a drawer full of stickers. Dates are as people remembered them: &ldquo;Summer
            1985&rdquo; counts.
          </p>
          <ViewNav current="timeline" />
        </div>
      </section>
      <JumpBand model={model} />
      <section aria-label="The timeline" className={`${bandClass} pb-6 pt-6 sm:pb-12 sm:pt-14`}>
        <div className={innerClass}>
          <TimelineDecades items={items(model)} defaultOpen={model.openDecade === null ? null : `d${model.openDecade}`} />
          <p className="flex items-center gap-3 pb-6 pt-1 font-display text-[21px] font-bold sm:gap-4 sm:pl-[220px] sm:text-[24px]">
            <SolidHeart size={30} />
            <span>
              The thread keeps going.{" "}
              <Link href={shareHref} className="text-jo-red-deep underline hover:text-walnut">
                Add a stitch.
              </Link>
            </span>
          </p>
        </div>
      </section>
    </>
  );
}

function JumpBand({ model }: { model: TimelineModel }) {
  const kind = model.kind ?? undefined;
  return (
    <section aria-label="Jump to a decade" className={`${bandClass} border-t-[3px] border-dashed border-jo-red bg-paper py-4 sm:border-b-[3px] sm:py-6`}>
      <div className={`${innerClass} flex flex-col gap-[10px] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-8 sm:gap-y-4`}>
        <div className="min-w-0 sm:flex-[1_1_560px]">
          <DecadeBars variant="jump" max={model.maxCount} bars={model.jumps.map((jump) => ({ decade: jump.decade, count: jump.count, selected: false, href: timelineHref({ kind, decade: jump.decade }) }))} />
        </div>
        <p className="text-small text-walnut-soft sm:hidden">Tap a decade to open it. One at a time keeps the page short.</p>
        <div className="hidden flex-wrap items-center gap-[10px] sm:flex">
          <span className="mr-1 text-label font-bold" id="show-label">
            Show:
          </span>
          <ul aria-labelledby="show-label" className="flex flex-wrap gap-[10px]">
            <li>
              <Link href={timelineHref()} prefetch={false} scroll={false} aria-current={kind === undefined ? "true" : undefined} className={kind === undefined ? chipOnClass : chipOffClass}>
                All
              </Link>
            </li>
            {PUBLIC_KINDS.map((option) => (
              <li key={option}>
                <Link href={timelineHref({ kind: option })} prefetch={false} scroll={false} aria-current={kind === option ? "true" : undefined} className={kind === option ? chipOnClass : chipOffClass}>
                  {KIND_TEXT[option].chip}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function DecadeLabel({ label, era, countText, size }: { label: string; era: string | null; countText: string; size: "aside" | "toggle" }) {
  return size === "aside" ? (
    <>
      <h2 className="font-display text-thanks font-extrabold leading-none text-jo-red">{label}</h2>
      {era && <p className="font-display text-[24px] font-bold leading-[1.25]">{era}</p>}
      <p className="text-small text-walnut-soft">{countText}</p>
    </>
  ) : (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="font-display text-h2-sm font-extrabold leading-none text-jo-red">{label}</span>
      {era && <span className="font-display text-[19px] font-bold leading-[1.25]">{era}</span>}
      <span className="text-small font-normal text-walnut-soft">{countText}</span>
    </span>
  );
}

function YearBlock({ year, countText, memories }: { year: number | null; countText: string; memories: PublicMemory[] }) {
  return (
    <div className="relative flex flex-col gap-3 sm:gap-4">
      <span className="absolute -left-[57px] top-2 hidden sm:block" aria-hidden="true">
        <SolidHeart size={30} />
      </span>
      {year !== null && (
        <h3 className="flex items-center gap-3 sm:gap-[14px]">
          <span className="inline-flex -rotate-2 rounded-full bg-jo-red px-[14px] py-[5px] font-display text-[22px] font-extrabold leading-none text-paper shadow-pill sm:px-4 sm:py-[6px] sm:text-[24px]">{year}</span>
          <span className="text-small font-normal text-walnut-soft">{countText}</span>
        </h3>
      )}
      <ul className="grid grid-cols-1 gap-[14px] sm:grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] sm:gap-5">
        {memories.map((memory, index) => (
          <MemoryCard key={memory.id} memory={memory} index={index} variant="timeline" />
        ))}
      </ul>
    </div>
  );
}

const threadClass = "flex flex-col gap-5 sm:relative sm:gap-7 sm:border-l-[3px] sm:border-dashed sm:border-jo-red sm:pl-10";

function decadeBody(decade: TimelineDecade) {
  if (decade.years.length === 0) {
    return (
      <div className={threadClass}>
        <p className="max-w-[36em] rounded-card border-[3px] border-dashed border-periwinkle bg-paper p-4 text-label font-normal text-walnut-soft sm:px-6 sm:py-5 sm:text-body">
          Nothing from these years yet. Were you there?{" "}
          <Link href={shareHref} className="text-jo-red-deep underline hover:text-walnut">
            Tell that Jo story
          </Link>
          .
        </p>
      </div>
    );
  }
  return (
    <div className={threadClass}>
      {decade.years.map((year) => (
        <YearBlock key={year.year} year={year.year} countText={year.countText} memories={year.memories} />
      ))}
    </div>
  );
}

function items(model: TimelineModel): TimelineDecadeItem[] {
  const decades = model.decades.map((decade) => ({
    id: decade.id,
    bodyId: decade.bodyId,
    aside: <DecadeLabel label={`${decade.decade}s`} era={decade.era} countText={decade.countText} size="aside" />,
    toggle: <DecadeLabel label={`${decade.decade}s`} era={decade.era} countText={decade.countText} size="toggle" />,
    body: decadeBody(decade),
  }));
  if (model.undated) {
    const undated = model.undated;
    decades.push({
      id: undated.id,
      bodyId: "b-undated",
      aside: <DecadeLabel label="Not dated yet" era={null} countText={undated.countText} size="aside" />,
      toggle: <DecadeLabel label="Not dated yet" era={null} countText={undated.countText} size="toggle" />,
      body: (
        <div className={threadClass}>
          <YearBlock year={null} countText={undated.countText} memories={undated.memories} />
        </div>
      ),
    });
  }
  return decades;
}

