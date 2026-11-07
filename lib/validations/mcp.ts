import { z } from "zod";

import { sourceInputSchema } from "@/lib/source-input";
import { adminCoordinatesSchema, adminFinalizeUploadSchema, adminRequestUploadSchema, adminDeletedSchema, adminMemoryChangesSchema, adminMemoryIdSchema, adminShareDraftSchema, adminStatusSchema, MEMORY_STATUSES } from "@/lib/validations/admin";
import { draftMemoryObjectSchema } from "@/lib/validations/memory";

/**
 * Input schemas for the MCP tools at /api/mcp (plan 2026-11-06 §4.5). The
 * tools are thin adapters over the admin features, so their inputs are strict
 * copies of the admin schemas or the MCP's own. Every one is strict
 * at the top level, so a mistyped or misplaced key is refused rather than
 * silently dropped. The SDK validates arguments against them and the features
 * parse again with their own schemas.
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

/*
 * Strict copies of the admin schemas behind the other tools (Team Code
 * Review, G2): a `note` beside `changes` instead of inside it, or any key a
 * tool does not take, is a schema refusal instead of a call that quietly
 * ignores it. The admin schemas themselves stay non-strict at the top level:
 * the REST routes and the admin Server Functions share them.
 */

/** `get_memory` and `reissue_claim_link`. */
export const mcpMemoryIdSchema = adminMemoryIdSchema.strict();

/** `set_coordinates`. */
export const mcpCoordinatesSchema = adminCoordinatesSchema.strict();

/** `update_memory` (`changes` is already strict). */
export const mcpMemoryChangesSchema = adminMemoryChangesSchema.strict();

/** `set_status`. */
export const mcpStatusSchema = adminStatusSchema.strict();

/** `share_draft`. */
export const mcpShareDraftSchema = adminShareDraftSchema.strict();

/** `set_deleted`. */
export const mcpDeletedSchema = adminDeletedSchema.strict();

/** `request_upload`: strict at both levels so misplaced metadata is refused. */
export const mcpRequestUploadSchema = adminRequestUploadSchema
  .extend({ file: adminRequestUploadSchema.shape.file.strict() })
  .strict();

/** `finalize_upload`. */
export const mcpFinalizeUploadSchema = adminFinalizeUploadSchema.strict();
