/**
 * The public read model for See memories (docs/plans/2026-11-08-see-memories.md, D1, D6, D16 as amended).
 *
 * Plain, serializable data: these objects are rendered on public pages and
 * passed into Client Components, so they never carry an email, a claim token
 * hash, a blob URL, a storage key or an unrounded coordinate. Only
 * `features/memories/public.ts` builds them, from rows that match
 * `PUBLIC_MEMORY_WHERE`; everything in `lib/memories/*` is pure and works on
 * these shapes.
 */

/** `Memory.type`, the four kinds a visitor can filter by (D7). */
export const PUBLIC_KINDS = ["PHOTO", "VOICE", "VIDEO", "TEXT"] as const;
export type PublicKind = (typeof PUBLIC_KINDS)[number];

/** A file's kind on the memory page; a TEXT memory has no files of its own kind. */
export type PublicMediaKind = Exclude<PublicKind, "TEXT">;

/**
 * Whether a file may play publicly (D16 as amended by Rob, 2026-11-08: videos
 * and recordings play as recorded). `waiting`: a photo without a server-made
 * copy, or a type the site does not accept; the page shows a one-line status
 * instead.
 */
export type Playable = "yes" | "waiting";

/** A patch (tag): the spelling the family typed and its URL slug (`lib/memories/tags.ts`). */
export interface PublicTag {
  name: string;
  slug: string;
}

/** The memory's place as the contributor wrote it (normalised), and its slug (`lib/memories/places.ts`). */
export interface PublicPlace {
  label: string;
  slug: string;
}

/** A town-level point: `Memory.latitude/longitude` rounded to 0.05° (D2). Never a `Media` coordinate. */
export interface PublicPoint {
  lat: number;
  lon: number;
}

/** A photo with a READY server-made copy, in the contributor's order. Served only through `/api/public-media/<id>`. */
export interface PublicPhoto {
  id: string;
  /** The web copy's size when known (for layout without shift). */
  width: number | null;
  height: number | null;
  /** The file's caption, or a plain description when it has none. */
  alt: string;
}

/** One memory as the index, map, timeline and tag pages need it. */
export interface PublicMemory {
  id: string;
  kind: PublicKind;
  /** The contributor's name, or "A friend of Jo's". */
  who: string;
  relationship: string | null;
  /** The contributor's words (`Memory.contributorNote`), trimmed; null when empty. */
  note: string | null;
  /** "When" as the contributor wrote it (`approxDateText`), e.g. "Summer 1998". */
  when: string | null;
  /** `approxYear ?? parseApproxYear(approxDateText)` (D4); null = "Not dated yet". */
  year: number | null;
  /** `approxMonth` (1–12) when the family set one. */
  month: number | null;
  place: PublicPlace | null;
  point: PublicPoint | null;
  tags: PublicTag[];
  /** The first recording's or video's length, for card labels. */
  durationSeconds: number | null;
  photos: PublicPhoto[];
  /** The memory's first recording or video (D16 as amended); "yes" for memories without one. */
  playable: Playable;
  /** ISO 8601; the tie-breaker after year and month. */
  createdAt: string;
}

/** One file on the memory page. */
export interface PublicMediaItem {
  id: string;
  kind: PublicMediaKind;
  mimeType: string;
  caption: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  /** A READY THUMBNAIL copy exists (photos only). */
  hasThumb: boolean;
  playable: Playable;
}

/** The memory page adds every live file, in the contributor's order. */
export interface PublicMemoryDetail extends PublicMemory {
  media: PublicMediaItem[];
}

/**
 * The Explore page's filters, from the query string (`lib/validations/public-memories.ts`).
 * `n` is how many cards to show; it is clamped to the total by `buildExplore`.
 */
export interface ExploreFilters {
  place?: string;
  decade?: number;
  tag?: string;
  kind?: PublicKind;
  q?: string;
  n: number;
}

/** Memories grouped by place slug (`groupPlaces`): the map's pins and the place lists. */
export interface PlaceGroup {
  slug: string;
  /** The first spelling seen for this slug. */
  label: string;
  count: number;
  firstYear: number | null;
  lastYear: number | null;
  /** Mean of the members' points, rounded to 0.05°; null when no member has one. */
  point: PublicPoint | null;
}
