import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { listPublicMemories } from "@/features/memories/public";
import { buildExplore, type ExploreModel } from "@/lib/memories/explore";
import { memoriesText } from "@/lib/memories/format";
import { ERA_LINE } from "@/lib/memories/timeline";
import type { ExploreFilters } from "@/lib/memories/types";
import { parseExploreQuery } from "@/lib/validations/public-memories";
import { getPublicMemoriesEnv } from "@/server/config/env";

import { PrimaryLink } from "../_components/buttons";
import { StitchedHeart } from "../_components/hearts";
import { EmptyState, LoadMore, OpeningSoon, ShareBand } from "./_components/bands";
import { bandClass, cardGridClass, chipOffClass, chipOnClass, eyebrowClass, h2Class, innerClass, linkButtonClass, linkClass, paperBandClass, rowOffClass, rowOnClass } from "./_components/chips";
import { CountChip, DecadeBars } from "./_components/decade-bars";
import { exploreHref, mapHref, moreHref, shareHref, tagsHref, timelineHref, toggleHref } from "./_components/hrefs";
import { MemoryCard } from "./_components/memory-card";
import { SearchForm } from "./_components/search-form-client";
import { type MapPin, UsMap } from "./_components/us-map";
import { ViewNav } from "./_components/view-nav";

export const metadata: Metadata = {
  title: "See memories — Jo Wray",
  description: "Memories of Jo Wray from her students, church friends, neighbors and family, by place, by year and by what she loved.",
  robots: { index: false, follow: false },
};

/**
 * Three panes from 1920px (plan D10, the Main-XL board): filters on the left, results in the middle, the map on the
 * right. Below that the sections stack in reading order. The grid places each section; the DOM order never changes.
 */
const grid = `min-[120rem]:grid min-[120rem]:grid-cols-[minmax(300px,380px)_minmax(0,1fr)_minmax(360px,560px)] min-[120rem]:grid-rows-[auto_auto_auto_auto_auto_1fr_auto] min-[120rem]:items-start min-[120rem]:gap-x-6 min-[120rem]:px-10`;
const xlBand = `min-[120rem]:px-0`;
const xlInner = `min-[120rem]:max-w-none`;
const area = {
  top: `min-[120rem]:col-span-3 min-[120rem]:row-start-1`,
  stats: `min-[120rem]:col-span-3 min-[120rem]:row-start-2`,
  ways: `min-[120rem]:col-start-1 min-[120rem]:row-start-3`,
  where: `min-[120rem]:col-start-3 min-[120rem]:row-start-3 min-[120rem]:row-span-4`,
  when: `min-[120rem]:col-start-1 min-[120rem]:row-start-4`,
  what: `min-[120rem]:col-start-1 min-[120rem]:row-start-5`,
  results: `min-[120rem]:col-start-2 min-[120rem]:row-start-3 min-[120rem]:row-span-4`,
  share: `min-[120rem]:col-span-3 min-[120rem]:row-start-7`,
} as const;

export default function ExplorePage(props: PageProps<"/memories">) {
  return (
    <main className="flex flex-1 flex-col">
      <div className={`flex flex-col ${grid}`}>
        <section aria-labelledby="explore-h" className={`${bandClass} ${xlBand} ${area.top} pt-4 sm:pt-6`}>
          <div className={`${innerClass} ${xlInner} flex flex-col gap-3 sm:gap-5`}>
            <p className={eyebrowClass}>Memories of Jo</p>
            <h1 id="explore-h" className="font-display text-display-sm font-extrabold sm:text-display">
              Every <span className="text-jo-red">Jo</span> story, in one place.
            </h1>
          </div>
        </section>
        <Suspense fallback={<p className={`${bandClass} ${area.stats} py-8 text-body text-walnut-soft`}>Loading…</p>}>
          <ExploreContent searchParams={props.searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function ExploreContent({ searchParams }: { searchParams: PageProps<"/memories">["searchParams"] }) {
  // Request time first (AGENTS.md): nothing below may run in a prerender, and the flag is env.
  await connection();
  if (!getPublicMemoriesEnv().PUBLIC_MEMORIES_ENABLED) {
    return (
      <div className={area.stats}>
        <OpeningSoon />
      </div>
    );
  }
  const filters = parseExploreQuery(await searchParams);
  const model = buildExplore(await listPublicMemories(), filters);
  return (
    <>
      <HeroStats model={model} />
      <WaysToLook filters={filters} />
      <WhereSection model={model} filters={filters} />
      <WhenSection model={model} filters={filters} />
      <WhatSection model={model} filters={filters} />
      <Results model={model} filters={filters} />
      <div className={area.share}>
        <ShareBand />
      </div>
    </>
  );
}

function HeroStats({ model }: { model: ExploreModel }) {
  const { stats } = model;
  const span = stats.first !== null && stats.last !== null;
  const tiles = [
    { n: stats.total, label: stats.total === 1 ? "memory" : "memories", tilt: "-rotate-1", colour: "text-jo-red" },
    { n: stats.places, label: stats.places === 1 ? "place" : "places", tilt: "rotate-[0.8deg]", colour: "" },
    { n: stats.decades, label: stats.decades === 1 ? "decade" : "decades", tilt: "-rotate-[0.6deg]", colour: "" },
  ];
  return (
    <section aria-label="So far" className={`${bandClass} ${xlBand} ${area.stats} pb-5 pt-3 sm:pb-12 sm:pt-5`}>
      <div className={`${innerClass} ${xlInner} flex flex-wrap items-end gap-x-16 gap-y-8`}>
        <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-5">
          <p className="max-w-[34em] text-label font-normal sm:text-lead">
            <span className="sm:hidden">
              <strong>{memoriesText(stats.total)}</strong> from <strong>{stats.places === 1 ? "1 place" : `${stats.places} places`}</strong>
              {span ? `, ${stats.first} to ${stats.last}` : ""}. More arrive every day.
            </span>
            <span className="hidden sm:inline">
              So far her students, church friends, neighbors and family have left <strong>{memoriesText(stats.total)}</strong> from{" "}
              <strong>{stats.places === 1 ? "1 place" : `${stats.places} places`}</strong>
              {span && (
                <>
                  , stretching from <strong>{stats.first}</strong> to <strong>{stats.last}</strong>
                </>
              )}
              . Wander by place, by year or by what she loved. More arrive every day.
            </span>
          </p>
          <div className={`hidden flex-wrap items-center gap-4 sm:flex min-[120rem]:hidden`}>
            <PrimaryLink href={shareHref} className="min-w-0">
              <StitchedHeart size={26} color="#fff" />
              Leave a memory of Jo
            </PrimaryLink>
            <Link href={timelineHref()} className={`${linkButtonClass} min-h-tap-lg px-6 text-body`}>
              Start at the beginning
            </Link>
          </div>
        </div>
        <ul className={`hidden flex-[1_1_360px] grid-cols-3 gap-4 sm:grid min-[120rem]:hidden`}>
          {tiles.map((tile) => (
            <li key={tile.label} className={`flex flex-col gap-1 rounded-card border-[3px] border-wood-light bg-paper px-[18px] py-5 shadow-card ${tile.tilt}`}>
              <span className={`font-display text-[44px] font-extrabold leading-none ${tile.colour}`}>{tile.n}</span>
              <span className="text-small text-walnut-soft">{tile.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function WaysToLook({ filters }: { filters: ExploreFilters }) {
  return (
    <section aria-label="Ways to look" className={`${bandClass} ${area.ways} pb-5 sm:py-7 sm:border-y-[3px] sm:border-dashed sm:border-jo-red sm:bg-paper min-[120rem]:border-0 min-[120rem]:bg-transparent min-[120rem]:px-0 min-[120rem]:py-0`}>
      <div className={`${innerClass} ${xlInner} flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-8 sm:gap-y-5 min-[120rem]:flex-col min-[120rem]:items-stretch`}>
        <ViewNav current="explore" icons />
        <div className="flex min-w-0 flex-col gap-[6px] sm:max-w-[460px] sm:flex-[1_1_320px]">
          <SearchForm filters={filters} />
        </div>
      </div>
    </section>
  );
}

function WhereSection({ model, filters }: { model: ExploreModel; filters: ExploreFilters }) {
  const pins: MapPin[] = model.places.map((place) => ({ ...place, href: toggleHref(filters, "place", place.slug) }));
  const top = model.places.slice(0, 7);
  return (
    // Phones get the map on its own page ("By place"); the Phone · explore board draws none here.
    <section aria-labelledby="where-h" className={`${bandClass} ${xlBand} ${area.where} hidden pb-6 pt-14 sm:block min-[120rem]:pt-0`}>
      <div className={`${innerClass} ${xlInner} flex flex-wrap items-start gap-x-12 gap-y-8 min-[120rem]:flex-col min-[120rem]:gap-4`}>
        <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-[14px] self-stretch">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h2 id="where-h" className={h2Class}>
              Where the stories happened
            </h2>
            <Link href={filters.place ? mapHref(filters.place) : mapHref()} className={linkClass}>
              Open the big map
            </Link>
          </div>
          <UsMap pins={pins} />
          <p className="text-small text-walnut-soft">Each heart is a place someone remembers with Jo; the bigger the heart, the more stories. Tap one to keep only those.</p>
        </div>
        {top.length > 0 && (
          <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-3 self-stretch">
            <h3 className="font-display text-card-title font-bold">Most of them close to home</h3>
            <ul className="flex flex-col gap-2">
              {top.map((place) => (
                <li key={place.slug}>
                  <Link href={toggleHref(filters, "place", place.slug)} prefetch={false} scroll={false} aria-current={place.selected ? "true" : undefined} className={`${place.selected ? rowOnClass : rowOffClass} min-h-tap px-[18px]`}>
                    <span className="min-w-0 flex-1 text-left">{place.label}</span>
                    <span className="text-small font-normal opacity-90">{memoriesText(place.count)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function WhenSection({ model, filters }: { model: ExploreModel; filters: ExploreFilters }) {
  const max = Math.max(1, ...model.decades.map((d) => d.count));
  return (
    <section aria-labelledby="when-h" className={`${bandClass} ${xlBand} ${area.when} border-t-[3px] border-dashed border-jo-red bg-paper py-5 sm:border-0 sm:bg-transparent sm:pb-6 sm:pt-8 min-[120rem]:pt-5`}>
      <div className={`${innerClass} ${xlInner} flex flex-col gap-3 sm:gap-4`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 id="when-h" className={h2Class}>
            When
          </h2>
          <Link href={timelineHref(filters.kind ? { kind: filters.kind } : undefined)} className={linkClass}>
            <span className="sm:hidden">Whole timeline</span>
            <span className="hidden sm:inline">Walk the whole timeline</span>
          </Link>
        </div>
        <DecadeBars variant="filter" max={max} bars={model.decades.map((d) => ({ ...d, href: toggleHref(filters, "decade", d.decade) }))} />
        <p className="text-small text-walnut-soft sm:hidden">{filters.decade ? `Showing the ${filters.decade}s. Tap it again for every year.` : "Tap a decade to keep only those years."}</p>
        <ol className="hidden flex-wrap gap-x-[22px] gap-y-[6px] px-2 text-small text-walnut-soft sm:flex">
          {ERA_LINE.map((era) => (
            <li key={era.range}>
              <strong className="text-jo-red-deep">{era.range}</strong> {era.text}
            </li>
          ))}
        </ol>
        {model.undatedCount > 0 && <p className="text-small text-walnut-soft">{memoriesText(model.undatedCount)} not dated yet; they are on the timeline under &ldquo;Not dated yet&rdquo;.</p>}
      </div>
    </section>
  );
}

function WhatSection({ model, filters }: { model: ExploreModel; filters: ExploreFilters }) {
  return (
    <section aria-labelledby="what-h" className={`${bandClass} ${xlBand} ${area.what} py-5 sm:pb-10 sm:pt-8`}>
      <div className={`${innerClass} ${xlInner} flex flex-col gap-3 sm:gap-4`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 id="what-h" className={h2Class}>
            What she loved
          </h2>
          <Link href={tagsHref()} className={linkClass}>
            <span className="sm:hidden">All patches</span>
            <span className="hidden sm:inline">See every tag</span>
          </Link>
        </div>
        {model.topTags.length > 0 && (
          <ul className="-mx-[max(16px,5%)] flex gap-2 overflow-x-auto px-[max(16px,5%)] pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:gap-[10px] sm:overflow-visible sm:px-0">
            {model.topTags.map((tag) => (
              <li key={tag.slug} className="flex-none">
                <CountChip href={toggleHref(filters, "tag", tag.slug)} label={tag.name} count={tag.count} selected={tag.selected} className={tag.selected ? chipOnClass : chipOffClass} />
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2 sm:gap-[10px]">
          <span className="mr-[6px] hidden text-label font-bold sm:inline" id="kind-label">
            Kind:
          </span>
          <ul aria-labelledby="kind-label" className="flex flex-wrap gap-2 sm:gap-[10px]">
            {model.kinds.map((kind) => (
              <li key={kind.kind}>
                <CountChip href={toggleHref(filters, "kind", kind.kind)} label={kind.label} count={kind.count} selected={kind.selected} className={kind.selected ? chipOnClass : chipOffClass} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Results({ model, filters }: { model: ExploreModel; filters: ExploreFilters }) {
  return (
    <section aria-labelledby="list-h" className={`${bandClass} ${area.results} ${paperBandClass} pb-8 pt-6 sm:pb-16 sm:pt-14 min-[120rem]:rounded-card min-[120rem]:border-[3px] min-[120rem]:border-wood-light min-[120rem]:px-6 min-[120rem]:pt-6`}>
      <div className={`${innerClass} ${xlInner} flex flex-col gap-5 sm:gap-7`}>
        <div className="flex flex-col gap-[10px] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-6 sm:gap-y-3">
          <h2 id="list-h" className={h2Class}>
            {model.summary}
          </h2>
          {model.hasFilters && (
            <Link href={exploreHref({})} scroll={false} className={`${linkButtonClass} min-h-12 self-start px-4 text-small sm:min-h-tap sm:self-auto sm:px-5 sm:text-label`}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" className="hidden text-jo-red-deep sm:block">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
              Show everything again
            </Link>
          )}
        </div>
        {model.total === 0 ? (
          <EmptyState />
        ) : (
          <ul className={cardGridClass}>
            {model.shown.map((memory, index) => (
              <MemoryCard key={memory.id} memory={memory} index={index} variant="explore" selectedTag={filters.tag} />
            ))}
          </ul>
        )}
        {model.nextN !== null && <LoadMore href={moreHref(filters, model.nextN)} more={model.moreCount} total={model.total} />}
      </div>
    </section>
  );
}

