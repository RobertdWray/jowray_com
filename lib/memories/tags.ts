import { slugify } from "@/lib/memories/slug";
import type { PublicTag } from "@/lib/memories/types";

/** Maximum number of usable, distinct patches stored on one memory. */
export const MAX_TAGS = 20;

/** Maximum length of a stored patch name, measured in Unicode code points. */
export const MAX_TAG_LENGTH = 40;

/** Use the shared slug rule to identify a patch in storage and public URLs. */
export function tagSlug(name: string): string {
  return slugify(name);
}

/** Normalize a patch name's whitespace and cap its code points without a trailing space. */
export function normalizeTagName(name: string): string {
  return Array.from(name.trim().replace(/\s+/gu, " "))
    .slice(0, MAX_TAG_LENGTH)
    .join("")
    .trimEnd();
}

/** Whether a normalized patch name is non-empty and can produce a public URL slug. */
export function isUsableTag(name: string): boolean {
  const normalized = normalizeTagName(name);
  return normalized.length > 0 && tagSlug(normalized).length > 0;
}

/** Normalize patches, drop unusable names, and keep the first spelling per slug up to MAX_TAGS. */
export function normalizeTags(names: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const name of names) {
    const tag = normalizeTagName(name);
    const slug = tagSlug(tag);
    if (!slug || seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    normalized.push(tag);
    if (normalized.length === MAX_TAGS) {
      break;
    }
  }

  return normalized;
}

/** Build public patch labels and URL slugs using the same normalization as stored tags. */
export function toPublicTags(names: readonly string[]): PublicTag[] {
  return normalizeTags(names).map((name) => ({ name, slug: tagSlug(name) }));
}

/** Detect admin tag changes by comparing exact strings in order, without normalization. */
export function tagsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}
