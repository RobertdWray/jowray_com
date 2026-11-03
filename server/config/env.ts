import "server-only";

import { z } from "zod";

/**
 * Per-feature environment sub-schemas.
 *
 * Every accessor is lazy and memoized: it parses `process.env` on the first
 * call and never at module scope, so a build with no `.env` (CI, worker
 * worktrees, Cache Components prerendering) never touches these values.
 * Each Phase 1 task adds only its own sub-schema here (plan §0.2).
 */

/** Strict boolean: only the literal strings "true" and "false" parse. */
export const strictBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

/** Comma-separated list: split, trimmed, lower-cased, empty entries dropped. */
export const csvList = z.string().transform((value) =>
  value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
);

const dbSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
});

const sentrySchema = z.object({
  NEXT_PUBLIC_SENTRY_DSN: z.string().min(1).optional(),
});

const siteSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z
    .string()
    .url()
    .transform((value) => value.replace(/\/+$/, ""))
    .optional(),
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
  VERCEL_BRANCH_URL: z.string().min(1).optional(),
});

export type DbEnv = z.infer<typeof dbSchema>;
export type SentryEnv = z.infer<typeof sentrySchema>;
export type SiteEnv = z.infer<typeof siteSchema>;

const cache = new Map<string, unknown>();

function memoized<T>(key: string, schema: z.ZodType<T>): () => T {
  return () => {
    const hit = cache.get(key);
    if (hit !== undefined) {
      return hit as T;
    }
    const result = schema.safeParse(process.env);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new Error(`Invalid environment (${key}): ${issues}`);
    }
    cache.set(key, result.data);
    return result.data;
  };
}

export const getDbEnv = memoized("db", dbSchema);
export const getSentryEnv = memoized("sentry", sentrySchema);
export const getSiteEnv = memoized("site", siteSchema);

/** Test helper: forget every parsed sub-schema so the next call re-reads `process.env`. */
export function resetEnvCache(): void {
  cache.clear();
}
