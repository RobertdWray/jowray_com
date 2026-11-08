import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { listPublicMemories } from "@/features/memories/public";
import { buildMap, type MapModel } from "@/lib/memories/explore";
import { memoriesText } from "@/lib/memories/format";
import type { PlaceGroup } from "@/lib/memories/types";
import { parseMapQuery } from "@/lib/validations/public-memories";
import { getPublicMemoriesEnv } from "@/server/config/env";

import { OpeningSoon } from "../_components/bands";
import { bandClass, cardGridClass, eyebrowClass, h2Class, innerClass, linkButtonClass, paperBandClass, rowOffClass, rowOnClass } from "../_components/chips";
import { exploreHref, mapHref } from "../_components/hrefs";
import { MapZoom } from "../_components/map-zoom-client";
import { CompactCard, MemoryCard } from "../_components/memory-card";
import { hasHomePins, HomeInset, type MapPin, townOf, UsMap } from "../_components/us-map";
import { ViewNav } from "../_components/view-nav";

/** A map pin that still knows its place's year range, for the "Every place" rows. */
type PlacePin = MapPin & PlaceGroup;

export const metadata: Metadata = {
  title: "Memories by place — Jo Wray",
  description: "Where the Jo stories happened: every town someone remembers with her, most stories first.",
  robots: { index: false, follow: false },
};

export default function MapPage(props: PageProps<"/memories/map">) {
  return (
    <main className="flex flex-1 flex-col">
      <section aria-labelledby="map-h" className={`${bandClass} pb-4 pt-4 sm:pb-10 sm:pt-6`}>
        <div className={`${innerClass} flex flex-col gap-3 sm:gap-5`}>
          <p className={eyebrowClass}>Memories of Jo · by place</p>
          <h1 id="map-h" className="max-w-[14em] font-display text-display-sm font-extrabold sm:text-display">
            Where the stories happened
          </h1>
          <p className="max-w-[36em] text-label font-normal sm:hidden">Most Jo stories happened a short drive from Cockeysville, but the Army took her family all over when she was a girl.</p>
          <p className="hidden max-w-[36em] text-lead sm:block">
            Jo&rsquo;s father was an Army chaplain, so she grew up on posts from Washington State to Texas. She spent the rest of her life within a short drive of Cockeysville, which is
            why the map is lopsided.
          </p>
          <div className="pt-[6px]">
            <ViewNav current="map" />
          </div>
        </div>
      </section>
      <Suspense fallback={<p className={`${bandClass} py-8 text-body text-walnut-soft`}>Loading…</p>}>
        <MapContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function MapContent({ searchParams }: { searchParams: PageProps<"/memories/map">["searchParams"] }) {
  await connection();
  if (!getPublicMemoriesEnv().PUBLIC_MEMORIES_ENABLED) {
    return <OpeningSoon />;
  }
  const { place } = parseMapQuery(await searchParams);
  const model = buildMap(await listPublicMemories(), place);
  const pins: PlacePin[] = model.places.map((group) => ({ ...group, selected: group.slug === model.selected?.slug, href: mapHref(group.slug) }));
  const home = hasHomePins(pins);
  return (
    <>
      <section aria-label="Map of the memories" className={`${bandClass} pb-8 sm:pb-12`}>
        <div className={`${innerClass} flex flex-col gap-4`}>
          <p className="text-label font-normal sm:text-body">
            <strong>{memoriesText(model.total)}</strong> from <strong>{model.placeCount === 1 ? "1 place" : `${model.placeCount} places`}</strong> so far.
          </p>
          <div className="sm:hidden">
            <MapZoom home={<HomeInset pins={pins} caption="Maryland and the neighbors" className="rounded-card border-[3px] border-wood-light bg-paper shadow-card" />} us={<UsMap pins={pins} labels={false} />} />
          </div>
          {/* The board floats the inset over the map, where it covers pins and the caption (SPEC §8, defect 1); here it sits beside it. */}
          <div className="hidden gap-6 sm:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
            <UsMap pins={pins} />
            {home && (
              <div className="flex flex-col gap-2 rounded-card border-[3px] border-dashed border-periwinkle bg-paper px-4 pb-4 pt-[14px] shadow-card">
                <h2 className="font-display text-[21px] font-bold">Closer to home</h2>
                <p className="text-small text-walnut-soft">Maryland and the neighbors, up close</p>
                <HomeInset pins={pins} />
              </div>
            )}
          </div>
          <p className="max-w-[50em] text-small text-walnut-soft">
            <span className="sm:hidden">Bigger heart, more stories. Tap one.</span>
            <span className="hidden sm:inline">
              Each heart is a place someone remembers with Jo; the bigger the heart, the more stories. Tap a heart to read what happened there. A memory&rsquo;s exact address is never
              shown, only the town.
            </span>
          </p>
        </div>
      </section>
      <SelectedPlace model={model} />
      <EveryPlace model={model} pins={pins} />
    </>
  );
}

function SelectedPlace({ model }: { model: MapModel }) {
  const selected = model.selected;
  if (!selected) {
    return (
      <section className={`${bandClass} ${paperBandClass} pb-10 pt-8`}>
        <p className={`${innerClass} text-body text-walnut-soft`}>No memory says where it happened yet.</p>
      </section>
    );
  }
  const years = selected.firstYear !== null && selected.lastYear !== null ? (selected.firstYear === selected.lastYear ? `${selected.firstYear}` : `${selected.firstYear}–${selected.lastYear}`) : null;
  return (
    <section aria-labelledby="place-h" className={`${bandClass} ${paperBandClass} pb-8 pt-6 sm:pb-16 sm:pt-14`}>
      <div className={`${innerClass} flex flex-col gap-4 sm:gap-7`}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-[6px]">
            <p className={eyebrowClass}>{[memoriesText(selected.count), years].filter(Boolean).join(" · ")}</p>
            <h2 id="place-h" className="font-display text-h2-sm font-bold sm:text-h2">
              {selected.label}
            </h2>
            {selected.firstYear !== null && selected.lastYear !== null && selected.firstYear !== selected.lastYear && (
              <p className="hidden text-body text-walnut-soft sm:block">
                The earliest is from {selected.firstYear}, the latest from {selected.lastYear}.
              </p>
            )}
          </div>
          <Link href={exploreHref({ place: selected.slug })} className={`${linkButtonClass} hidden px-[22px] sm:inline-flex`}>
            See all {selected.count} in Everything
          </Link>
        </div>
        <ul className={`${cardGridClass} hidden sm:grid`}>
          {model.selectedMemories.map((memory, index) => (
            <MemoryCard key={memory.id} memory={memory} index={index} variant="map" />
          ))}
        </ul>
        <ul className="flex flex-col gap-4 sm:hidden">
          {model.selectedMemories.slice(0, 3).map((memory) => (
            <CompactCard key={memory.id} memory={memory} badgeSize={36} withPlace={false} />
          ))}
        </ul>
        {selected.count > 3 && (
          <Link href={exploreHref({ place: selected.slug })} className={`${linkButtonClass} w-full sm:hidden`}>
            See all {selected.count} from {townOf(selected.label)}
          </Link>
        )}
      </div>
    </section>
  );
}

function EveryPlace({ model, pins }: { model: MapModel; pins: PlacePin[] }) {
  if (pins.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby="every-h" className={`${bandClass} pb-10 pt-6 sm:pb-[72px] sm:pt-14`}>
      <div className={`${innerClass} flex flex-col gap-3 sm:gap-5`}>
        <h2 id="every-h" className={h2Class}>
          <span className="sm:hidden">Every place</span>
          <span className="hidden sm:inline">Every place, most stories first</span>
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-2 sm:gap-3">
          {pins.map((pin) => (
            <li key={pin.slug}>
              <Link href={pin.href} prefetch={false} scroll={false} aria-current={pin.selected ? "true" : undefined} className={`${pin.selected ? rowOnClass : rowOffClass} min-h-tap px-4 sm:min-h-18 sm:px-[18px] sm:py-[10px]`}>
                <span className="flex min-w-0 flex-1 flex-col text-left">
                  <span className="break-words">{pin.label}</span>
                  {pin.firstYear !== null && pin.lastYear !== null && (
                    <span className="hidden text-small font-normal opacity-90 sm:inline">{pin.firstYear === pin.lastYear ? pin.firstYear : `${pin.firstYear}–${pin.lastYear}`}</span>
                  )}
                </span>
                <span className="ml-auto font-display text-[24px] font-extrabold leading-none sm:text-[28px]" aria-label={memoriesText(pin.count)}>
                  {pin.count}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {model.unplacedCount > 0 && (
          <p className="text-small text-walnut-soft">
            {model.unplacedCount === 1 ? "1 memory doesn’t say where it happened." : `${model.unplacedCount} memories don’t say where they happened.`} They&rsquo;re in Everything and on the timeline.
          </p>
        )}
      </div>
    </section>
  );
}
