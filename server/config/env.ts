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

const siteSchema = z
  .object({
    NEXT_PUBLIC_SITE_URL: z
      .url({ protocol: /^https?$/ })
      .transform((value) => value.replace(/\/+$/, ""))
      .optional(),
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
    VERCEL_BRANCH_URL: z.string().min(1).optional(),
  })
  .refine(
    (env) => env.VERCEL_ENV !== "production" || !env.NEXT_PUBLIC_SITE_URL || env.NEXT_PUBLIC_SITE_URL.startsWith("https://"),
    { message: "NEXT_PUBLIC_SITE_URL must use https in production (claim links are bearer tokens)", path: ["NEXT_PUBLIC_SITE_URL"] }
  );

const blobSchema = z.object({
  BLOB_READ_WRITE_TOKEN: z.string().min(1, "BLOB_READ_WRITE_TOKEN is required"),
});

const emailSchema = z.object({
  SENDGRID_API_KEY: z.string().min(1, "SENDGRID_API_KEY is required"),
  SENDGRID_FROM_EMAIL: z.string().email("SENDGRID_FROM_EMAIL must be an address"),
  OUTBOUND_ENABLED: strictBoolean.default(false),
  OUTBOUND_ALLOWLIST: csvList.default([]),
  CONSENT_VERSION: z.string().min(1, "CONSENT_VERSION is required"),
});

export type DbEnv = z.infer<typeof dbSchema>;
export type BlobEnv = z.infer<typeof blobSchema>;
export type EmailEnv = z.infer<typeof emailSchema>;
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
        .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
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
export const getBlobEnv = memoized("blob", blobSchema);
export const getEmailEnv = memoized("email", emailSchema);

/** Test helper: forget every parsed sub-schema so the next call re-reads `process.env`. */
export function resetEnvCache(): void {
  cache.clear();
}
