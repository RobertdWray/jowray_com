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
