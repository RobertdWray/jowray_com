import type { PublicMemory } from "@/lib/memories/types";

/** Use the shared oldest-first rule for a memory thread, including undated-last ordering. */
export { oldestFirst as threadOrder } from "@/lib/memories/explore";

/** Find a memory's position and adjacent cards in an already ordered thread; absent ids have no position. */
export function prevNext(ordered: readonly PublicMemory[], id: string): {
  index: number;
  total: number;
  prev: PublicMemory | null;
  next: PublicMemory | null;
} | null {
  const index = ordered.findIndex((memory) => memory.id === id);
  return index < 0 ? null : {
    index, total: ordered.length, prev: ordered[index - 1] ?? null, next: ordered[index + 1] ?? null,
  };
}

/**
 * Rank other memories by shared place (+3), years within five (+2), and distinct shared tags (+1 each).
 * Ties use year distance (unknown last), creation date descending, then id ascending; never include the same id.
 */
export function nearby(all: readonly PublicMemory[], memory: PublicMemory, limit = 3): PublicMemory[] {
  const tags = new Set(memory.tags.map((tag) => tag.slug));
  return all
    .filter((candidate) => candidate.id !== memory.id)
    .map((candidate) => {
      const distance = candidate.year !== null && memory.year !== null
        ? Math.abs(candidate.year - memory.year)
        : Infinity;
      const sharedTags = new Set(candidate.tags.filter((tag) => tags.has(tag.slug)).map((tag) => tag.slug));
      const score = (candidate.place !== null && memory.place !== null && candidate.place.slug === memory.place.slug ? 3 : 0)
        + (distance <= 5 ? 2 : 0)
        + sharedTags.size;
      return { candidate, distance, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      const createdOrder = Date.parse(b.candidate.createdAt) - Date.parse(a.candidate.createdAt);
      if (createdOrder !== 0) {
        return createdOrder;
      }
      return a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0;
    })
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

/** Count the memories belonging to a place slug, regardless of the contributor's spelling. */
export function placeCount(all: readonly PublicMemory[], slug: string): number {
  return all.filter((memory) => memory.place?.slug === slug).length;
}

/** Label a photo with its free-text date and town (the place label before its first comma), omitting absent parts. */
export function photoPill(memory: PublicMemory): string | null {
  const town = memory.place?.label.split(",", 1)[0];
  return [memory.when, town].filter(Boolean).join(", ") || null;
}
