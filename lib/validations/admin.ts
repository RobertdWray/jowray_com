import { z } from "zod";

import { MIN_YEAR } from "@/lib/memories/approx-year";
import { isUsableTag, MAX_TAG_LENGTH, MAX_TAGS, normalizeTags } from "@/lib/memories/tags";
import { coordinatesSchema, MAX_DURATION_SECONDS, mediaWordsFields } from "@/lib/validations/memory";

/**
 * Input schemas for the family admin page (docs/plans/2026-11-04-admin-page.md §3.5).
 * Pure zod, no server imports, so the client forms can type against them.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

export const MEMORY_STATUSES = ["DRAFT", "PENDING", "APPROVED", "HIDDEN"] as const;
export type AdminMemoryStatus = (typeof MEMORY_STATUSES)[number];

/** The list page's query string: status chip, search box and the Deleted toggle. */
export const adminListQuerySchema = z.object({
  status: z.enum(MEMORY_STATUSES).optional(),
  q: z
    .string()
    .trim()
    .max(100)
    .transform((value) => (value.length === 0 ? undefined : value))
    .optional(),
  // A checkbox or a hand-typed link: "on", "1" and "true" mean true; anything else is refused.
  deleted: z
    .enum(["on", "1", "true"])
    .transform(() => true)
    .optional(),
});
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;

// A row version (`updatedAt` as ISO). The description reaches the MCP tool schemas (tools/list), so the model passes the value back untouched.
const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Expected an ISO date" })
  .describe("ISO-8601 timestamp exactly as get_memory returned it");

/**
 * The family's patches (tags) for a memory (plan 2026-11-08 D3): each 1–40
 * characters with at least one Latin letter or digit, at most 20, stored as
 * `normalizeTags` returns them (one spelling per slug, first one kept).
 */
const tagsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(MAX_TAG_LENGTH)
      .refine(isUsableTag, { message: "A patch needs at least one letter or number" }),
  )
  .max(MAX_TAGS)
  .transform((tags) => normalizeTags(tags))
  .describe(`The memory's patches (tags), replacing the whole list: at most ${MAX_TAGS}, each at most ${MAX_TAG_LENGTH} characters; [] clears them. Two spellings with the same slug (café, cafe) are one patch, the first kept.`);

/** A year the family is sure of; checked against the clock at parse time, so a long-running server never goes stale. */
const approxYearSchema = z
  .number()
  .int()
  .min(MIN_YEAR)
  .refine((year) => year <= new Date().getUTCFullYear(), { message: "Expected a year no later than this year" })
  .nullable()
  .describe(`The year the memory is from (${MIN_YEAR} to this year), placing it on the See memories timeline; null clears it so the year is read from the approximate date text again.`);

const approxMonthSchema = z
  .number()
  .int()
  .min(1)
  .max(12)
  .nullable()
  .describe("The month (1–12) within approxYear; null clears it. Refused when the memory would have a month without a year.");

/**
 * One admin save: only the keys the user changed are present (dirty-field
 * submission), with the two versions the form was opened with. The contributor's
 * email and the person's own preferences are not editable here (plan §3.5), so
 * they are unknown keys and the object is strict. `null` clears a value;
 * an absent key leaves it alone.
 */
export const adminMemoryChangesSchema = z.object({
  memoryId: z.uuid(),
  memoryVersion: isoDate,
  contributorVersion: isoDate.nullable(),
  changes: z
    .object({
      name: optionalText(120),
      relationship: optionalText(120),
      approxDateText: optionalText(120),
      place: optionalText(200),
      note: z
        .string()
        .max(10_000)
        .transform((value) => (value.trim().length === 0 ? null : value))
        .nullable()
        .optional(),
      visibility: z.enum(["PUBLIC", "FAMILY", "PRIVATE"]).optional(),
      tags: tagsSchema.optional(),
      approxYear: approxYearSchema.optional(),
      approxMonth: approxMonthSchema.optional(),
    })
    .strict()
    // Both sent: a month with a cleared year is refused here; the stored year is checked in the locked update.
    .refine((changes) => !(typeof changes.approxMonth === "number" && changes.approxYear === null), { message: "A month needs a year", path: ["approxMonth"] }),
});
export type AdminMemoryChangesInput = z.infer<typeof adminMemoryChangesSchema>;
export type AdminMemoryChanges = AdminMemoryChangesInput["changes"];

/**
 * The review version an approval vouches for (TCR round 1, B1-3): `reviewVersion` from the admin page or MCP
 * `get_memory`, computed by lib/review-version.ts. Opaque to callers; bounded so a junk value is refused, not hashed.
 */
const reviewVersionSchema = z
  .string()
  .min(1)
  .max(100)
  .describe("`reviewVersion` from get_memory, read just before this call: approving checks the memory, its contributor and its files are exactly what you read");

/** Approving publishes (D1), so APPROVED must say what was read; PENDING and HIDDEN take a memory off and never need it. */
const approvalNeedsVersion = (input: { status: string; reviewVersion?: string }) => input.status !== "APPROVED" || input.reviewVersion !== undefined;
const APPROVAL_NEEDS_VERSION = { message: "APPROVED needs the reviewVersion you read", path: ["reviewVersion"] };

/** The status buttons' fields: never DRAFT (sharing on behalf uses adminShareDraftSchema). */
export const adminStatusObjectSchema = z.object({
  memoryId: z.uuid(),
  status: z.enum(["PENDING", "APPROVED", "HIDDEN"]),
  reviewVersion: reviewVersionSchema.optional(),
});

/** The status buttons, with the APPROVED rule (B1-3). MCP `set_status` uses a strict copy of the same fields and rule. */
export const adminStatusSchema = adminStatusObjectSchema.refine(approvalNeedsVersion, APPROVAL_NEEDS_VERSION);

/** Share on the sender's behalf, only on Rob's explicit word that this sender agreed. */
export const adminShareDraftObjectSchema = z.object({
  memoryId: z.uuid().describe("The DRAFT memory to share on the sender's behalf"),
  memoryVersion: isoDate,
  status: z.enum(["PENDING", "APPROVED"]).describe("The shared status; APPROVED + PUBLIC shows on See memories once the family turns it on"),
  reviewVersion: reviewVersionSchema.optional(),
});

/** Sharing straight to APPROVED publishes too, so it needs the review version like set_status (B1-3). */
export const adminShareDraftSchema = adminShareDraftObjectSchema.refine(approvalNeedsVersion, APPROVAL_NEEDS_VERSION);

/** Apply the APPROVED rule to a strict copy of either object schema (MCP). */
export function withApprovalRule<T extends z.ZodType<{ status: string; reviewVersion?: string }>>(schema: T): T {
  return schema.refine(approvalNeedsVersion, APPROVAL_NEEDS_VERSION);
}
export type AdminShareDraftInput = z.infer<typeof adminShareDraftSchema>;

/**
 * Set or clear a memory's coordinates (MCP `set_coordinates`; features/admin/set-coordinates.ts).
 * `coordinates` must be stated: a pair sets both columns, null clears both.
 */
export const adminCoordinatesSchema = z.object({
  memoryId: z.uuid(),
  memoryVersion: isoDate,
  coordinates: coordinatesSchema.nullable(),
});

export const adminDeletedSchema = z.object({
  memoryId: z.uuid(),
  deleted: z.boolean(),
});

/*
 * The photo tools (MCP `update_media`, `set_media_deleted`, `reorder_media`; plan 2026-11-08-mcp-media-tools §3).
 * Each carries the `memoryVersion` the caller read: a file write moves it (D2), so a caller holding an older one is
 * refused `stale` with the current files.
 */

/** A file's id as `get_memory` lists it in `media` (or `current.media` of a photo tool's answer). */
const mediaIdSchema = z.uuid().describe("The file's `id` from get_memory `media` or from `current.media`");

/** `update_media`: only the per-file words to change, the same limits as upload and the claim page; null clears one. */
export const adminMediaWordsSchema = z.object({
  memoryId: z.uuid(),
  memoryVersion: isoDate,
  mediaId: mediaIdSchema,
  changes: z
    .object(mediaWordsFields)
    .strict()
    // A key present with the value undefined changes nothing, so it does not count (TCR round 1, #3).
    .refine((changes) => Object.values(changes).some((value) => value !== undefined), { message: "Send at least one of caption, approxDateText, place" })
    .describe("Only the words to change: `caption`, `approxDateText` (the file's rough date), `place`; null clears one"),
});
export type AdminMediaWordsInput = z.infer<typeof adminMediaWordsSchema>;

/** `set_media_deleted`: remove a file, or restore one listed in `removedMedia`. */
export const adminMediaDeletedSchema = z.object({
  memoryId: z.uuid(),
  memoryVersion: isoDate,
  mediaId: mediaIdSchema,
  deleted: z.boolean().describe("true removes the file; false restores a file listed in `removedMedia`"),
});

/**
 * Upper bound on `reorder_media`'s list. Not the file cap: the list is every visible file, and FAILED rows left by
 * expired uploads count there although MAX_FILES_PER_MEMORY does not count them (plan D8).
 */
export const MAX_REORDER_IDS = 100;

/** `reorder_media`: every visible file's id, once each, in the new display order. */
export const adminMediaOrderSchema = z.object({
  memoryId: z.uuid(),
  memoryVersion: isoDate,
  mediaIds: z
    .array(z.uuid())
    .min(1)
    .max(MAX_REORDER_IDS)
    .refine((ids) => new Set(ids).size === ids.length, { message: "Each file once" })
    .describe("Every id in `current.media` (or get_memory `media` rows whose `replacesMediaId` is null), FAILED rows included, each once, first to last"),
});

export const adminMemoryIdSchema = z.object({ memoryId: z.uuid() });

/**
 * The draft-on-behalf form. No `source`, `sourceRef` or `phone`: a browser form
 * has no Gmail message id or E.164 number, so every browser draft is `OTHER`
 * with `otherSourceRef(email, note)` (plan §3.5). The note is verbatim.
 */
export const adminDraftFormSchema = z
  .object({
    name: optionalText(120),
    // Trim and lower-case first, then check the format (zod 4's `z.email().trim()` checks the padded string).
    email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address")),
    relationship: optionalText(120),
    note: z.string().max(10_000).refine((value) => value.trim().length > 0, { message: "The note needs some words" }),
    approxDateText: optionalText(120),
    place: optionalText(200),
    visibility: z.enum(["PUBLIC", "FAMILY", "PRIVATE"]).default("PUBLIC"),
  })
  .strict();
export type AdminDraftFormInput = z.infer<typeof adminDraftFormSchema>;

/** The entry step's one parameter: the key from the link's fragment or the paste box. */
export const adminEnterSchema = z.object({ key: z.string().max(256) });

/** A connector upload declares the original bytes before reserving a write-once pathname. */
export const adminRequestUploadSchema = z.object({
  memoryId: z.uuid().describe("The memory to attach this original file to"),
  file: z.object({
    name: z.string().min(1).max(255).describe("Original filename, including its extension"),
    type: z.string().describe("MIME type; an empty or generic type falls back to the filename extension"),
    size: z.number().int().positive().describe("Exact size of the original file on disk, in bytes"),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).describe("Lowercase SHA-256 of the original bytes, computed locally with shasum -a 256"),
  }),
  caption: mediaWordsFields.caption.describe("Optional caption for this file, at most 2000 characters"),
  approxDateText: mediaWordsFields.approxDateText.describe("Optional approximate date for this file, at most 120 characters"),
  place: mediaWordsFields.place.describe("Optional place for this file, at most 200 characters"),
  durationSeconds: z.number().int().nonnegative().max(MAX_DURATION_SECONDS).optional().describe("Optional audio or video duration in whole seconds"),
});

/** Finish the upload by ids; MCP bearer authentication replaces the claim-page ticket. */
export const adminFinalizeUploadSchema = z.object({
  memoryId: z.uuid().describe("The memory passed to request_upload"),
  mediaId: z.uuid().describe("The mediaId returned by request_upload; reuse it when retrying finalize_upload"),
});
