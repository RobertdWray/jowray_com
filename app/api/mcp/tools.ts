import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import * as Sentry from "@sentry/nextjs";

import { finalizeUploadAsAdmin, requestUploadAsAdmin } from "@/features/admin/attach-media";
import { getMemoryForAdmin } from "@/features/admin/get-memory";
import { adminStatusCounts, listMemoriesForAdmin } from "@/features/admin/list-memories";
import { setMemoryCoordinatesAsAdmin } from "@/features/admin/set-coordinates";
import { setMemoryDeletedAsAdmin } from "@/features/admin/set-deleted";
import { setMemoryStatusAsAdmin } from "@/features/admin/set-status";
import { shareDraftAsAdmin } from "@/features/admin/share-draft";
import { updateMemoryAsAdmin } from "@/features/admin/update-memory";
import { draftMemory, reissueDraftClaimLink } from "@/features/memories/draft-memory";
import { suggestPlacesForMemory } from "@/features/places/suggest-for-memory";
import { createLogger } from "@/lib/logger";
import { tagIds } from "@/lib/sentry/user";
import { prepareInput } from "@/lib/source-input";
import {
  mcpCoordinatesSchema,
  mcpDeletedSchema,
  mcpDraftInputSchema,
  mcpFinalizeUploadSchema,
  mcpRequestUploadSchema,
  mcpListInputSchema,
  mcpMemoryChangesSchema,
  mcpMemoryIdSchema,
  mcpShareDraftSchema,
  mcpStatusSchema,
} from "@/lib/validations/mcp";

/**
 * The twelve MCP tools (plan 2026-11-06 §4.5, and `suggest_places` from plan
 * 2026-11-06-photo-gps-places B7), each a thin adapter over an admin feature. `registerTools` runs once per request (mcp-handler builds a
 * fresh McpServer for every request), so it only registers: the schemas and
 * the tool definitions below are module constants, and nothing here reads env
 * or touches Prisma until a tool runs.
 *
 * Every result carries the same JSON twice, as `structuredContent` and as a
 * text block. Feature refusals are `isError` results with a `code` the skill
 * acts on. Results never include `claimToken`, `claimTokenHash`, `blobUrl` or
 * `storageKey`: the success payloads are mapped field by field.
 */

const log = createLogger({ category: "api" });

/** The privacy rule for coordinates, repeated in every tool that takes or proposes them. */
const PLACE_RULE =
  "`coordinates` are WGS 84 decimal degrees for the named place (a town, a facility or community campus such as Broadmead, a church, a park, a lake), never a residence or a unit inside a place. Ask Rob before saving them.";

/** The only file allowed to hold the upload credential is the temporary, private curl config. */
const UPLOAD_STEPS =
  'Use original files on disk (a mounted folder in Cowork or Claude Code on Rob\'s Mac), not files pasted into chat. Compute the exact size, MIME type and `shasum -a 256` locally; call request_upload. On `alreadyAttached`, skip the upload; on `uploaded: true`, just call finalize_upload. Otherwise write the returned URL into a mode-600 curl config file (`url = "..."`), then run `curl --disable -sS --fail -X PUT -K <config> -H "content-type: <type>" -H "x-content-type: <type>" --data-binary @<file> --output /dev/null` with exactly the returned headers, delete the config file, and call finalize_upload with memoryId and mediaId. The URL is a credential: never write it into chat, a reply, a log or any other file. The upload host is vercel.com; if this session cannot reach it, run the same steps from Claude Code on Rob\'s Mac. A Live Photo is two files (the HEIC and the MOV) on the same memory; at most 10 files per memory.';

const TOOLS = {
  list_memories: {
    title: "List memories",
    description:
      "Lists memories newest first (200 at most) with each row's coordinates, plus the count in each status. Filter by status, search text, or `deleted: true` for the soft-deleted ones.",
    inputSchema: mcpListInputSchema,
    annotations: { readOnlyHint: true },
  },
  get_memory: {
    title: "Get a memory",
    description:
      "One memory with its contributor, files, coordinates, revision history and emails. `memoryVersion` and `contributor.contributorVersion` are what update_memory and set_coordinates need. Each file's `coordinates` is where the camera was (often a home); never propose it for set_coordinates.",
    inputSchema: mcpMemoryIdSchema,
    annotations: { readOnlyHint: true },
  },
  draft_memory: {
    title: "Draft a memory",
    description: `Saves a DRAFT memory on a sender's behalf and returns its claim link for Rob's reply. Pass \`sourceInput\`, never \`sourceRef\`. A \`duplicate\` error means nothing was saved. ${PLACE_RULE}`,
    inputSchema: mcpDraftInputSchema,
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  set_coordinates: {
    title: "Set a memory's coordinates",
    description: `Sets or clears a memory's coordinates. ${PLACE_RULE} Call get_memory first for \`memoryVersion\`; \`null\` clears both; \`changed: false\` means the pair was already equal. Returns the new \`memoryVersion\` (unchanged when nothing changed): pass it to a following update_memory or set_coordinates instead of re-reading.`,
    inputSchema: mcpCoordinatesSchema,
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  update_memory: {
    title: "Edit a memory",
    description:
      "Edits a memory's words, date, place, visibility or the contributor's name and relationship; send only the keys you change. Read `memoryVersion` and `contributor.contributorVersion` from get_memory first. On `stale`, compare every editable field in `current` with the value you read before this edit: if any differs, including a field you are changing, show Rob what changed and ask before retrying; retry from `current` without asking only when none differs (only the versions moved).",
    inputSchema: mcpMemoryChangesSchema,
    annotations: { destructiveHint: true },
  },
  set_status: {
    title: "Set a memory's status",
    description: "Moves a shared memory between PENDING, APPROVED and HIDDEN. A DRAFT is refused (`draft`); use `share_draft`.",
    inputSchema: mcpStatusSchema,
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  share_draft: {
    title: "Share a draft on the sender's behalf",
    description: "Records the sender's consent and moves a DRAFT to PENDING or APPROVED, with the same consent stamp as the sender's own Share. Call it only when Rob says in this conversation that this named sender agreed; never infer consent from a reply or a message's tone. Read `memoryVersion` from `get_memory` first. On `stale`, re-read and show Rob what changed before asking again. APPROVED publishes nothing public yet (the public memorial pages are not built). No admin alert is sent, now or later. The sender's preferences and claim link are unchanged.",
    inputSchema: mcpShareDraftSchema,
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  request_upload: {
    title: "Request a file upload",
    description: `Reserves one file on a memory without changing its status or consent and without sending email. A non-DRAFT memory with no words or READY file is refused (not_ready). Retry by the same hash for a fresh URL within 24 hours; metadata on an already attached file is ignored. ${UPLOAD_STEPS}`,
    inputSchema: mcpRequestUploadSchema,
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  finalize_upload: {
    title: "Finalize a file upload",
    description: "Call after the PUT succeeds or when `request_upload` answered `uploaded: true`. Verifies the upload and records it once. `PENDING` with `uploaded: false` means call `request_upload` again; `verifying` means retry `finalize_upload` later. `FAILED` reasons are terminal for that row and may be absent on repeat calls. `READY` includes memoryType and GPS found, none, pending or not_applicable. Never sends email or changes the memory's status or consent. See `request_upload` for the upload steps.",
    inputSchema: mcpFinalizeUploadSchema,
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  set_deleted: {
    title: "Delete or restore a memory",
    description: "Soft-deletes (`deleted: true`) or restores (`deleted: false`) a memory. On restore, `purgedFiles` counts files whose bytes are already gone.",
    inputSchema: mcpDeletedSchema,
    annotations: { destructiveHint: true, idempotentHint: true },
  },
  reissue_claim_link: {
    title: "Reissue a draft's claim link",
    description: "Mints a new claim link for a DRAFT. This revokes the link already sent; only on Rob's explicit confirmation.",
    inputSchema: mcpMemoryIdSchema,
    annotations: { destructiveHint: true, idempotentHint: false },
  },
  suggest_places: {
    title: "Suggest places from photos",
    description: `Place names near where each photo was taken, from the GPS saved with the photo (OpenStreetMap). Read-only. Landmark labels carry the place's own point; the photo's point (each photo's \`coordinates\`) is where the camera was. If \`pending\` is non-empty, call again at most twice (results are cached), then tell Rob which photos are still pending. ${PLACE_RULE}`,
    inputSchema: mcpMemoryIdSchema,
    // It changes no memory (only the lookup cache) and asks OpenStreetMap (C27).
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
} as const;

/** The same JSON as structured content and as text (MCP structured-content rule); the round trip turns Dates into ISO strings in both. */
function toolResult(data: object, isError = false): CallToolResult {
  const text = JSON.stringify(data);
  const structuredContent: Record<string, unknown> = JSON.parse(text);
  return { content: [{ type: "text", text }], structuredContent, ...(isError && { isError: true }) };
}

/** A feature's `{ ok: false, code, ...extra }` as an `isError` result, without the `ok` flag. */
function refusal<T extends { ok: false; code: string }>(result: T): CallToolResult {
  const { ok: _ok, ...error } = result;
  return toolResult(error, true);
}

/**
 * The single error boundary. The SDK would turn a thrown error into an
 * `isError` result carrying the raw message (a Prisma or Neon error, file
 * paths included) and nothing would reach Sentry, so every tool catches first:
 * the exception goes to Sentry once, tagged with the tool and the memory id,
 * and the model gets only `{ code: "internal", eventId }`.
 */
async function runTool(tool: keyof typeof TOOLS, memoryId: string | undefined, run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  tagIds({ memoryId });
  try {
    return await run();
  } catch (error) {
    const eventId = Sentry.captureException(error, { mechanism: { type: "mcp.tool", handled: true }, captureContext: { tags: { tool } } });
    log.error({ action: "mcp_tool_failed", tool, memoryId, eventId }, "MCP tool threw");
    return toolResult({ code: "internal", eventId }, true);
  }
}

/** Registers the twelve tools on a fresh server. Called by mcp-handler once per request; registration only. */
export function registerTools(server: McpServer): void {
  // Sentry MCP spans for this server (idempotent; @sentry/nextjs does not wrap McpServer on its own).
  Sentry.wrapMcpServerWithSentry(server);

  server.registerTool("list_memories", TOOLS.list_memories, ({ status, q, deleted }) =>
    runTool("list_memories", undefined, async () => {
      const [list, counts] = await Promise.all([listMemoriesForAdmin({ status, q, deleted: deleted ? "true" : undefined }, { includeCoordinates: true }), adminStatusCounts()]);
      if (!list.ok) {
        return refusal(list);
      }
      return toolResult({ query: list.query, rows: list.rows, shown: list.shown, total: list.total, counts });
    })
  );

  server.registerTool("get_memory", TOOLS.get_memory, ({ memoryId }) =>
    runTool("get_memory", memoryId, async () => {
      const view = await getMemoryForAdmin(memoryId, { includeCoordinates: true });
      return view ? toolResult(view) : toolResult({ code: "not_found" }, true);
    })
  );

  server.registerTool("draft_memory", TOOLS.draft_memory, (args) =>
    runTool("draft_memory", undefined, async () => {
      let prepared: Record<string, unknown>;
      try {
        prepared = prepareInput(args);
      } catch (error) {
        // prepareInput is pure: every throw is a refusal of the input (a bad message id, number, timestamp or email), never an outage.
        return toolResult({ code: "invalid", message: error instanceof Error ? error.message : String(error) }, true);
      }
      const result = await draftMemory(prepared);
      if (!result.ok) {
        return refusal(result);
      }
      tagIds({ memoryId: result.memoryId });
      return toolResult({ memoryId: result.memoryId, claimLink: result.claimLink, originalNoteRecorded: result.originalNoteRecorded });
    })
  );

  server.registerTool("set_coordinates", TOOLS.set_coordinates, (args) =>
    runTool("set_coordinates", args.memoryId, async () => {
      const result = await setMemoryCoordinatesAsAdmin(args);
      return result.ok ? toolResult({ changed: result.changed, memoryVersion: result.memoryVersion }) : refusal(result);
    })
  );

  server.registerTool("update_memory", TOOLS.update_memory, (args) =>
    runTool("update_memory", args.memoryId, async () => {
      const result = await updateMemoryAsAdmin(args);
      return result.ok ? toolResult({ written: result.written, current: result.current }) : refusal(result);
    })
  );

  server.registerTool("set_status", TOOLS.set_status, (args) =>
    runTool("set_status", args.memoryId, async () => {
      const result = await setMemoryStatusAsAdmin(args);
      return result.ok ? toolResult({}) : refusal(result);
    })
  );

  server.registerTool("share_draft", TOOLS.share_draft, (args) =>
    runTool("share_draft", args.memoryId, async () => {
      const result = await shareDraftAsAdmin(args);
      return result.ok ? toolResult({ status: result.status, memoryVersion: result.memoryVersion }) : refusal(result);
    })
  );

  server.registerTool("request_upload", TOOLS.request_upload, (args) =>
    runTool("request_upload", args.memoryId, async () => {
      const result = await requestUploadAsAdmin(args);
      if (!result.ok) { return refusal(result); }
      if (result.status === "READY") {
        return toolResult({ mediaId: result.mediaId, status: result.status, alreadyAttached: result.alreadyAttached, ...(result.metadataIgnored && { metadataIgnored: result.metadataIgnored }) });
      }
      if ("uploaded" in result) {
        return toolResult({ mediaId: result.mediaId, status: result.status, uploaded: result.uploaded });
      }
      return toolResult({ mediaId: result.mediaId, status: result.status, upload: {
        method: result.upload.method,
        presignedUrl: result.upload.presignedUrl,
        headers: result.upload.headers,
        expiresAt: result.upload.expiresAt,
      } });
    })
  );

  server.registerTool("finalize_upload", TOOLS.finalize_upload, (args) =>
    runTool("finalize_upload", args.memoryId, async () => {
      const result = await finalizeUploadAsAdmin(args);
      if (!result.ok) { return refusal(result); }
      if (result.status === "PENDING") {
        return toolResult({ status: result.status, uploaded: result.uploaded, ...(result.verifying && { verifying: result.verifying }) });
      }
      if (result.status === "FAILED") {
        return toolResult({ status: result.status, ...(result.reason !== undefined && { reason: result.reason }) });
      }
      return toolResult({ mediaId: result.mediaId, status: result.status, memoryType: result.memoryType, gps: result.gps });
    })
  );

  server.registerTool("set_deleted", TOOLS.set_deleted, (args) =>
    runTool("set_deleted", args.memoryId, async () => {
      const result = await setMemoryDeletedAsAdmin(args);
      return result.ok ? toolResult({ purgedFiles: result.purgedFiles }) : refusal(result);
    })
  );

  server.registerTool("reissue_claim_link", TOOLS.reissue_claim_link, ({ memoryId }) =>
    runTool("reissue_claim_link", memoryId, async () => {
      const result = await reissueDraftClaimLink({ memoryId });
      return result.ok ? toolResult({ memoryId: result.memoryId, claimLink: result.claimLink }) : refusal(result);
    })
  );

  server.registerTool("suggest_places", TOOLS.suggest_places, ({ memoryId }) =>
    runTool("suggest_places", memoryId, async () => {
      const result = await suggestPlacesForMemory(memoryId);
      return result.ok ? toolResult({ photos: result.photos, pending: result.pending, attribution: result.attribution }) : refusal(result);
    })
  );
}
