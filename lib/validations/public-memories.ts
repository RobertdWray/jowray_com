import { z } from "zod";

import { PUBLIC_KINDS } from "@/lib/memories/types";
import type { ExploreFilters, PublicKind } from "@/lib/memories/types";

/** Query values supplied by a Next.js page; repeated keys arrive as arrays. */
export type SearchParams = Record<string, string | string[] | undefined>;

/** Initial Explore card count; must equal EXPLORE_PAGE_SIZE in lib/memories/explore.ts. */
export const DEFAULT_EXPLORE_N = 12;

/** Initial number of memories shown on the tags page. */
export const DEFAULT_TAGS_N = 9;

/** Read only the first occurrence of a query key, even when that value is empty. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Accept only canonical place and tag slugs, with at most 80 characters. */
export const slugSchema = z.string().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** Coerce a decade's first year, from 1900 through 2090 in steps of ten. */
export const decadeSchema = z.coerce.number().int().min(1900).max(2090).multipleOf(10);

/** Accept the four public memory kinds with their stored, uppercase spelling. */
export const kindSchema = z.enum(PUBLIC_KINDS);

/** Trim search text, reject more than 100 characters, and treat empty text as absent. */
export const searchSchema = z
  .string()
  .trim()
  .max(100)
  .transform((value) => (value.length === 0 ? undefined : value));

/** Coerce a positive safe integer; the read model, not this schema, clamps it to the total. */
export const countSchema = z.coerce.number().int().min(1);

const memoryIdSchema = z.uuid();

function parseParam<T>(schema: z.ZodType<T>, value: string | string[] | undefined): T | undefined {
  const result = schema.safeParse(firstParam(value));
  return result.success ? result.data : undefined;
}

/** Parse each Explore key independently so a bad filter never clears valid neighbours. */
export function parseExploreQuery(params: SearchParams): ExploreFilters {
  const place = parseParam(slugSchema, params.place);
  const decade = parseParam(decadeSchema, params.decade);
  const tag = parseParam(slugSchema, params.tag);
  const kind = parseParam(kindSchema, params.kind);
  const q = parseParam(searchSchema, params.q);
  const n = parseParam(countSchema, params.n) ?? DEFAULT_EXPLORE_N;

  return {
    ...(place !== undefined ? { place } : {}),
    ...(decade !== undefined ? { decade } : {}),
    ...(tag !== undefined ? { tag } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(q !== undefined ? { q } : {}),
    n,
  };
}

/** Read only the map's place selection, omitting an invalid or missing slug. */
export function parseMapQuery(params: SearchParams): { place?: string } {
  const place = parseParam(slugSchema, params.place);
  return place !== undefined ? { place } : {};
}

/** Read the timeline's kind; decade navigation belongs in the URL fragment. */
export function parseTimelineQuery(params: SearchParams): { kind?: PublicKind } {
  const kind = parseParam(kindSchema, params.kind);
  return kind !== undefined ? { kind } : {};
}

/** Read the tag and count independently, defaulting only an invalid or absent count. */
export function parseTagsQuery(params: SearchParams): { tag?: string; n: number } {
  const tag = parseParam(slugSchema, params.tag);
  const n = parseParam(countSchema, params.n) ?? DEFAULT_TAGS_N;
  return { ...(tag !== undefined ? { tag } : {}), n };
}

/** Validate a UUID of any supported version (including nil/max), returning lower case or null. */
export function parseMemoryId(value: string): string | null {
  const result = memoryIdSchema.safeParse(value.toLowerCase());
  return result.success ? result.data : null;
}
