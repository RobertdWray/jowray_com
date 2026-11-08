import "server-only";

import { cache } from "react";

import { LIVE_MEDIA_ORDER } from "@/features/memories/media-state";
import type { Prisma } from "@/generated/prisma/client";
import { isStagingKey } from "@/lib/derived-keys";
import { memoryTypeFor } from "@/lib/media-types";
import { displayYear } from "@/lib/memories/approx-year";
import { roundPoint, toPublicPlace } from "@/lib/memories/places";
import { publicPlayability } from "@/lib/memories/playability";
import { PUBLIC_MEMORY_RULE } from "@/lib/memories/public-rule";
import { toPublicTags } from "@/lib/memories/tags";
import type { Playable, PublicMediaItem, PublicMediaKind, PublicMemory, PublicMemoryDetail, PublicPhoto, PublicPoster } from "@/lib/memories/types";
import { parseMemoryId } from "@/lib/validations/public-memories";
import { getDb } from "@/server/db/client";

/**
 * What "public" means on See memories (plan docs/plans/2026-11-08-see-memories.md, D1), as the Prisma `where` built
 * from the one rule in `lib/memories/public-rule.ts` (debt catalogue rule M-E-14): the family approved it, the
 * contributor chose "Everyone", and it is not deleted. DRAFT, PENDING, HIDDEN, FAMILY, PRIVATE and deleted rows never
 * match. This module is its only reader; the media route checks a loaded row with the same rule's `isPublicMemory`
 * (`features/media/serve-media.ts`, caller `public`).
 */
export const PUBLIC_MEMORY_WHERE = PUBLIC_MEMORY_RULE satisfies Prisma.MemoryWhereInput;

const FRIEND = "A friend of Jo's";

/**
 * The only columns the public pages may see. Explicit `select` keeps private columns out by construction: no
 * email, claim token hash, blob URL, EXIF, file name or original storage key. A derived copy's storage key is read
 * only to refuse a staged one (as the media route does) and never leaves this module. The memory's coordinates are
 * read only to round its town point (D2) and never leave unrounded; where a file was recorded is not read at all,
 * since playability no longer depends on it (D16 as amended by Rob on 2026-11-08).
 */
const PUBLIC_SELECT = {
  id: true,
  type: true,
  contributorNote: true,
  approxDateText: true,
  approxYear: true,
  approxMonth: true,
  place: true,
  latitude: true,
  longitude: true,
  tags: true,
  createdAt: true,
  contributor: { select: { name: true, relationship: true } },
  media: {
    where: { deletedAt: null, purgedAt: null, status: "READY" },
    select: {
      id: true,
      mimeType: true,
      durationSeconds: true,
      width: true,
      height: true,
      caption: true,
      sortOrder: true,
      derivatives: { where: { status: "READY" }, select: { kind: true, width: true, height: true, storageKey: true } },
    },
    orderBy: [...LIVE_MEDIA_ORDER],
  },
} satisfies Prisma.MemorySelect;

type MemoryRow = Prisma.MemoryGetPayload<{ select: typeof PUBLIC_SELECT }>;
type MediaRow = MemoryRow["media"][number];

function words(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/** A READY derived copy the media route would serve: never one on a browser-staged key (as `serve-media` refuses). */
function servedCopy(media: MediaRow, kind: "WEB_IMAGE" | "THUMBNAIL" | "POSTER") {
  return media.derivatives.find((d) => d.kind === kind && !isStagingKey(d.storageKey)) ?? null;
}

/**
 * The copy `?v=thumb` serves for a file of this kind (`features/media/serve-media.ts`): a photo's THUMBNAIL, a
 * video's POSTER (D7: never the video itself). A recording has none.
 */
const THUMB_COPY: Record<PublicMediaKind, "THUMBNAIL" | "POSTER" | null> = { PHOTO: "THUMBNAIL", VIDEO: "POSTER", VOICE: null };

function toMediaItem(media: MediaRow): PublicMediaItem {
  const web = servedCopy(media, "WEB_IMAGE");
  const kind = memoryTypeFor(media.mimeType);
  const thumbCopy = THUMB_COPY[kind];
  return {
    id: media.id,
    kind,
    mimeType: media.mimeType,
    caption: words(media.caption),
    durationSeconds: media.durationSeconds,
    width: kind === "PHOTO" && web ? web.width : media.width,
    height: kind === "PHOTO" && web ? web.height : media.height,
    hasThumb: thumbCopy !== null && servedCopy(media, thumbCopy) !== null,
    playable: publicPlayability({ mimeType: media.mimeType, webCopyReady: web !== null }),
  };
}

/** The card's picture for a video: the first video with a served POSTER, sized from that copy (not the original). */
function posterOf(media: MediaRow[]): PublicPoster | null {
  for (const file of media) {
    const copy = memoryTypeFor(file.mimeType) === "VIDEO" ? servedCopy(file, "POSTER") : null;
    if (copy) {
      return { mediaId: file.id, width: copy.width, height: copy.height };
    }
  }
  return null;
}

function toPublicMemory(row: MemoryRow, items: PublicMediaItem[]): PublicMemory {
  const who = words(row.contributor?.name) ?? FRIEND;
  const year = displayYear({ approxYear: row.approxYear, approxDateText: row.approxDateText });
  const photos: PublicPhoto[] = items
    .filter((item) => item.kind === "PHOTO" && item.playable === "yes")
    .map((item) => ({ id: item.id, width: item.width, height: item.height, alt: item.caption ?? `A photo from ${who}'s memory` }));
  const recording = items.find((item) => item.kind === "VOICE" || item.kind === "VIDEO") ?? null;
  const playable: Playable = recording?.playable ?? "yes";
  return {
    id: row.id,
    kind: row.type,
    who,
    relationship: words(row.contributor?.relationship),
    note: words(row.contributorNote),
    when: words(row.approxDateText),
    year,
    // A month means something only with the family's own year (the admin form refuses one without it).
    month: row.approxYear !== null ? row.approxMonth : null,
    place: toPublicPlace(row.place),
    point: roundPoint(row.latitude, row.longitude),
    tags: toPublicTags(row.tags),
    durationSeconds: recording?.durationSeconds ?? null,
    photos,
    poster: posterOf(row.media),
    playable,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Every public memory, newest first by when it arrived (the pages sort by year themselves). One read per request:
 * `cache` shares it between the page and anything else that asks during the same render, and is cleared for the
 * next request, so nothing is cached across visitors (plan D11).
 */
export const listPublicMemories = cache(async (): Promise<PublicMemory[]> => {
  const rows = await getDb().memory.findMany({
    where: PUBLIC_MEMORY_WHERE,
    select: PUBLIC_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map((row) => toPublicMemory(row, row.media.map(toMediaItem)));
});

/**
 * One public memory with every live file, or null when the id is not a UUID or the memory is not public. Shared by
 * `generateMetadata` and the page within one request through `cache`.
 */
export const getPublicMemory = cache(async (rawId: string): Promise<PublicMemoryDetail | null> => {
  const id = parseMemoryId(rawId);
  if (id === null) {
    return null;
  }
  const row = await getDb().memory.findFirst({ where: { id, ...PUBLIC_MEMORY_WHERE }, select: PUBLIC_SELECT });
  if (!row) {
    return null;
  }
  const media = row.media.map(toMediaItem);
  return { ...toPublicMemory(row, media), media };
});
