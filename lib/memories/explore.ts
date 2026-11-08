import { decadeOf } from "@/lib/memories/approx-year";
import { countNoun, KIND_TEXT, memoriesText } from "@/lib/memories/format";
import { groupPlaces } from "@/lib/memories/places";
import { PUBLIC_KINDS } from "@/lib/memories/types";
import type { ExploreFilters, PlaceGroup, PublicKind, PublicMemory } from "@/lib/memories/types";

/** Number of additional cards offered on each Explore page. */
export const EXPLORE_PAGE_SIZE = 12;

/** Number of additional cards offered below a selected quilt patch. */
export const TAGS_PAGE_SIZE = 9;

/** Maximum number of cards shown for the selected map place. */
export const MAP_CARD_LIMIT = 6;

/** Earliest baseline decade; earlier dated memories extend the range. */
export const FIRST_DECADE = 1950;

/** Latest baseline decade; later dated memories extend the range. */
export const LAST_DECADE = 2020;

/** A place facet counted without the place filter and marked for selection. */
export interface FacetPlace extends PlaceGroup {
  selected: boolean;
}

/** A decade facet counted without the decade filter, including empty decades. */
export interface FacetDecade {
  decade: number;
  count: number;
  selected: boolean;
}

/** A tag facet counted without the tag filter, retaining the first spelling seen in the collection. */
export interface FacetTag {
  name: string;
  slug: string;
  count: number;
  selected: boolean;
}

/** A kind facet counted without the kind filter and labeled for visitors. */
export interface FacetKind {
  kind: PublicKind;
  label: string;
  count: number;
  selected: boolean;
}

/** Everything the Explore page renders, including unfiltered stats and independently counted facets. */
export interface ExploreModel {
  stats: { total: number; places: number; first: number | null; last: number | null; decades: number };
  places: FacetPlace[];
  decades: FacetDecade[];
  undatedCount: number;
  tags: FacetTag[];
  topTags: FacetTag[];
  kinds: FacetKind[];
  list: PublicMemory[];
  total: number;
  shown: PublicMemory[];
  moreCount: number;
  nextN: number | null;
  summary: string;
  hasFilters: boolean;
  selectedPlace: FacetPlace | null;
  selectedTag: FacetTag | null;
}

/** All place groups plus the selected place's first six memories in chronological order. */
export interface MapModel {
  places: PlaceGroup[];
  selected: PlaceGroup | null;
  selectedMemories: PublicMemory[];
  unplacedCount: number;
  total: number;
  placeCount: number;
}

/** Named patch-border colors from the approved quilt design. */
export type PatchEdge = "periwinkle" | "goldenrod" | "lake-green" | "sunhat-pink" | "plum" | "wood";

/** A ranked quilt tag with deterministic size, tilt, border and selection state. */
export interface QuiltPatch {
  name: string;
  slug: string;
  count: number;
  fontPx: number;
  tilt: string;
  edge: PatchEdge;
  selected: boolean;
}

/** The quilt, selected patch's cards and most frequent co-occurring patches. */
export interface QuiltModel {
  patches: QuiltPatch[];
  selected: QuiltPatch | null;
  neighbors: Array<{ name: string; slug: string; count: number }>;
  list: PublicMemory[];
  total: number;
  shown: PublicMemory[];
  moreCount: number;
  nextN: number | null;
  eyebrow: string | null;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function chronological(a: PublicMemory, b: PublicMemory, direction: 1 | -1): number {
  if (a.year === null && b.year !== null) {
    return 1;
  }
  if (a.year !== null && b.year === null) {
    return -1;
  }

  const dateOrder = a.year !== null && b.year !== null
    ? a.year - b.year || (a.month ?? 0) - (b.month ?? 0)
    : 0;
  return direction * (dateOrder || Date.parse(a.createdAt) - Date.parse(b.createdAt) || compareText(a.id, b.id));
}

/** Copy and sort newest first by year, month, creation date and id; undated memories always come last. */
export function newestFirst(memories: readonly PublicMemory[]): PublicMemory[] {
  return [...memories].sort((a, b) => chronological(a, b, -1));
}

/** Copy and sort oldest first by year, month, creation date and id; undated memories always come last. */
export function oldestFirst(memories: readonly PublicMemory[]): PublicMemory[] {
  return [...memories].sort((a, b) => chronological(a, b, 1));
}

function searchText(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Match a trimmed substring across public text, ignoring case and combining diacritics. */
export function matchesSearch(memory: PublicMemory, q: string): boolean {
  const haystack = [
    memory.who, memory.relationship, memory.note, memory.when, memory.place?.label,
    ...memory.tags.map((tag) => tag.name),
  ].join(" ");
  return searchText(haystack).includes(searchText(q.trim()));
}

/** List every decade in the baseline range, extending it for earlier or later non-null years. */
export function decadeRange(years: readonly (number | null)[]): number[] {
  let first = FIRST_DECADE;
  let last = LAST_DECADE;
  for (const year of years) {
    if (year !== null) {
      first = Math.min(first, decadeOf(year));
      last = Math.max(last, decadeOf(year));
    }
  }
  const decades: number[] = [];
  for (let decade = first; decade <= last; decade += 10) {
    decades.push(decade);
  }
  return decades;
}

type TagCount = { name: string; slug: string; count: number };

function countTags(memories: readonly PublicMemory[]): TagCount[] {
  const tags = new Map<string, TagCount>();
  for (const memory of memories) {
    const seen = new Set<string>();
    for (const tag of memory.tags) {
      if (seen.has(tag.slug)) {
        continue;
      }
      seen.add(tag.slug);
      const counted = tags.get(tag.slug);
      if (counted) {
        counted.count += 1;
      } else {
        tags.set(tag.slug, { ...tag, count: 1 });
      }
    }
  }
  return [...tags.values()];
}

function rankTags(a: TagCount, b: TagCount): number {
  return b.count - a.count || a.name.localeCompare(b.name, "en");
}

function paginate(list: PublicMemory[], n: number, pageSize: number) {
  const total = list.length;
  const shown = list.slice(0, Math.min(n < 1 ? pageSize : n, total));
  const remaining = total - shown.length;
  return {
    total,
    shown,
    moreCount: Math.min(pageSize, remaining),
    nextN: remaining > 0 ? shown.length + pageSize : null,
  };
}

type FacetFilter = "place" | "decade" | "tag" | "kind";

function passes(memory: PublicMemory, filters: ExploreFilters, except?: FacetFilter): boolean {
  return (except === "place" || !filters.place || memory.place?.slug === filters.place)
    && (except === "decade" || filters.decade === undefined || (memory.year !== null && decadeOf(memory.year) === filters.decade))
    && (except === "tag" || !filters.tag || memory.tags.some((tag) => tag.slug === filters.tag))
    && (except === "kind" || !filters.kind || memory.kind === filters.kind)
    && (!filters.q || matchesSearch(memory, filters.q));
}

/**
 * Build Explore without mutating inputs: each facet omits only its own filter, while stats use all memories.
 * Empty search text is inactive. Selected zero-count facets retain known labels, falling back to their slug.
 */
export function buildExplore(memories: readonly PublicMemory[], filters: ExploreFilters): ExploreModel {
  const query = { ...filters, q: filters.q?.trim() || undefined };
  const allPlaces = groupPlaces(memories);
  const allTags = new Map(countTags(memories).map((tag) => [tag.slug, tag]));
  let first: number | null = null;
  let last: number | null = null;
  const datedDecades = new Set<number>();
  for (const memory of memories) {
    if (memory.year !== null) {
      first = first === null ? memory.year : Math.min(first, memory.year);
      last = last === null ? memory.year : Math.max(last, memory.year);
      datedDecades.add(decadeOf(memory.year));
    }
  }

  const places: FacetPlace[] = groupPlaces(memories.filter((memory) => passes(memory, query, "place")))
    .map((place) => ({ ...place, selected: place.slug === query.place }));
  if (query.place && !places.some((place) => place.selected)) {
    places.push({
      slug: query.place,
      label: allPlaces.find((place) => place.slug === query.place)?.label ?? query.place,
      count: 0, firstYear: null, lastYear: null, point: null, selected: true,
    });
  }
  places.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "en"));
  const selectedPlace = places.find((place) => place.selected) ?? null;

  const decadeCounts = new Map<number, number>();
  let undatedCount = 0;
  for (const memory of memories.filter((memory) => passes(memory, query, "decade"))) {
    if (memory.year === null) {
      undatedCount += 1;
    } else {
      const decade = decadeOf(memory.year);
      decadeCounts.set(decade, (decadeCounts.get(decade) ?? 0) + 1);
    }
  }
  const decades = decadeRange(memories.map((memory) => memory.year)).map((decade) => ({
    decade, count: decadeCounts.get(decade) ?? 0, selected: decade === query.decade,
  }));

  const tags: FacetTag[] = countTags(memories.filter((memory) => passes(memory, query, "tag")))
    .map((tag) => ({ ...tag, name: allTags.get(tag.slug)?.name ?? tag.name, selected: tag.slug === query.tag }));
  if (query.tag && !tags.some((tag) => tag.selected)) {
    tags.push({ name: allTags.get(query.tag)?.name ?? query.tag, slug: query.tag, count: 0, selected: true });
  }
  tags.sort(rankTags);
  const selectedTag = tags.find((tag) => tag.selected) ?? null;
  const topTags = tags.slice(0, 12);
  if (selectedTag && !topTags.includes(selectedTag)) {
    topTags.push(selectedTag);
  }

  const kindMemories = memories.filter((memory) => passes(memory, query, "kind"));
  const kinds = PUBLIC_KINDS.map((kind) => ({
    kind, label: KIND_TEXT[kind].chip,
    count: kindMemories.filter((memory) => memory.kind === kind).length,
    selected: kind === query.kind,
  }));
  const list = newestFirst(memories.filter((memory) => passes(memory, query)));
  const hasFilters = Boolean(query.place || query.decade !== undefined || query.tag || query.kind || query.q);
  let summary = `${memoriesText(list.length)}, newest first`;
  if (hasFilters) {
    summary = query.kind
      ? countNoun(list.length, KIND_TEXT[query.kind].singular, KIND_TEXT[query.kind].plural)
      : memoriesText(list.length);
    if (selectedTag) {
      summary += ` about ${selectedTag.name.toLowerCase()}`;
    }
    if (selectedPlace) {
      summary += ` from ${selectedPlace.label}`;
    }
    if (query.decade !== undefined) {
      summary += ` in the ${query.decade}s`;
    }
    if (query.q) {
      summary += ` mentioning “${query.q}”`;
    }
  }

  return {
    stats: { total: memories.length, places: allPlaces.length, first, last, decades: datedDecades.size },
    places, decades, undatedCount, tags, topTags, kinds, list,
    ...paginate(list, query.n, EXPLORE_PAGE_SIZE),
    summary, hasFilters, selectedPlace, selectedTag,
  };
}

/** Group the map's places and show the selected group's oldest cards; unknown selections use the first group. */
export function buildMap(memories: readonly PublicMemory[], placeSlug?: string): MapModel {
  const places = groupPlaces(memories);
  const selected = places.find((place) => place.slug === placeSlug) ?? places[0] ?? null;
  return {
    places,
    selected,
    selectedMemories: selected
      ? oldestFirst(memories.filter((memory) => memory.place?.slug === selected.slug)).slice(0, MAP_CARD_LIMIT)
      : [],
    unplacedCount: memories.filter((memory) => memory.place === null).length,
    total: memories.length,
    placeCount: places.length,
  };
}

/** Build ranked quilt patches, paged newest-first cards and four co-occurring tags; unknown selections use the first patch. */
export function buildQuilt(memories: readonly PublicMemory[], tagSlug?: string, n = TAGS_PAGE_SIZE): QuiltModel {
  const ranked = countTags(memories).sort(rankTags);
  const selectedSlug = ranked.find((tag) => tag.slug === tagSlug)?.slug ?? ranked[0]?.slug;
  const maxCount = ranked[0]?.count ?? 1;
  const tilts = ["-2deg", "1.5deg", "-1deg", "2deg", "-1.5deg", "1deg", "0deg"];
  const edges: PatchEdge[] = ["periwinkle", "goldenrod", "lake-green", "sunhat-pink", "plum", "wood"];
  const patches = ranked.map((tag, index) => ({
    ...tag,
    fontPx: Math.round(20 + Math.pow(tag.count / maxCount, 0.8) * 26),
    tilt: tilts[index % tilts.length],
    edge: edges[index % edges.length],
    selected: tag.slug === selectedSlug,
  }));
  const selected = patches.find((patch) => patch.selected) ?? null;
  const matching = selected
    ? memories.filter((memory) => memory.tags.some((tag) => tag.slug === selected.slug))
    : [];
  const names = new Map(ranked.map((tag) => [tag.slug, tag.name]));
  const neighbors = countTags(matching)
    .filter((tag) => tag.slug !== selectedSlug)
    .map((tag) => ({ ...tag, name: names.get(tag.slug) ?? tag.name }))
    .sort(rankTags)
    .slice(0, 4);
  const list = newestFirst(matching);
  return {
    patches, selected, neighbors, list,
    ...paginate(list, n, TAGS_PAGE_SIZE),
    eyebrow: selected ? `${memoriesText(list.length)} ${list.length === 1 ? "carries" : "carry"} this patch` : null,
  };
}
