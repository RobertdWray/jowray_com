import Link from "next/link";

import { durationText, fakeBars, KIND_TEXT } from "@/lib/memories/format";
import type { PublicKind, PublicMemory } from "@/lib/memories/types";

import { cardClass, cardTagClass, cardTagOnClass } from "./chips";
import { memoryHref, publicMediaHref } from "./hrefs";
import { FallbackImage } from "./image-fallback-client";
import { PhotoIcon } from "./photo-icon";

export type CardVariant = "explore" | "map" | "timeline" | "tags";

const PLACEHOLDER_FILLS = ["bg-muslin", "bg-wood-light", "bg-[#efe4d2]"] as const;

/** The red stitched play badge (design/reference/badge-play.svg). */
export function PlayBadge({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#c8102e" />
      <circle cx="12" cy="12" r="8.6" stroke="#fffdf8" strokeWidth="1.1" strokeDasharray="1.8 1.6" />
      <path d="M9.6 7.8v8.4l6.6-4.2z" fill="#fffdf8" />
    </svg>
  );
}

/** The kind badge on compact cards: a red stitched circle with the kind's glyph. */
export function KindBadge({ kind, size = 44 }: { kind: PublicKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="flex-none">
      <circle cx="12" cy="12" r="11" fill="#c8102e" />
      <circle cx="12" cy="12" r="8.6" stroke="#fffdf8" strokeWidth="1.1" strokeDasharray="1.8 1.6" />
      {kind === "PHOTO" && (
        <g stroke="#fffdf8" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="7.5" y="8.5" width="9" height="7" rx="1" />
          <circle cx="10.5" cy="11" r="1" fill="#fffdf8" />
          <path d="M16.5 14l-2.5-2.5-4 4" />
        </g>
      )}
      {kind === "VOICE" && (
        <g stroke="#fffdf8" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="10.5" y="7" width="3" height="6" rx="1.5" />
          <path d="M8.5 11.5a3.5 3.5 0 0 0 7 0M12 15v2" />
        </g>
      )}
      {kind === "VIDEO" && <path d="M9.6 7.8v8.4l6.6-4.2z" fill="#fffdf8" />}
      {kind === "TEXT" && <path d="M8 16l1.5-.5 6-6-1-1-6 6L8 16zM13.5 9.5l1 1" stroke="#fffdf8" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

function meta(memory: PublicMemory, withPlace: boolean, placeFallback: string | null): string {
  const place = withPlace ? (memory.place?.label ?? placeFallback) : null;
  return [memory.relationship, memory.when, place].filter(Boolean).join(" · ");
}

function cardLabel(memory: PublicMemory): string {
  return memory.when ? `Open the memory from ${memory.who}, ${memory.when}` : `Open the memory from ${memory.who}`;
}

function PhotoSlot({ memory, index }: { memory: PublicMemory; index: number }) {
  const photo = memory.photos[0];
  const count = memory.photos.length;
  return (
    <div className={`rounded-[6px] p-2 shadow-photo patchwork-sm ${index % 2 === 0 ? "-rotate-[1.2deg]" : "rotate-[1.2deg]"}`}>
      <div className="rounded-[3px] bg-paper p-2 pb-[10px]">
        <div className={`relative grid aspect-[4/3] place-items-center overflow-hidden rounded-[3px] ${PLACEHOLDER_FILLS[index % 3]}`}>
          <div className="flex flex-col items-center gap-1 text-center">
            <PhotoIcon size={44} />
            <span className="text-small font-bold text-walnut-soft">{count === 1 ? "1 photo" : count > 1 ? `${count} photos` : "Photo on its way"}</span>
          </div>
          {photo && <FallbackImage src={publicMediaHref(photo.id, "thumb")} alt="" fill unoptimized className="object-cover" />}
          {count > 1 && <span className="absolute bottom-2 right-2 rounded-full bg-walnut px-3 py-0.5 text-small font-bold text-paper">{count} photos</span>}
        </div>
      </div>
    </div>
  );
}

function VoiceSlot({ memory }: { memory: PublicMemory }) {
  const length = durationText(memory.durationSeconds);
  return (
    <div className="flex items-center gap-3 rounded-[16px] border-[3px] border-dashed border-periwinkle bg-muslin p-3 sm:gap-[14px] sm:p-[14px]" aria-hidden="true">
      <span className="grid size-14 flex-none place-items-center rounded-full bg-periwinkle-deep shadow-[0_4px_0_#26406a]">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
      </span>
      <span className="flex h-12 min-w-0 flex-1 items-center gap-[3px] overflow-hidden">
        {fakeBars(memory.id, 24).map((height, i) => (
          <span key={i} className="w-1 flex-none rounded-[2px] bg-periwinkle" style={{ height }} />
        ))}
      </span>
      {length && <span className="flex-none text-small font-bold text-walnut-soft">{length}</span>}
    </div>
  );
}

/**
 * A video memory's picture: the server-made poster as a decorative fill image over the dashed slot ([C27]). The fill
 * image is absolutely positioned, so the badge and the pill sit in positioned `z-[1]` layers to stay above it. With no
 * poster yet, or once the image fails (FallbackImage then renders nothing), the slot looks as it did before posters.
 */
export function VideoSlot({ memory }: { memory: PublicMemory }) {
  const length = durationText(memory.durationSeconds);
  return (
    <div className="relative grid aspect-video place-items-center overflow-hidden rounded-[16px] border-[3px] border-dashed border-wood bg-wood-light" aria-hidden="true">
      {memory.poster && <FallbackImage src={publicMediaHref(memory.poster.mediaId, "thumb")} alt="" fill unoptimized className="object-cover" />}
      <span className="relative z-[1] flex">
        <PlayBadge size={64} />
      </span>
      {length && <span className="absolute bottom-[10px] right-3 z-[1] rounded-full bg-jo-red px-3 py-1 text-small font-bold text-paper shadow-pill">{length}</span>}
    </div>
  );
}

/**
 * One memory as a card (plan "Pages and components", SPEC §2.6): the whole card links to the memory page without
 * prefetching (C5). Media are pictures only; nothing plays on a card. Patches are labels here, not links (a link
 * cannot hold another link).
 */
export function MemoryCard({ memory, index, variant = "explore", selectedTag }: { memory: PublicMemory; index: number; variant?: CardVariant; selectedTag?: string }) {
  const tagLimit = variant === "explore" ? 2 : variant === "tags" ? 3 : 0;
  const tags = memory.tags.slice(0, tagLimit);
  const withPlace = variant !== "map";
  return (
    <li className="flex min-w-0">
      <Link href={memoryHref(memory.id)} prefetch={false} aria-label={cardLabel(memory)} className={`${cardClass} ${variant === "timeline" ? "gap-[14px] p-[18px]" : ""}`}>
        {memory.kind === "PHOTO" && <PhotoSlot memory={memory} index={index} />}
        {memory.kind === "VOICE" && <VoiceSlot memory={memory} />}
        {memory.kind === "VIDEO" && <VideoSlot memory={memory} />}
        {memory.kind === "TEXT" ? (
          memory.note && <p className="font-display text-[23px] font-medium leading-[1.35] line-clamp-6 sm:text-[24px] sm:line-clamp-7">&ldquo;{memory.note}&rdquo;</p>
        ) : (
          memory.note && <p className="text-label font-normal leading-[1.5] line-clamp-3">{memory.note}</p>
        )}
        <div className="mt-auto flex flex-col gap-0.5">
          <p className="font-display text-[21px] font-bold leading-[1.2]">{memory.who}</p>
          <p className="text-small leading-[1.45] text-walnut-soft">{meta(memory, withPlace, variant === "explore" ? "place not given" : null)}</p>
        </div>
        {tags.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Patches">
            {tags.map((tag) => (
              <li key={tag.slug} className={tag.slug === selectedTag ? cardTagOnClass : cardTagClass}>
                {tag.name}
              </li>
            ))}
          </ul>
        )}
      </Link>
    </li>
  );
}

/** "Close to this one" and the phone map's short list: kind badge, words, who. */
export function CompactCard({ memory, badgeSize = 44, withPlace = true }: { memory: PublicMemory; badgeSize?: number; withPlace?: boolean }) {
  return (
    <li className="flex min-w-0">
      <Link href={memoryHref(memory.id)} prefetch={false} aria-label={cardLabel(memory)} className={`${cardClass} gap-3 p-4 sm:p-5`}>
        <div className="flex items-center gap-3">
          <KindBadge kind={memory.kind} size={badgeSize} />
          <span className="text-small font-bold text-walnut-soft">{KIND_TEXT[memory.kind].badge}</span>
        </div>
        {memory.note && <p className="text-label font-normal leading-[1.5] line-clamp-4">{memory.note}</p>}
        <div className="mt-auto flex flex-col gap-0.5">
          <p className="font-display text-[21px] font-bold leading-[1.2]">{memory.who}</p>
          <p className="text-small leading-[1.45] text-walnut-soft">{meta(memory, withPlace, null)}</p>
        </div>
      </Link>
    </li>
  );
}
