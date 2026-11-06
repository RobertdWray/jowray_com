import { z } from "zod";

import { sourceInputSchema } from "@/lib/source-input";
import { MEMORY_STATUSES } from "@/lib/validations/admin";
import { draftMemoryObjectSchema } from "@/lib/validations/memory";

/**
 * Input schemas for the MCP tools at /api/mcp (plan 2026-11-06 §4.5). The
 * tools are thin adapters over the admin features, so most inputs are the
 * admin schemas re-exported; these two are the MCP's own. The SDK validates
 * arguments against them and the features parse again with their own schemas.
 */

/** `list_memories`: every filter optional (an object schema even when empty, per the MCP spec); unknown keys are refused. */
export const mcpListInputSchema = z
  .object({
    status: z.enum(MEMORY_STATUSES).optional().describe("Only memories in this status"),
    q: z.string().trim().max(100).optional().describe("Case-insensitive search over the words, the place and the contributor's name and email"),
    deleted: z.boolean().optional().describe("true lists the soft-deleted memories instead of the live ones"),
  })
  .strict();

/**
 * `draft_memory`: the admin draft fields with `sourceInput` in place of
 * `source` + `sourceRef`, which the server derives through lib/source-input.ts
 * so no model ever supplies its own hash. Strict at both levels, so a `source`
 * or `sourceRef`, or a mistyped contributor key such as `relation`, is refused
 * rather than silently dropped (review round 1, R2; `.strict()` on the outer
 * object does not reach the nested one). The REST draft schema is unchanged.
 * The source↔prefix refines do not apply here; `draftMemory` re-validates the
 * prepared input with the full schema.
 */
export const mcpDraftInputSchema = draftMemoryObjectSchema
  .omit({ source: true, sourceRef: true })
  .extend({
    contributor: draftMemoryObjectSchema.shape.contributor.strict(),
    sourceInput: sourceInputSchema.describe("Where the words came from; the server turns it into the memory's source reference"),
  })
  .strict();

export { adminCoordinatesSchema, adminDeletedSchema, adminMemoryChangesSchema, adminMemoryIdSchema, adminStatusSchema } from "@/lib/validations/admin";
