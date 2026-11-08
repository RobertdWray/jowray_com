import { z } from "zod";

import { contributorEmailSchema, contributorNameSchema } from "@/lib/validations/memory";

export const MAX_INVITES_PER_BATCH = 200;

export const inviteRowSchema = z.object({
  firstName: contributorNameSchema,
  lastName: z.preprocess(
    (value) => value === undefined || value === null || (typeof value === "string" && value.trim() === "") ? undefined : value,
    contributorNameSchema.optional(),
  ),
  email: contributorEmailSchema,
});

export const createInvitesInputSchema = z.object({
  invites: z.array(inviteRowSchema).min(1).max(MAX_INVITES_PER_BATCH),
  rotate: z.boolean().optional(),
}).superRefine(({ invites }, ctx) => {
  const emails = new Set<string>();
  for (const [index, { email }] of invites.entries()) {
    if (emails.has(email)) {
      ctx.addIssue({ code: "custom", path: ["invites", index, "email"], message: "Duplicate email in this batch" });
    }
    emails.add(email);
  }
});

export type CreateInvitesInput = z.infer<typeof createInvitesInputSchema>;
