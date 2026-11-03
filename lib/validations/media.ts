import { z } from "zod";

import { fileInputSchema } from "@/lib/validations/memory";

/** A claim-page request that names one of the memory's files. The token is checked against the memory's hash in features/. */
export const claimMediaRefSchema = z.object({
  claimToken: z.string().min(16).max(128),
  mediaId: z.uuid(),
});
export type ClaimMediaRef = z.infer<typeof claimMediaRefSchema>;

/** Replace one file: the reference plus what the browser knows about the new file. */
export const replaceRequestSchema = claimMediaRefSchema.extend({
  file: fileInputSchema,
});
export type ReplaceRequest = z.infer<typeof replaceRequestSchema>;
