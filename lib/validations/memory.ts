import { z } from "zod";

import { MAX_FILES_PER_MEMORY } from "@/lib/media-types";

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

/** A file on the share form: what the browser knows plus the contributor's words for that file (the memory keeps its own). */
export const memoryFileInputSchema = fileInputSchema.extend({
  caption: optionalText(2000),
  approxDateText: optionalText(120),
  place: optionalText(200),
});
export type MemoryFileInput = z.infer<typeof memoryFileInputSchema>;

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
    files: z.array(memoryFileInputSchema).max(MAX_FILES_PER_MEMORY).default([]),
  })
  .refine((value) => value.files.length > 0 || (value.note ?? "").trim().length > 0, {
    message: "Add a file, a recording, or a few words",
    path: ["note"],
  });
export type CreateMemoryInput = z.infer<typeof createMemoryInputSchema>;

export const uploadTicketRequestSchema = z.object({
  claimToken: z.string().min(16).max(128),
  file: memoryFileInputSchema,
});
