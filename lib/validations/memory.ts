import { z } from "zod";

export const MAX_DURATION_SECONDS = 86_400;

/** What the browser knows about a chosen file or recording. */
export const fileInputSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.string().max(255),
  size: z.number().int().nonnegative(),
  durationSeconds: z.number().int().min(0).max(MAX_DURATION_SECONDS).optional(),
});
export type FileInput = z.infer<typeof fileInputSchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

export const createMemoryInputSchema = z
  .object({
    name: optionalText(120),
    relationship: optionalText(120),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .transform((value) => (value.length === 0 ? null : value))
      .nullable()
      .optional()
      .refine((value) => value === null || value === undefined || z.email().safeParse(value).success, {
        message: "Enter a valid email address",
      }),
    approxDateText: optionalText(120),
    place: optionalText(200),
    note: z.string().max(10_000).optional().nullable(),
    visibility: z.enum(["PUBLIC", "FAMILY", "PRIVATE"]).default("PUBLIC"),
    contactOptIn: z.boolean().default(false),
    mailingListOptIn: z.boolean().default(false),
    notifyWhenPosted: z.boolean().default(true),
    file: fileInputSchema.nullable(),
  })
  .refine((value) => value.file !== null || (value.note ?? "").trim().length > 0, {
    message: "Add a file, a recording, or a few words",
    path: ["note"],
  });
export type CreateMemoryInput = z.infer<typeof createMemoryInputSchema>;

export const uploadTicketRequestSchema = z.object({
  claimToken: z.string().min(16).max(128),
  file: fileInputSchema,
});

/**
 * `Memory.sourceRef`: an opaque, unique reference to where an admin-drafted
 * memory's words came from. Never an address or a number in clear:
 * `gmail:<sender's message id>`, `sms:<32 hex of sha256(E.164|timestamp)>`,
 * `other:<32 hex of sha256(lower-cased email|full original text)>`.
 * The builders live in `lib/source-ref.ts`.
 */
export const SOURCE_REF_PATTERN = /^(?:gmail:[0-9a-f]{8,32}|sms:[0-9a-f]{32}|other:[0-9a-f]{32})$/;

/** What the family admin sends to draft a memory on a sender's behalf (features/memories/draft-memory.ts). */
export const draftMemoryInputSchema = z.object({
  contributor: z.object({
    name: optionalText(120),
    email: z.email("Enter a valid email address").trim().toLowerCase().max(254),
    relationship: optionalText(120),
    phone: z.string().trim().max(40).optional(),
  }),
  // Verbatim: the sender's own paragraphs, never trimmed or rewritten here.
  note: z.string().max(10_000).refine((value) => value.trim().length > 0, { message: "The note needs some words" }),
  approxDateText: optionalText(120),
  place: optionalText(200),
  source: z.enum(["EMAIL", "SMS", "OTHER"]),
  sourceRef: z.string().regex(SOURCE_REF_PATTERN, "sourceRef must follow the gmail:/sms:/other: scheme"),
  visibility: z.enum(["PUBLIC", "FAMILY", "PRIVATE"]).default("PUBLIC"),
});
export type DraftMemoryInput = z.infer<typeof draftMemoryInputSchema>;

/** Admin request to rotate a DRAFT's claim link (features/memories/draft-memory.ts). */
export const reissueClaimLinkSchema = z.object({ memoryId: z.uuid() });
