import "server-only";

import { z } from "zod";

import { logError, type LogCategory } from "@/lib/logger";

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

/**
 * A positive-integer ceiling with a default. `KEY=` (empty) means unset, like
 * the admin secrets. A malformed value (`0`, `-1`, `2.5`, `abc`) is reported
 * once per process (the sub-schema is memoized) and the default is used: these
 * keys gate the family's receipts, so a typo in Vercel must never stop them
 * (#49 regression review). The value itself is not logged.
 */
const lenientPositiveInt = (key: string, fallback: number, category: LogCategory = "email") =>
  z.preprocess((value) => {
    if (value === undefined || value === "") {
      return undefined;
    }
    const n = typeof value === "string" ? Number(value.trim()) : Number(value);
    if (Number.isInteger(n) && n > 0) {
      return n;
    }
    logError(`${key} is not a positive integer; using the default`, new Error(`invalid ${key}`), { category, key, fallback });
    return undefined;
  }, z.number().int().positive().default(fallback));

/**
 * The outbound guard and the global ceilings for contributor email (issue #46,
 * D2). The ceilings count every confirmation and send receipt across all
 * recipients in a rolling hour and a rolling day; a send past either is left
 * as a retryable row the reconcile cron sends once the window has moved on,
 * with rotated links, so the defaults are sized for a memorial afternoon (30
 * relatives, one to three memories each, one send apiece) never to hold one.
 * Readable even when SendGrid is not configured.
 */
const outboundSchema = z.object({
  OUTBOUND_ENABLED: strictBoolean.default(false),
  OUTBOUND_ALLOWLIST: csvList.default([]),
  OUTBOUND_HOURLY_CAP: lenientPositiveInt("OUTBOUND_HOURLY_CAP", 60),
  OUTBOUND_DAILY_CAP: lenientPositiveInt("OUTBOUND_DAILY_CAP", 300),
});

const emailSchema = z.object({
  SENDGRID_API_KEY: z.string().min(1, "SENDGRID_API_KEY is required"),
  SENDGRID_FROM_EMAIL: z.email("SENDGRID_FROM_EMAIL must be an address"),
});

const uploadSchema = z.object({
  UPLOAD_TICKET_SECRET: z.string().min(32, "UPLOAD_TICKET_SECRET must be at least 32 characters"),
  DAILY_MEMORY_BUDGET: z.coerce.number().int().positive().default(200),
  DAILY_BYTE_BUDGET: z.coerce.number().int().positive().default(20 * 1024 ** 3),
  // Issue #44 (upload budgets and retention). Optional with defaults a normal family send never meets.
  /** Declared bytes one send may reserve across all its files; the daily budget is the rate limit, this is the per-request limit. */
  MAX_DECLARED_BYTES_PER_SUBMISSION: z.coerce.number().int().positive().default(4 * 1024 ** 3),
  /** Stock limit: READY originals + READY derived copies + open reservations may not pass this; new reservations are refused beyond it. */
  TOTAL_BYTE_CEILING: z.coerce.number().int().positive().default(50 * 1024 ** 3),
});

const memorialSchema = z.object({
  MEMORIAL_SLUG: z.string().min(1, "MEMORIAL_SLUG is required"),
  CONSENT_VERSION: z.string().min(1, "CONSENT_VERSION is required"),
});

const cronSchema = z.object({
  CRON_SECRET: z.string().min(16).optional(),
});

/**
 * Family admins who get the "new memory" alert; empty means the alert is off
 * (the cron catches up once set). `ADMIN_ALERT_HOURLY_CAP` (issue #46, D4):
 * after this many alerts in a rolling hour the admins get one "arriving
 * quickly" notice and further alerts that hour are skipped (the memories are
 * still on the admin page).
 */
const adminAlertSchema = z.object({
  ADMIN_ALERT_EMAILS: csvList.pipe(z.array(z.email())).default([]),
  ADMIN_ALERT_HOURLY_CAP: lenientPositiveInt("ADMIN_ALERT_HOURLY_CAP", 20),
});

/** Bearer secret for the admin API (/api/admin/*); unset means the routes answer 401 to everything. */
const adminSchema = z.object({
  // `ADMIN_API_SECRET=` (empty) means unset, like the other optional keys, so the routes fail closed with 401 rather than 500.
  ADMIN_API_SECRET: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(32, "ADMIN_API_SECRET must be at least 32 characters").optional()),
});

/**
 * Bearer secret for the MCP endpoint (/api/mcp); unset means the route answers 401 to everything.
 * Separate from ADMIN_API_SECRET so each rotates on its own (a connector's header cannot be edited, only re-added).
 */
const mcpSchema = z.object({
  // `MCP_API_SECRET=` (empty) means unset, like ADMIN_API_SECRET: the route fails closed with 401 rather than 500.
  MCP_API_SECRET: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(32, "MCP_API_SECRET must be at least 32 characters").optional()),
});

/** Shared secret behind the family admin page (/admin); unset means signed-out for everyone, never a 500. */
const adminPageSchema = z.object({
  // `ADMIN_PAGE_SECRET=` (empty) means unset, like ADMIN_API_SECRET: every check fails closed.
  ADMIN_PAGE_SECRET: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(32, "ADMIN_PAGE_SECRET must be at least 32 characters").optional()),
});

/**
 * Egress allowances behind `/api/media` and `/admin/media` (issue #45). Every
 * value has a default, so a deployment works with none of them set. Sizes are
 * bytes; the multiples are "distinct viewers per UTC day, each charged once
 * at the file's size" (a viewer's later requests that day are free up to the
 * request cap), so ordinary playback, seeking and reloading never reach them.
 */
/** `KEY=` (blank) means unset, like `ADMIN_PAGE_SECRET`: the default applies. `z.coerce` alone would turn "" into 0. */
const blankIsUnset = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((value) => (value === "" ? undefined : value), schema);
const mediaServingSchema = z.object({
  /** Viewer-days a file whose memory is APPROVED may be served to per day, each at the file's size. */
  MEDIA_FILE_DAILY_MULTIPLE: blankIsUnset(z.coerce.number().int().positive().default(100)),
  /** Before approval (the contributor and whoever they forwarded the link to): fewer viewer-days. */
  MEDIA_FILE_DAILY_MULTIPLE_UNAPPROVED: blankIsUnset(z.coerce.number().int().positive().default(50)),
  /** Bytes the whole site may serve to claim-link holders per day (default 50 GiB). */
  MEDIA_DAILY_EGRESS_BYTES: blankIsUnset(z.coerce.number().int().positive().default(50 * 1024 ** 3)),
  /** Requests one viewer may make for one copy of one file per day; a long day of seeking and reloading is well under it. */
  MEDIA_VIEWER_DAILY_REQUESTS: blankIsUnset(z.coerce.number().int().positive().default(300)),
  /** Downloads up to this size stream through the function (sanitized filename, as on main); larger ones redirect (default 25 MiB). */
  MEDIA_PROXY_DOWNLOAD_MAX_BYTES: blankIsUnset(z.coerce.number().int().nonnegative().default(25 * 1024 ** 2)),
  /**
   * See memories (plan 2026-11-08 D18): public visitors of `/api/public-media` have their own counters (`public:` scopes)
   * and limits, so strangers can never use up what claim-link holders and the admin page are allowed.
   * Bytes the whole site may serve to public visitors per day (default 20 GiB).
   */
  MEDIA_PUBLIC_DAILY_EGRESS_BYTES: blankIsUnset(z.coerce.number().int().positive().default(20 * 1024 ** 3)),
  /** Distinct public viewers per day one file may be served to, each charged once at the copy's size (default 100). */
  MEDIA_PUBLIC_FILE_DAILY_MULTIPLE: blankIsUnset(z.coerce.number().int().positive().default(100)),
  /** Requests one public viewer may make for one copy of one file per day (default 600: a page of thumbnails, reloads and seeking). */
  MEDIA_PUBLIC_VIEWER_DAILY_REQUESTS: blankIsUnset(z.coerce.number().int().positive().default(600)),
});

/**
 * The See memories launch flag (plan 2026-11-08 D15). Off (the default) keeps `/memories/**` on the opening note,
 * `/api/public-media` at 404 and the header link hidden. A change applies only to a new deployment (Vercel), so
 * turning the pages on or off is "set the variable, then redeploy".
 */
const publicMemoriesSchema = z.object({
  PUBLIC_MEMORIES_ENABLED: blankIsUnset(strictBoolean.default(false)),
});

/**
 * Place suggestions from photo GPS (plan 2026-11-06-photo-gps-places, D7). Only Production sets `nominatim`; Preview
 * and local runs use `stub` (no network); unset is `off`. The lookup URL is config so the service can be switched
 * without a code change, as the Nominatim usage policy asks. The two ceilings are daily: provider calls actually sent
 * site-wide, and incoming lookups per viewer. Every key has a default, so a deployment works with none of them set.
 */
const placesSchema = z.object({
  PLACES_PROVIDER: blankIsUnset(z.enum(["nominatim", "stub", "off"]).default("off")),
  PLACES_LOOKUP_URL: blankIsUnset(
    z
      .url({ protocol: /^https?$/ })
      .transform((value) => value.replace(/\/+$/, ""))
      .default("https://nominatim.openstreetmap.org")
  ),
  PLACES_DAILY_PROVIDER_CALLS: lenientPositiveInt("PLACES_DAILY_PROVIDER_CALLS", 500, "api"),
  PLACES_VIEWER_DAILY_REQUESTS: lenientPositiveInt("PLACES_VIEWER_DAILY_REQUESTS", 60, "api"),
});

export type DbEnv = z.infer<typeof dbSchema>;
export type PlacesEnv = z.infer<typeof placesSchema>;
export type MediaServingEnv = z.infer<typeof mediaServingSchema>;
export type PublicMemoriesEnv = z.infer<typeof publicMemoriesSchema>;
export type AdminPageEnv = z.infer<typeof adminPageSchema>;
export type AdminEnv = z.infer<typeof adminSchema>;
export type McpEnv = z.infer<typeof mcpSchema>;
export type CronEnv = z.infer<typeof cronSchema>;
export type AdminAlertEnv = z.infer<typeof adminAlertSchema>;
export type MemorialEnv = z.infer<typeof memorialSchema>;
export type UploadEnv = z.infer<typeof uploadSchema>;
export type BlobEnv = z.infer<typeof blobSchema>;
export type EmailEnv = z.infer<typeof emailSchema>;
export type OutboundEnv = z.infer<typeof outboundSchema>;
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
export const getOutboundEnv = memoized("outbound", outboundSchema);
export const getUploadEnv = memoized("upload", uploadSchema);
export const getMemorialEnv = memoized("memorial", memorialSchema);
export const getCronEnv = memoized("cron", cronSchema);
export const getAdminAlertEnv = memoized("adminAlert", adminAlertSchema);
export const getAdminEnv = memoized("admin", adminSchema);
export const getMcpEnv = memoized("mcp", mcpSchema);
export const getAdminPageEnv = memoized("adminPage", adminPageSchema);
export const getMediaServingEnv = memoized("mediaServing", mediaServingSchema);
export const getPublicMemoriesEnv = memoized("publicMemories", publicMemoriesSchema);
export const getPlacesEnv = memoized("places", placesSchema);

/** Test helper: forget every parsed sub-schema so the next call re-reads `process.env`. */
export function resetEnvCache(): void {
  cache.clear();
}
