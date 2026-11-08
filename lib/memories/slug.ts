/** Longest slug a tag or place may produce; `lib/validations/public-memories.ts` accepts no longer. */
export const SLUG_MAX_LENGTH = 80;

/**
 * URL slug for a tag or place name: diacritics stripped, apostrophes dropped
 * (so "St. Mary's" and "St Marys" meet), lower case, every other run of
 * characters outside `a-z0-9` becomes one hyphen, no leading or trailing
 * hyphen, at most 80 characters. An empty result means the name has no Latin
 * letter or digit; callers refuse such names rather than invent a slug.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['‘’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
}
