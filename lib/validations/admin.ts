import { z } from "zod";

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
 * One admin save: only the keys the user changed are present (dirty-field
 * submission), with the two versions the form was opened with. The contributor's
 * email and the person's own preferences are not editable here (plan §3.5), so
 * they are unknown keys and the object is strict.
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
    })
    .strict(),
});
export type AdminMemoryChangesInput = z.infer<typeof adminMemoryChangesSchema>;
export type AdminMemoryChanges = AdminMemoryChangesInput["changes"];

/** The status buttons: never DRAFT (sharing on behalf uses adminShareDraftSchema). */
export const adminStatusSchema = z.object({
  memoryId: z.uuid(),
  status: z.enum(["PENDING", "APPROVED", "HIDDEN"]),
});

/** Share on the sender's behalf, only on Rob's explicit word that this sender agreed. */
export const adminShareDraftSchema = z.object({
  memoryId: z.uuid().describe("The DRAFT memory to share on the sender's behalf"),
  memoryVersion: isoDate,
  status: z.enum(["PENDING", "APPROVED"]).describe("The shared status; APPROVED publishes nothing public yet"),
});
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
