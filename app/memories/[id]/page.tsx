import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getPublicMemory, listPublicMemories } from "@/features/memories/public";
import { FAMILY_CONTACT_EMAIL } from "@/lib/contact";
import { fakeBars, KIND_TEXT } from "@/lib/memories/format";
import { nearby, photoPill, placeCount, prevNext, threadOrder } from "@/lib/memories/related";
import type { PublicMediaItem, PublicMemory, PublicMemoryDetail } from "@/lib/memories/types";
import { tagIds } from "@/lib/sentry/user";
import { getPublicMemoriesEnv } from "@/server/config/env";

import { PrimaryLink } from "../../_components/buttons";
import { StitchedHeart } from "../../_components/hearts";
import { AudioPlayer } from "../_components/audio-player-client";
import { OpeningSoon } from "../_components/bands";
import { bandClass, cardGridClass, eyebrowClass, h2Class, innerClass, paperBandClass } from "../_components/chips";
import { exploreHref, mapHref, memoryHref, publicMediaHref, shareHref, tagsHref } from "../_components/hrefs";
import { CompactCard } from "../_components/memory-card";
import { PhotoFigure } from "../_components/photo-figure-client";
import { townOf } from "../_components/us-map";
import { VideoPlayer } from "../_components/video-player";

const NOINDEX = { index: false, follow: false } as const;

/**
 * The memory's own title (plan C9, C39): metadata defers to request time with the page body, reads the same memory
 * through React `cache` (C36), and never names anyone for a memory that is not public.
 */
export async function generateMetadata(props: PageProps<"/memories/[id]">): Promise<Metadata> {
  await connection();
  const generic = { title: "A memory of Jo — Jo Wray", robots: NOINDEX };
  if (!getPublicMemoriesEnv().PUBLIC_MEMORIES_ENABLED) {
    return generic;
  }
  const { id } = await props.params;
  const memory = await getPublicMemory(id);
  if (!memory) {
    return generic;
  }
  return {
    title: `A memory from ${memory.who} — Jo Wray`,
    ...(memory.note && { description: memory.note.length > 160 ? `${memory.note.slice(0, 159)}…` : memory.note }),
    robots: NOINDEX,
  };
}

export default function MemoryPage(props: PageProps<"/memories/[id]">) {
  return (
    <main className="flex flex-1 flex-col">
      <Suspense fallback={<p className={`${bandClass} py-8 text-body text-walnut-soft`}>Loading…</p>}>
        <MemoryContent params={props.params} />
      </Suspense>
    </main>
  );
}

async function MemoryContent({ params }: { params: PageProps<"/memories/[id]">["params"] }) {
  await connection();
  if (!getPublicMemoriesEnv().PUBLIC_MEMORIES_ENABLED) {
    return (
      <div className="pt-6">
        <OpeningSoon />
      </div>
    );
  }
  const { id } = await params;
  const memory = await getPublicMemory(id);
  if (!memory) {
    // Not public (or not there): the not-found UI with noindex. The shell has streamed, so the status stays 200 (D13, C10).
    notFound();
  }
  tagIds({ memoryId: memory.id });
  const all = await listPublicMemories();
  const thread = threadOrder(all);
  const position = prevNext(thread, memory.id);
  const close = nearby(all, memory, 3);
  const others = memory.place ? placeCount(all, memory.place.slug) - 1 : 0;
  return (
    <>
      <nav aria-label="Where you are" className={`${bandClass} pb-4 pt-2 sm:pb-6`}>
        <div className={`${innerClass} flex flex-wrap items-center justify-between gap-x-6 gap-y-3`}>
          <Link href={exploreHref({})} className="inline-flex min-h-11 items-center gap-[10px] text-small font-bold text-walnut no-underline sm:text-label">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-jo-red-deep">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            All the memories
          </Link>
          {position && (
            <p className="text-small text-walnut-soft">
              <span className="sm:hidden">
                {position.index + 1} of {position.total}
              </span>
              <span className="hidden sm:inline">
                Memory {position.index + 1} of {position.total} on the thread
              </span>
            </p>
          )}
        </div>
      </nav>
      <article aria-labelledby="who" className={`${bandClass} pb-6 sm:pb-16`}>
        <div className={`${innerClass} flex flex-wrap items-start gap-x-16 gap-y-8 sm:gap-y-12`}>
          <MediaColumn memory={memory} />
          <Details memory={memory} others={others} />
        </div>
      </article>
      <EarlierLater prev={position?.prev ?? null} next={position?.next ?? null} />
      {close.length > 0 && (
        <section aria-labelledby="near-h" className={`${bandClass} ${paperBandClass} pb-8 pt-6 sm:pb-[72px] sm:pt-14`}>
          <div className={`${innerClass} flex flex-col gap-4 sm:gap-6`}>
            <div className="flex flex-col gap-1">
              <h2 id="near-h" className={h2Class}>
                Close to this one
              </h2>
              <p className="hidden text-body text-walnut-soft sm:block">Same town, same stretch of years, or the same patches.</p>
            </div>
            <ul className={cardGridClass}>
              {close.map((other) => (
                <CompactCard key={other.id} memory={other} />
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}

const WAITING = "This recording will play once the family's copy is ready.";

function Waiting({ kind }: { kind: "VOICE" | "VIDEO" }) {
  return (
    <p className="rounded-card border-[3px] border-dashed border-periwinkle bg-paper p-5 text-body text-walnut-soft">
      {kind === "VIDEO" ? "This video will play once the family's copy is ready." : WAITING}
    </p>
  );
}

function Player({ item, memory }: { item: PublicMediaItem; memory: PublicMemoryDetail }) {
  if (item.kind === "PHOTO") {
    return null;
  }
  if (item.playable !== "yes") {
    return <Waiting kind={item.kind} />;
  }
  // Both players use `preload="none"` (plan D6 as amended, C34): none of the file loads until the visitor presses play.
  // A video's poster, its small server-made JPEG, is the only request before that (video posters T11).
  if (item.kind === "VOICE") {
    return <AudioPlayer src={publicMediaHref(item.id, "web")} durationSeconds={item.durationSeconds} bars={fakeBars(`${memory.id}:${item.id}`, 40, 56, 10)} />;
  }
  return <VideoPlayer item={item} />;
}

function MediaColumn({ memory }: { memory: PublicMemoryDetail }) {
  const photos = memory.media.filter((item) => item.kind === "PHOTO" && item.playable === "yes");
  const players = memory.media.filter((item) => item.kind !== "PHOTO");
  if (photos.length === 0 && players.length === 0) {
    return null;
  }
  return (
    <div className="flex min-w-0 max-w-[600px] flex-[1_1_440px] flex-col items-center gap-6">
      {photos.length > 0 && (
        <PhotoFigure
          photos={photos.map((item) => ({ id: item.id, width: item.width, height: item.height, alt: item.caption ?? `A photo from ${memory.who}'s memory`, caption: item.caption }))}
          pill={photoPill(memory)}
        />
      )}
      {players.map((item) => (
        <div key={item.id} className="w-full">
          <Player item={item} memory={memory} />
        </div>
      ))}
    </div>
  );
}

function Details({ memory, others }: { memory: PublicMemoryDetail; others: number }) {
  return (
    <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-5 sm:gap-6">
      <div className="flex flex-col gap-[6px] sm:gap-2">
        <p className={eyebrowClass}>{KIND_TEXT[memory.kind].eyebrow}</p>
        <h1 id="who" className="break-words font-display text-[36px] font-extrabold leading-[1.05] tracking-[-0.015em] sm:text-h2">
          {memory.who}
        </h1>
        {memory.relationship && <p className="text-label font-normal text-walnut-soft sm:text-lead">{memory.relationship}</p>}
      </div>
      {memory.note && (
        <blockquote className="rounded-card border-[3px] border-dashed border-periwinkle bg-paper px-5 py-5 shadow-card sm:px-7 sm:py-6">
          <p className="whitespace-pre-wrap break-words font-display text-[24px] font-medium leading-[1.4] sm:text-[26px]">{memory.note}</p>
        </blockquote>
      )}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] sm:gap-x-6 sm:gap-y-4">
        <div className="flex min-w-0 flex-col gap-0.5 rounded-card border-[3px] border-wood-light bg-paper p-[14px] sm:gap-1 sm:px-[18px] sm:py-4">
          <dt className="text-small font-bold uppercase tracking-[0.08em] text-walnut-soft">When</dt>
          <dd className="break-words font-display text-[21px] font-bold leading-[1.2] sm:text-[24px]">{memory.when ?? (memory.year !== null ? String(memory.year) : "Not given")}</dd>
          {memory.when && <dd className="hidden text-small text-walnut-soft sm:block">as they remembered it</dd>}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 rounded-card border-[3px] border-wood-light bg-paper p-[14px] sm:gap-1 sm:px-[18px] sm:py-4">
          <dt className="text-small font-bold uppercase tracking-[0.08em] text-walnut-soft">Where</dt>
          <dd className="break-words font-display text-[21px] font-bold leading-[1.2] sm:text-[24px]">{memory.place?.label ?? "Not given"}</dd>
          <dd className="hidden text-small sm:block">
            <Link href={memory.place ? mapHref(memory.place.slug) : mapHref()} className="font-bold text-jo-red-deep underline hover:text-walnut">
              {memory.place && others > 0 ? `${others} more from ${townOf(memory.place.label)}` : "See the map"}
            </Link>
          </dd>
        </div>
      </dl>
      {memory.tags.length > 0 && (
        <div className="flex flex-col gap-[10px]">
          <h2 className="text-small font-bold sm:text-label" id="patches-h">
            Patches on this one
          </h2>
          <ul aria-labelledby="patches-h" className="flex flex-wrap gap-2">
            {memory.tags.map((tag) => (
              <li key={tag.slug}>
                <Link href={tagsHref(tag.slug)} className="inline-flex min-h-11 items-center rounded-full border-[3px] border-dashed border-periwinkle bg-paper px-4 text-small font-bold text-walnut no-underline sm:text-label">
                  {tag.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 pt-2">
        <PrimaryLink href={shareHref} className="w-full min-w-0 sm:w-auto">
          <StitchedHeart size={26} color="#fff" />
          This reminds me of a Jo story
        </PrimaryLink>
        <a
          href={`mailto:${FAMILY_CONTACT_EMAIL}?subject=${encodeURIComponent("About a memory on See memories")}&body=${encodeURIComponent(`About ${memoryHref(memory.id)}:\n\n`)}`}
          className="text-label font-bold text-jo-red-deep underline hover:text-walnut"
        >
          Something wrong here? Tell the family
        </a>
      </div>
    </div>
  );
}

function neighbourText(memory: PublicMemory): string {
  return [memory.when ?? (memory.year !== null ? String(memory.year) : null), memory.who].filter(Boolean).join(" · ");
}

function EarlierLater({ prev, next }: { prev: PublicMemory | null; next: PublicMemory | null }) {
  const box =
    "flex min-h-tap-lg min-w-0 flex-1 items-center gap-[10px] rounded-button border-[3px] border-wood-light bg-paper px-[14px] py-2 text-walnut no-underline sm:min-h-18 sm:flex-[1_1_300px] sm:gap-[14px] sm:border-dashed sm:border-wood sm:px-5 sm:py-3";
  return (
    <nav aria-label="Earlier and later" className={`${bandClass} pb-6 sm:pb-14`}>
      <div className={`${innerClass} flex gap-[10px] sm:flex-wrap sm:justify-between sm:gap-4`}>
        {prev ? (
          <Link href={memoryHref(prev.id)} className={box}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="hidden flex-none text-jo-red-deep sm:block">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            <span className="flex min-w-0 flex-col overflow-hidden">
              <span className="text-small text-walnut-soft">
                <span className="sm:hidden">Earlier</span>
                <span className="hidden sm:inline">Earlier on the thread</span>
              </span>
              <span className="truncate text-small font-bold sm:text-label">{neighbourText(prev)}</span>
            </span>
          </Link>
        ) : (
          <p className={`${box} text-small text-walnut-soft`}>This is the first one</p>
        )}
        {next ? (
          <Link href={memoryHref(next.id)} className={`${box} justify-end text-right`}>
            <span className="flex min-w-0 flex-col items-end overflow-hidden">
              <span className="text-small text-walnut-soft">
                <span className="sm:hidden">Later</span>
                <span className="hidden sm:inline">Later on the thread</span>
              </span>
              <span className="max-w-full truncate text-small font-bold sm:text-label">{neighbourText(next)}</span>
            </span>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="hidden flex-none text-jo-red-deep sm:block">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        ) : (
          <p className={`${box} justify-end text-right text-small text-walnut-soft`}>Nothing later yet</p>
        )}
      </div>
    </nav>
  );
}

