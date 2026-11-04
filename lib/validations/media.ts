import { z } from "zod";

import { memoryFileInputSchema } from "@/lib/validations/memory";

/** A claim-page request that names one of the memory's files. The token is checked against the memory's hash in features/. */
export const claimMediaRefSchema = z.object({
  claimToken: z.string().min(16).max(128),
  mediaId: z.uuid(),
});
export type ClaimMediaRef = z.infer<typeof claimMediaRefSchema>;

/** Replace one file: the reference plus what the browser knows about the new file. */
export const replaceRequestSchema = claimMediaRefSchema.extend({
  file: memoryFileInputSchema,
});
export type ReplaceRequest = z.infer<typeof replaceRequestSchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

/** Edits to one file's own words from the claim page. */
export const mediaChangesSchema = z.object({
  caption: optionalText(2000),
  approxDateText: optionalText(120),
  place: optionalText(200),
});
export type MediaChanges = z.infer<typeof mediaChangesSchema>;
