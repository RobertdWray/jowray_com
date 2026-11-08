import type { ExploreFilters, PublicKind } from "@/lib/memories/types";
import { DEFAULT_EXPLORE_N, DEFAULT_TAGS_N } from "@/lib/validations/public-memories";

/** Canonical paths for the four public memory views. */
export const PUBLIC_PATHS = {
  explore: "/memories",
  map: "/memories/map",
  timeline: "/memories/timeline",
  tags: "/memories/tags",
} as const;

/** Where visitors can share a memory of Jo. */
export const shareHref = "/share";

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Encode Explore filters in place/decade/tag/kind/q/n order, omitting undefined values and the default count. */
export function exploreHref(filters: Partial<ExploreFilters>): string {
  const params = new URLSearchParams();
  if (filters.place !== undefined) {
    params.set("place", filters.place);
  }
  if (filters.decade !== undefined) {
    params.set("decade", String(filters.decade));
  }
  if (filters.tag !== undefined) {
    params.set("tag", filters.tag);
  }
  if (filters.kind !== undefined) {
    params.set("kind", filters.kind);
  }
  if (filters.q !== undefined) {
    params.set("q", filters.q);
  }
  if (filters.n !== undefined && filters.n !== DEFAULT_EXPLORE_N) {
    params.set("n", String(filters.n));
  }
  return withQuery(PUBLIC_PATHS.explore, params);
}

/** Toggle one exact filter value, preserving the others and search while resetting the count. */
export function toggleHref(
  current: ExploreFilters,
  key: "place" | "decade" | "tag" | "kind",
  value: string | number,
): string {
  return exploreHref({ ...current, [key]: current[key] === value ? undefined : value, n: undefined });
}

/** Replace the trimmed search (empty removes it), preserve other filters and reset the count. */
export function searchHref(current: ExploreFilters, q: string): string {
  return exploreHref({ ...current, q: q.trim() || undefined, n: undefined });
}

/** Keep all Explore filters and show the requested number of memories. */
export function moreHref(current: ExploreFilters, nextN: number): string {
  return exploreHref({ ...current, n: nextN });
}

/** Build a map link with an optional, query-encoded place selection. */
export function mapHref(place?: string): string {
  const params = new URLSearchParams();
  if (place !== undefined) {
    params.set("place", place);
  }
  return withQuery(PUBLIC_PATHS.map, params);
}

/** Put the kind in the timeline query and the decade in its #d1980-style fragment. */
export function timelineHref(options?: { kind?: PublicKind; decade?: number }): string {
  const params = new URLSearchParams();
  if (options?.kind !== undefined) {
    params.set("kind", options.kind);
  }
  const fragment = options?.decade !== undefined ? `#d${options.decade}` : "";
  return `${withQuery(PUBLIC_PATHS.timeline, params)}${fragment}`;
}

/** Encode a tag selection followed by its count, omitting the nine-item default. */
export function tagsHref(tag?: string, n?: number): string {
  const params = new URLSearchParams();
  if (tag !== undefined) {
    params.set("tag", tag);
  }
  if (n !== undefined && n !== DEFAULT_TAGS_N) {
    params.set("n", String(n));
  }
  return withQuery(PUBLIC_PATHS.tags, params);
}

/** Encode a memory id as one path segment on its public detail page. */
export function memoryHref(id: string): string {
  return `${PUBLIC_PATHS.explore}/${encodeURIComponent(id)}`;
}

/** Link to a public thumbnail or web copy, encoding the media id as one path segment. */
export function publicMediaHref(id: string, variant: "thumb" | "web"): string {
  return `/api/public-media/${encodeURIComponent(id)}?v=${variant}`;
}
