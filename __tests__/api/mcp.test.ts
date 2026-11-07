import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/server/config/env";

/**
 * /api/mcp (plan 2026-11-06 §4.5, §4.6): the bearer gate, the ten tools as
 * thin adapters over the admin features, and the single error boundary. The
 * features are mocked; the route, `_auth.ts`, the env accessor, mcp-handler
 * and the MCP SDK are real.
 */

const SECRET = "a".repeat(40);
const ID = "00000000-0000-4000-8000-000000000001";
const VERSION = "2026-11-04T10:00:00.000Z";
/** The raw token a feature returns beside the link; it must never appear in a response. */
const CLAIM_TOKEN = "t".repeat(43);
const CLAIM_LINK = `https://www.jowray.com/m/${"u".repeat(43)}`;
const BROADMEAD = { latitude: 39.4815, longitude: -76.6447 };

const features = vi.hoisted(() => ({
  listMemoriesForAdmin: vi.fn(),
  adminStatusCounts: vi.fn(),
  getMemoryForAdmin: vi.fn(),
  setMemoryCoordinatesAsAdmin: vi.fn(),
  updateMemoryAsAdmin: vi.fn(),
  setMemoryStatusAsAdmin: vi.fn(),
  shareDraftAsAdmin: vi.fn(),
  setMemoryDeletedAsAdmin: vi.fn(),
  draftMemory: vi.fn(),
  reissueDraftClaimLink: vi.fn(),
  suggestPlacesForMemory: vi.fn(),
}));
vi.mock("@/features/admin/list-memories", () => ({ listMemoriesForAdmin: features.listMemoriesForAdmin, adminStatusCounts: features.adminStatusCounts }));
vi.mock("@/features/admin/get-memory", () => ({ getMemoryForAdmin: features.getMemoryForAdmin }));
vi.mock("@/features/admin/set-coordinates", () => ({ setMemoryCoordinatesAsAdmin: features.setMemoryCoordinatesAsAdmin }));
vi.mock("@/features/admin/update-memory", () => ({ updateMemoryAsAdmin: features.updateMemoryAsAdmin }));
vi.mock("@/features/admin/share-draft", () => ({ shareDraftAsAdmin: features.shareDraftAsAdmin }));
vi.mock("@/features/admin/set-status", () => ({ setMemoryStatusAsAdmin: features.setMemoryStatusAsAdmin }));
vi.mock("@/features/admin/set-deleted", () => ({ setMemoryDeletedAsAdmin: features.setMemoryDeletedAsAdmin }));
vi.mock("@/features/memories/draft-memory", () => ({ draftMemory: features.draftMemory, reissueDraftClaimLink: features.reissueDraftClaimLink }));
vi.mock("@/features/places/suggest-for-memory", () => ({ suggestPlacesForMemory: features.suggestPlacesForMemory }));

import { GET, POST } from "@/app/api/mcp/route";

const LEGACY_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

function mcpRequest(body: unknown, headers: Record<string, string> = {}, method = "POST"): NextRequest {
  return new NextRequest("http://localhost:3000/api/mcp", { method, headers: { ...LEGACY_HEADERS, ...headers }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
}

function authed(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(mcpRequest(body, { authorization: `Bearer ${SECRET}`, ...headers }));
}

/** The JSON-RPC message in a response: plain JSON, or the first `data:` line of an SSE stream. */
async function rpcBody(response: Response): Promise<{ result?: Record<string, unknown>; error?: { code: number; message: string } }> {
  const text = await response.text();
  if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const data = text.split("\n").find((line) => line.startsWith("data:"));
    if (!data) {
      throw new Error(`no data line in SSE body: ${text}`);
    }
    return JSON.parse(data.slice("data:".length)) as { result?: Record<string, unknown> };
  }
  return JSON.parse(text) as { result?: Record<string, unknown> };
}

interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<{ status: number; result: ToolCallResult; raw: string }> {
  const response = await authed({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
  const status = response.status;
  const raw = await response.clone().text();
  const body = await rpcBody(response);
  if (!body.result) {
    throw new Error(`tools/call ${name} answered without a result: ${raw}`);
  }
  // Case 6: no response body ever names or carries a claim token (the claim link is the only way a token leaves).
  expect(raw).not.toContain("claimToken");
  expect(raw).not.toContain(CLAIM_TOKEN);
  return { status, result: body.result as unknown as ToolCallResult, raw };
}

beforeEach(() => {
  process.env.MCP_API_SECRET = SECRET;
  resetEnvCache();
  for (const fn of Object.values(features)) {
    fn.mockReset();
  }
});

describe("the bearer gate", () => {
  it("answers a transport 401 with no header, a wrong bearer, an unset or an empty secret, and calls no feature", async () => {
    const list = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_memories", arguments: {} } };
    expect((await POST(mcpRequest(list))).status).toBe(401);
    expect((await POST(mcpRequest(list, { authorization: `Bearer ${"b".repeat(40)}` }))).status).toBe(401);
    expect((await GET(mcpRequest(null, {}, "GET"))).status).toBe(401);
    delete process.env.MCP_API_SECRET;
    resetEnvCache();
    expect((await POST(mcpRequest(list, { authorization: `Bearer ${SECRET}` }))).status).toBe(401);
    process.env.MCP_API_SECRET = "";
    resetEnvCache();
    expect((await POST(mcpRequest(list, { authorization: "Bearer " }))).status).toBe(401);
    for (const fn of Object.values(features)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("does not accept the admin API's secret", async () => {
    process.env.ADMIN_API_SECRET = "c".repeat(40);
    resetEnvCache();
    expect((await POST(mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { authorization: `Bearer ${"c".repeat(40)}` }))).status).toBe(401);
    delete process.env.ADMIN_API_SECRET;
  });

  it("lets an authenticated GET through to the SDK, which refuses it (stateless legacy path)", async () => {
    const response = await GET(mcpRequest(null, { authorization: `Bearer ${SECRET}` }, "GET"));
    expect(response.status).toBe(405);
  });
});

describe("tools/list", () => {
  it("lists the ten tools", async () => {
    const response = await authed({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.status).toBe(200);
    const body = await rpcBody(response);
    const tools = (body.result?.tools ?? []) as Array<{ name: string }>;
    expect(tools.map((t) => t.name).sort()).toEqual(["draft_memory", "get_memory", "list_memories", "reissue_claim_link", "set_coordinates", "set_deleted", "set_status", "share_draft", "suggest_places", "update_memory"]);
  });
});

describe("the error boundary", () => {
  it("turns a feature exception into code internal with a Sentry event id, and never leaks its message", async () => {
    features.getMemoryForAdmin.mockRejectedValueOnce(new Error("ECONNREFUSED /var/task/node_modules/@prisma/client"));
    const { status, result, raw } = await callTool("get_memory", { memoryId: ID });
    expect(status).toBe(200);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ code: "internal", eventId: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
    expect(raw).not.toContain("/var/task");
    expect(raw).not.toContain("ECONNREFUSED");
  });

  it("passes a feature's answer through on success", async () => {
    features.getMemoryForAdmin.mockResolvedValueOnce({ id: ID, place: "Broadmead", coordinates: null });
    const { result } = await callTool("get_memory", { memoryId: ID });
    expect(features.getMemoryForAdmin).toHaveBeenCalledWith(ID, { includeCoordinates: true });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ id: ID, place: "Broadmead", coordinates: null });
  });
});

describe("tools/list contract (case 2)", () => {
  it("pins every tool's name, title, description, annotations and input schema", async () => {
    const body = await rpcBody(await authed({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    const tools = (body.result?.tools ?? []) as Array<Record<string, unknown>>;
    expect(tools.map(({ name, title, description, annotations, inputSchema }) => ({ name, title, description, annotations, inputSchema }))).toMatchInlineSnapshot(`
      [
        {
          "annotations": {
            "readOnlyHint": true,
          },
          "description": "Lists memories newest first (200 at most) with each row's coordinates, plus the count in each status. Filter by status, search text, or \`deleted: true\` for the soft-deleted ones.",
          "inputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "additionalProperties": false,
            "properties": {
              "deleted": {
                "description": "true lists the soft-deleted memories instead of the live ones",
                "type": "boolean",
              },
              "q": {
                "description": "Case-insensitive search over the words, the place and the contributor's name and email",
                "maxLength": 100,
                "type": "string",
              },
              "status": {
                "description": "Only memories in this status",
                "enum": [
                  "DRAFT",
                  "PENDING",
                  "APPROVED",
                  "HIDDEN",
                ],
                "type": "string",
              },
            },
            "type": "object",
          },
          "name": "list_memories",
          "title": "List memories",
        },
        {
          "annotations": {
            "readOnlyHint": true,
          },
          "description": "One memory with its contributor, files, coordinates, revision history and emails. \`memoryVersion\` and \`contributor.contributorVersion\` are what update_memory and set_coordinates need. Each file's \`coordinates\` is where the camera was (often a home); never propose it for set_coordinates.",
          "inputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "additionalProperties": false,
            "properties": {
              "memoryId": {
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
                "type": "string",
              },
            },
            "required": [
              "memoryId",
            ],
            "type": "object",
          },
          "name": "get_memory",
          "title": "Get a memory",
        },
        {
          "annotations": {
            "destructiveHint": false,
            "idempotentHint": true,
          },
          "description": "Saves a DRAFT memory on a sender's behalf and returns its claim link for Rob's reply. Pass \`sourceInput\`, never \`sourceRef\`. A \`duplicate\` error means nothing was saved. \`coordinates\` are WGS 84 decimal degrees for the named place (a town, a facility or community campus such as Broadmead, a church, a park, a lake), never a residence or a unit inside a place. Ask Rob before saving them.",
          "inputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "additionalProperties": false,
            "properties": {
              "approxDateText": {
                "anyOf": [
                  {
                    "maxLength": 120,
                    "type": "string",
                  },
                  {
                    "type": "null",
                  },
                ],
              },
              "contributor": {
                "additionalProperties": false,
                "properties": {
                  "email": {
                    "maxLength": 254,
                    "type": "string",
                  },
                  "name": {
                    "anyOf": [
                      {
                        "maxLength": 120,
                        "type": "string",
                      },
                      {
                        "type": "null",
                      },
                    ],
                  },
                  "phone": {
                    "anyOf": [
                      {
                        "maxLength": 40,
                        "type": "string",
                      },
                      {
                        "type": "null",
                      },
                    ],
                  },
                  "relationship": {
                    "anyOf": [
                      {
                        "maxLength": 120,
                        "type": "string",
                      },
                      {
                        "type": "null",
                      },
                    ],
                  },
                },
                "required": [
                  "email",
                ],
                "type": "object",
              },
              "coordinates": {
                "anyOf": [
                  {
                    "additionalProperties": false,
                    "properties": {
                      "latitude": {
                        "description": "WGS 84 decimal degrees, -90 to 90",
                        "maximum": 90,
                        "minimum": -90,
                        "type": "number",
                      },
                      "longitude": {
                        "description": "WGS 84 decimal degrees, -180 to 180",
                        "maximum": 180,
                        "minimum": -180,
                        "type": "number",
                      },
                    },
                    "required": [
                      "latitude",
                      "longitude",
                    ],
                    "type": "object",
                  },
                  {
                    "type": "null",
                  },
                ],
              },
              "note": {
                "maxLength": 10000,
                "type": "string",
              },
              "originalNote": {
                "maxLength": 10000,
                "type": "string",
              },
              "place": {
                "anyOf": [
                  {
                    "maxLength": 200,
                    "type": "string",
                  },
                  {
                    "type": "null",
                  },
                ],
              },
              "sourceInput": {
                "description": "Where the words came from; the server turns it into the memory's source reference",
                "oneOf": [
                  {
                    "additionalProperties": false,
                    "properties": {
                      "kind": {
                        "const": "gmail",
                        "description": "The words came in an email in Rob's Gmail",
                        "type": "string",
                      },
                      "messageId": {
                        "description": "Gmail id of the sender's message that holds the words (8 to 32 hex characters), not the thread id",
                        "minLength": 1,
                        "type": "string",
                      },
                    },
                    "required": [
                      "kind",
                      "messageId",
                    ],
                    "type": "object",
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "kind": {
                        "const": "sms",
                        "description": "The words came in a text message",
                        "type": "string",
                      },
                      "number": {
                        "description": "Sender's number in E.164, for example +14105551234",
                        "minLength": 1,
                        "type": "string",
                      },
                      "sentAt": {
                        "description": "When the text was sent, ISO-8601 with an explicit zone or offset, for example 2026-11-03T14:05-04:00",
                        "minLength": 1,
                        "type": "string",
                      },
                      "text": {
                        "description": "The full text of the message, as received",
                        "minLength": 1,
                        "type": "string",
                      },
                    },
                    "required": [
                      "kind",
                      "number",
                      "sentAt",
                      "text",
                    ],
                    "type": "object",
                  },
                  {
                    "additionalProperties": false,
                    "properties": {
                      "email": {
                        "description": "Sender's email address; defaults to contributor.email and must match it",
                        "minLength": 1,
                        "type": "string",
                      },
                      "kind": {
                        "const": "other",
                        "description": "Anything else, for example a card or a message passed on by hand",
                        "type": "string",
                      },
                      "originalText": {
                        "description": "The full original message text, not the excerpt",
                        "minLength": 1,
                        "type": "string",
                      },
                    },
                    "required": [
                      "kind",
                      "originalText",
                    ],
                    "type": "object",
                  },
                ],
              },
              "visibility": {
                "default": "PUBLIC",
                "enum": [
                  "PUBLIC",
                  "FAMILY",
                  "PRIVATE",
                ],
                "type": "string",
              },
            },
            "required": [
              "contributor",
              "note",
              "sourceInput",
            ],
            "type": "object",
          },
          "name": "draft_memory",
          "title": "Draft a memory",
        },
        {
          "annotations": {
            "destructiveHint": true,
            "idempotentHint": true,
          },
          "description": "Sets or clears a memory's coordinates. \`coordinates\` are WGS 84 decimal degrees for the named place (a town, a facility or community campus such as Broadmead, a church, a park, a lake), never a residence or a unit inside a place. Ask Rob before saving them. Call get_memory first for \`memoryVersion\`; \`null\` clears both; \`changed: false\` means the pair was already equal. Returns the new \`memoryVersion\` (unchanged when nothing changed): pass it to a following update_memory or set_coordinates instead of re-reading.",
          "inputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "additionalProperties": false,
            "properties": {
              "coordinates": {
                "anyOf": [
                  {
                    "additionalProperties": false,
                    "properties": {
                      "latitude": {
                        "description": "WGS 84 decimal degrees, -90 to 90",
                        "maximum": 90,
                        "minimum": -90,
                        "type": "number",
                      },
                      "longitude": {
                        "description": "WGS 84 decimal degrees, -180 to 180",
                        "maximum": 180,
                        "minimum": -180,
                        "type": "number",
                      },
                    },
                    "required": [
                      "latitude",
                      "longitude",
                    ],
                    "type": "object",
                  },
                  {
                    "type": "null",
                  },
                ],
              },
              "memoryId": {
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
                "type": "string",
              },
              "memoryVersion": {
                "description": "ISO-8601 timestamp exactly as get_memory returned it",
                "type": "string",
              },
            },
            "required": [
              "memoryId",
              "memoryVersion",
              "coordinates",
            ],
            "type": "object",
          },
          "name": "set_coordinates",
          "title": "Set a memory's coordinates",
        },
        {
          "annotations": {
            "destructiveHint": true,
          },
          "description": "Edits a memory's words, date, place, visibility or the contributor's name and relationship; send only the keys you change. Read \`memoryVersion\` and \`contributor.contributorVersion\` from get_memory first. On \`stale\`, compare every editable field in \`current\` with the value you read before this edit: if any differs, including a field you are changing, show Rob what changed and ask before retrying; retry from \`current\` without asking only when none differs (only the versions moved).",
          "inputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "additionalProperties": false,
            "properties": {
              "changes": {
                "additionalProperties": false,
                "properties": {
                  "approxDateText": {
                    "anyOf": [
                      {
                        "maxLength": 120,
                        "type": "string",
                      },
                      {
                        "type": "null",
                      },
                    ],
                  },
                  "name": {
                    "anyOf": [
                      {
                        "maxLength": 120,
                        "type": "string",
                      },
                      {
                        "type": "null",
                      },
                    ],
                  },
                  "note": {
                    "anyOf": [
                      {
                        "maxLength": 10000,
                        "type": "string",
                      },
                      {
                        "type": "null",
                      },
                    ],
                  },
                  "place": {
                    "anyOf": [
                      {
                        "maxLength": 200,
                        "type": "string",
                      },
                      {
                        "type": "null",
                      },
                    ],
                  },
                  "relationship": {
                    "anyOf": [
                      {
                        "maxLength": 120,
                        "type": "string",
                      },
                      {
                        "type": "null",
                      },
                    ],
                  },
                  "visibility": {
                    "enum": [
                      "PUBLIC",
                      "FAMILY",
                      "PRIVATE",
                    ],
                    "type": "string",
                  },
                },
                "type": "object",
              },
              "contributorVersion": {
                "anyOf": [
                  {
                    "description": "ISO-8601 timestamp exactly as get_memory returned it",
                    "type": "string",
                  },
                  {
                    "type": "null",
                  },
                ],
              },
              "memoryId": {
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
                "type": "string",
              },
              "memoryVersion": {
                "description": "ISO-8601 timestamp exactly as get_memory returned it",
                "type": "string",
              },
            },
            "required": [
              "memoryId",
              "memoryVersion",
              "contributorVersion",
              "changes",
            ],
            "type": "object",
          },
          "name": "update_memory",
          "title": "Edit a memory",
        },
        {
          "annotations": {
            "destructiveHint": true,
            "idempotentHint": true,
          },
          "description": "Moves a shared memory between PENDING, APPROVED and HIDDEN. A DRAFT is refused (\`draft\`); use \`share_draft\`.",
          "inputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "additionalProperties": false,
            "properties": {
              "memoryId": {
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
                "type": "string",
              },
              "status": {
                "enum": [
                  "PENDING",
                  "APPROVED",
                  "HIDDEN",
                ],
                "type": "string",
              },
            },
            "required": [
              "memoryId",
              "status",
            ],
            "type": "object",
          },
          "name": "set_status",
          "title": "Set a memory's status",
        },
        {
          "annotations": {
            "destructiveHint": true,
            "idempotentHint": true,
          },
          "description": "Records the sender's consent and moves a DRAFT to PENDING or APPROVED, with the same consent stamp as the sender's own Share. Call it only when Rob says in this conversation that this named sender agreed; never infer consent from a reply or a message's tone. Read \`memoryVersion\` from \`get_memory\` first. On \`stale\`, re-read and show Rob what changed before asking again. APPROVED publishes nothing public yet (the public memorial pages are not built). No admin alert is sent, now or later. The sender's preferences and claim link are unchanged.",
          "inputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "additionalProperties": false,
            "properties": {
              "memoryId": {
                "description": "The DRAFT memory to share on the sender's behalf",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
                "type": "string",
              },
              "memoryVersion": {
                "description": "ISO-8601 timestamp exactly as get_memory returned it",
                "type": "string",
              },
              "status": {
                "description": "The shared status; APPROVED publishes nothing public yet",
                "enum": [
                  "PENDING",
                  "APPROVED",
                ],
                "type": "string",
              },
            },
            "required": [
              "memoryId",
              "memoryVersion",
              "status",
            ],
            "type": "object",
          },
          "name": "share_draft",
          "title": "Share a draft on the sender's behalf",
        },
        {
          "annotations": {
            "destructiveHint": true,
            "idempotentHint": true,
          },
          "description": "Soft-deletes (\`deleted: true\`) or restores (\`deleted: false\`) a memory. On restore, \`purgedFiles\` counts files whose bytes are already gone.",
          "inputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "additionalProperties": false,
            "properties": {
              "deleted": {
                "type": "boolean",
              },
              "memoryId": {
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
                "type": "string",
              },
            },
            "required": [
              "memoryId",
              "deleted",
            ],
            "type": "object",
          },
          "name": "set_deleted",
          "title": "Delete or restore a memory",
        },
        {
          "annotations": {
            "destructiveHint": true,
            "idempotentHint": false,
          },
          "description": "Mints a new claim link for a DRAFT. This revokes the link already sent; only on Rob's explicit confirmation.",
          "inputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "additionalProperties": false,
            "properties": {
              "memoryId": {
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
                "type": "string",
              },
            },
            "required": [
              "memoryId",
            ],
            "type": "object",
          },
          "name": "reissue_claim_link",
          "title": "Reissue a draft's claim link",
        },
        {
          "annotations": {
            "openWorldHint": true,
            "readOnlyHint": true,
          },
          "description": "Place names near where each photo was taken, from the GPS saved with the photo (OpenStreetMap). Read-only. Landmark labels carry the place's own point; the photo's point (each photo's \`coordinates\`) is where the camera was. If \`pending\` is non-empty, call again at most twice (results are cached), then tell Rob which photos are still pending. \`coordinates\` are WGS 84 decimal degrees for the named place (a town, a facility or community campus such as Broadmead, a church, a park, a lake), never a residence or a unit inside a place. Ask Rob before saving them.",
          "inputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "additionalProperties": false,
            "properties": {
              "memoryId": {
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
                "type": "string",
              },
            },
            "required": [
              "memoryId",
            ],
            "type": "object",
          },
          "name": "suggest_places",
          "title": "Suggest places from photos",
        },
      ]
    `);
  });
});

/** One row of the §4.5 result contract: the feature's answer and what the model must receive. */
interface ContractRow {
  tool: string;
  args: Record<string, unknown>;
  feature: keyof typeof features;
  answer: unknown;
  expected: Record<string, unknown>;
  isError?: true;
}

const memoryArgs = { memoryId: ID };
const coordinateArgs = { memoryId: ID, memoryVersion: VERSION, coordinates: BROADMEAD };
const shareArgs = { memoryId: ID, memoryVersion: VERSION, status: "PENDING" };
const changeArgs = { memoryId: ID, memoryVersion: VERSION, contributorVersion: VERSION, changes: { place: "Broadmead" } };
const draftArgs = {
  contributor: { name: "Joyce Gilley", email: "joyce@example.com", relationship: "Friend from church" },
  note: "Jo always had a kind word.",
  place: "Broadmead, Cockeysville",
  visibility: "FAMILY",
  coordinates: BROADMEAD,
  sourceInput: { kind: "gmail", messageId: "1a1a2317fba34eec" },
};
const editable = { name: "Joyce", relationship: "friend", approxDateText: null, place: "Broadmead", note: "words", visibility: "FAMILY", memoryVersion: VERSION, contributorVersion: VERSION };
/** suggest_places (plan 2026-11-06-photo-gps-places B7): a photo's point, its labels (a landmark carries the place's own point), the pending ids and the credit. */
const PHOTO_ID = "00000000-0000-4000-8000-0000000000a1";
const OSM = "© OpenStreetMap contributors";
const suggestion = {
  photos: [
    {
      mediaId: PHOTO_ID,
      originalFilename: "IMG_1.jpg",
      coordinates: { latitude: 40.689247, longitude: -74.044502 },
      labels: [
        { text: "Statue of Liberty, New York, New York", kind: "landmark", point: { latitude: 40.6892532, longitude: -74.0445482 } },
        { text: "New York, New York", kind: "town" },
      ],
    },
  ],
  pending: [],
  attribution: OSM,
};

const CONTRACT: ContractRow[] = [
  { tool: "list_memories", args: {}, feature: "listMemoriesForAdmin", answer: { ok: false, code: "invalid" }, expected: { code: "invalid" }, isError: true },
  { tool: "get_memory", args: memoryArgs, feature: "getMemoryForAdmin", answer: { id: ID, place: "Broadmead", coordinates: BROADMEAD }, expected: { id: ID, place: "Broadmead", coordinates: BROADMEAD } },
  { tool: "get_memory", args: memoryArgs, feature: "getMemoryForAdmin", answer: null, expected: { code: "not_found" }, isError: true },
  { tool: "draft_memory", args: draftArgs, feature: "draftMemory", answer: { ok: true, memoryId: ID, claimToken: CLAIM_TOKEN, claimLink: CLAIM_LINK, originalNoteRecorded: false }, expected: { memoryId: ID, claimLink: CLAIM_LINK, originalNoteRecorded: false } },
  { tool: "draft_memory", args: draftArgs, feature: "draftMemory", answer: { ok: false, code: "invalid", message: "The note needs some words" }, expected: { code: "invalid", message: "The note needs some words" }, isError: true },
  { tool: "draft_memory", args: draftArgs, feature: "draftMemory", answer: { ok: false, code: "duplicate", memoryId: ID, status: "PENDING" }, expected: { code: "duplicate", memoryId: ID, status: "PENDING" }, isError: true },
  { tool: "draft_memory", args: draftArgs, feature: "draftMemory", answer: { ok: false, code: "budget_exceeded" }, expected: { code: "budget_exceeded" }, isError: true },
  { tool: "set_coordinates", args: coordinateArgs, feature: "setMemoryCoordinatesAsAdmin", answer: { ok: true, changed: true, memoryVersion: "2026-11-04T10:00:01.000Z" }, expected: { changed: true, memoryVersion: "2026-11-04T10:00:01.000Z" } },
  { tool: "set_coordinates", args: { ...coordinateArgs, coordinates: null }, feature: "setMemoryCoordinatesAsAdmin", answer: { ok: true, changed: false, memoryVersion: VERSION }, expected: { changed: false, memoryVersion: VERSION } },
  { tool: "set_coordinates", args: coordinateArgs, feature: "setMemoryCoordinatesAsAdmin", answer: { ok: false, code: "invalid" }, expected: { code: "invalid" }, isError: true },
  { tool: "set_coordinates", args: coordinateArgs, feature: "setMemoryCoordinatesAsAdmin", answer: { ok: false, code: "not_found" }, expected: { code: "not_found" }, isError: true },
  {
    tool: "set_coordinates",
    args: coordinateArgs,
    feature: "setMemoryCoordinatesAsAdmin",
    answer: { ok: false, code: "stale", current: { memoryVersion: "2026-11-04T11:00:00.000Z", coordinates: null } },
    expected: { code: "stale", current: { memoryVersion: "2026-11-04T11:00:00.000Z", coordinates: null } },
    isError: true,
  },
  { tool: "update_memory", args: changeArgs, feature: "updateMemoryAsAdmin", answer: { ok: true, written: ["place"], current: editable }, expected: { written: ["place"], current: editable } },
  { tool: "update_memory", args: changeArgs, feature: "updateMemoryAsAdmin", answer: { ok: false, code: "invalid" }, expected: { code: "invalid" }, isError: true },
  { tool: "update_memory", args: changeArgs, feature: "updateMemoryAsAdmin", answer: { ok: false, code: "not_found" }, expected: { code: "not_found" }, isError: true },
  { tool: "update_memory", args: changeArgs, feature: "updateMemoryAsAdmin", answer: { ok: false, code: "last_words" }, expected: { code: "last_words" }, isError: true },
  { tool: "update_memory", args: changeArgs, feature: "updateMemoryAsAdmin", answer: { ok: false, code: "stale", current: editable }, expected: { code: "stale", current: editable }, isError: true },
  { tool: "set_status", args: { memoryId: ID, status: "APPROVED" }, feature: "setMemoryStatusAsAdmin", answer: { ok: true }, expected: {} },
  { tool: "set_status", args: { memoryId: ID, status: "APPROVED" }, feature: "setMemoryStatusAsAdmin", answer: { ok: false, code: "invalid" }, expected: { code: "invalid" }, isError: true },
  { tool: "set_status", args: { memoryId: ID, status: "APPROVED" }, feature: "setMemoryStatusAsAdmin", answer: { ok: false, code: "not_found" }, expected: { code: "not_found" }, isError: true },
  { tool: "set_status", args: { memoryId: ID, status: "APPROVED" }, feature: "setMemoryStatusAsAdmin", answer: { ok: false, code: "draft" }, expected: { code: "draft" }, isError: true },
  { tool: "share_draft", args: shareArgs, feature: "shareDraftAsAdmin", answer: { ok: true, status: "PENDING", memoryVersion: "2026-11-07T03:00:00.000Z" }, expected: { status: "PENDING", memoryVersion: "2026-11-07T03:00:00.000Z" } },
  { tool: "share_draft", args: { ...shareArgs, status: "APPROVED" }, feature: "shareDraftAsAdmin", answer: { ok: true, status: "APPROVED", memoryVersion: "2026-11-07T03:00:00.000Z" }, expected: { status: "APPROVED", memoryVersion: "2026-11-07T03:00:00.000Z" } },
  { tool: "share_draft", args: shareArgs, feature: "shareDraftAsAdmin", answer: { ok: false, code: "invalid" }, expected: { code: "invalid" }, isError: true },
  { tool: "share_draft", args: shareArgs, feature: "shareDraftAsAdmin", answer: { ok: false, code: "not_found" }, expected: { code: "not_found" }, isError: true },
  { tool: "share_draft", args: shareArgs, feature: "shareDraftAsAdmin", answer: { ok: false, code: "not_draft" }, expected: { code: "not_draft" }, isError: true },
  { tool: "share_draft", args: shareArgs, feature: "shareDraftAsAdmin", answer: { ok: false, code: "stale", current: { memoryVersion: "2026-11-07T03:00:00.000Z", status: "DRAFT" } }, expected: { code: "stale", current: { memoryVersion: "2026-11-07T03:00:00.000Z", status: "DRAFT" } }, isError: true },
  { tool: "set_deleted", args: { memoryId: ID, deleted: false }, feature: "setMemoryDeletedAsAdmin", answer: { ok: true, purgedFiles: 2 }, expected: { purgedFiles: 2 } },
  { tool: "set_deleted", args: { memoryId: ID, deleted: true }, feature: "setMemoryDeletedAsAdmin", answer: { ok: false, code: "invalid" }, expected: { code: "invalid" }, isError: true },
  { tool: "set_deleted", args: { memoryId: ID, deleted: true }, feature: "setMemoryDeletedAsAdmin", answer: { ok: false, code: "not_found" }, expected: { code: "not_found" }, isError: true },
  { tool: "reissue_claim_link", args: memoryArgs, feature: "reissueDraftClaimLink", answer: { ok: true, memoryId: ID, claimLink: CLAIM_LINK }, expected: { memoryId: ID, claimLink: CLAIM_LINK } },
  { tool: "reissue_claim_link", args: memoryArgs, feature: "reissueDraftClaimLink", answer: { ok: false, code: "invalid" }, expected: { code: "invalid" }, isError: true },
  { tool: "reissue_claim_link", args: memoryArgs, feature: "reissueDraftClaimLink", answer: { ok: false, code: "not_found" }, expected: { code: "not_found" }, isError: true },
  { tool: "reissue_claim_link", args: memoryArgs, feature: "reissueDraftClaimLink", answer: { ok: false, code: "not_draft" }, expected: { code: "not_draft" }, isError: true },
  { tool: "suggest_places", args: memoryArgs, feature: "suggestPlacesForMemory", answer: { ok: true, ...suggestion }, expected: suggestion },
  { tool: "suggest_places", args: memoryArgs, feature: "suggestPlacesForMemory", answer: { ok: true, photos: [], pending: [PHOTO_ID], attribution: OSM }, expected: { photos: [], pending: [PHOTO_ID], attribution: OSM } },
  { tool: "suggest_places", args: memoryArgs, feature: "suggestPlacesForMemory", answer: { ok: false, code: "not_found" }, expected: { code: "not_found" }, isError: true },
  { tool: "suggest_places", args: memoryArgs, feature: "suggestPlacesForMemory", answer: { ok: false, code: "disabled" }, expected: { code: "disabled" }, isError: true },
  { tool: "suggest_places", args: memoryArgs, feature: "suggestPlacesForMemory", answer: { ok: false, code: "daily_limit" }, expected: { code: "daily_limit" }, isError: true },
  { tool: "suggest_places", args: memoryArgs, feature: "suggestPlacesForMemory", answer: { ok: false, code: "provider_refused" }, expected: { code: "provider_refused" }, isError: true },
];

describe("the result contract (case 3: every row of plan §4.5)", () => {
  it.each(CONTRACT.map((row) => [`${row.tool} → ${row.isError ? `isError ${String(row.expected.code)}` : "ok"}`, row] as const))("%s", async (_label, row) => {
    features[row.feature].mockResolvedValueOnce(row.answer);
    const { status, result } = await callTool(row.tool, row.args);
    expect(status).toBe(200);
    expect(result.isError).toBe(row.isError);
    expect(result.structuredContent).toEqual(row.expected);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
    expect(JSON.parse(result.content[0]!.text)).toEqual(row.expected);
  });

  it("list_memories returns rows with coordinates and the status counts, and maps the filters for the feature", async () => {
    const list = { ok: true, query: { status: "DRAFT", q: "Joyce", deleted: true }, rows: [{ id: ID, excerpt: "words", coordinates: BROADMEAD }], shown: 1, total: 1 };
    const counts = { DRAFT: 1, PENDING: 0, APPROVED: 0, HIDDEN: 0, deleted: 0, total: 1 };
    features.listMemoriesForAdmin.mockResolvedValueOnce(list);
    features.adminStatusCounts.mockResolvedValueOnce(counts);
    const { result } = await callTool("list_memories", { status: "DRAFT", q: "Joyce", deleted: true });
    expect(features.listMemoriesForAdmin).toHaveBeenCalledWith({ status: "DRAFT", q: "Joyce", deleted: "true" }, { includeCoordinates: true });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ query: list.query, rows: list.rows, shown: 1, total: 1, counts });
    // deleted: false means the live rows, which the feature reads as an absent toggle.
    features.listMemoriesForAdmin.mockResolvedValueOnce({ ...list, query: {} });
    features.adminStatusCounts.mockResolvedValueOnce(counts);
    await callTool("list_memories", { deleted: false });
    expect(features.listMemoriesForAdmin).toHaveBeenLastCalledWith({ status: undefined, q: undefined, deleted: undefined }, { includeCoordinates: true });
  });

  it("draft_memory derives source and sourceRef on the server and passes everything else through", async () => {
    features.draftMemory.mockResolvedValueOnce({ ok: true, memoryId: ID, claimToken: CLAIM_TOKEN, claimLink: CLAIM_LINK, originalNoteRecorded: false });
    await callTool("draft_memory", draftArgs);
    const prepared = features.draftMemory.mock.calls[0]![0] as Record<string, unknown>;
    expect(prepared).not.toHaveProperty("sourceInput");
    expect(prepared).toMatchObject({ source: "EMAIL", sourceRef: "gmail:1a1a2317fba34eec", coordinates: BROADMEAD, place: "Broadmead, Cockeysville", visibility: "FAMILY", note: draftArgs.note });
  });

  it("set_coordinates, update_memory, set_status, set_deleted and reissue_claim_link hand the feature the validated arguments", async () => {
    features.setMemoryCoordinatesAsAdmin.mockResolvedValueOnce({ ok: true, changed: true, memoryVersion: VERSION });
    await callTool("set_coordinates", coordinateArgs);
    expect(features.setMemoryCoordinatesAsAdmin).toHaveBeenCalledWith(coordinateArgs);
    features.updateMemoryAsAdmin.mockResolvedValueOnce({ ok: true, written: [], current: editable });
    await callTool("update_memory", changeArgs);
    expect(features.updateMemoryAsAdmin).toHaveBeenCalledWith(changeArgs);
    features.setMemoryStatusAsAdmin.mockResolvedValueOnce({ ok: true });
    await callTool("set_status", { memoryId: ID, status: "HIDDEN" });
    expect(features.setMemoryStatusAsAdmin).toHaveBeenCalledWith({ memoryId: ID, status: "HIDDEN" });
    features.setMemoryDeletedAsAdmin.mockResolvedValueOnce({ ok: true, purgedFiles: 0 });
    await callTool("set_deleted", { memoryId: ID, deleted: true });
    expect(features.setMemoryDeletedAsAdmin).toHaveBeenCalledWith({ memoryId: ID, deleted: true });
    features.reissueDraftClaimLink.mockResolvedValueOnce({ ok: true, memoryId: ID, claimLink: CLAIM_LINK });
    await callTool("reissue_claim_link", memoryArgs);
    expect(features.reissueDraftClaimLink).toHaveBeenCalledWith(memoryArgs);
    features.suggestPlacesForMemory.mockResolvedValueOnce({ ok: true, ...suggestion });
    await callTool("suggest_places", memoryArgs);
    expect(features.suggestPlacesForMemory).toHaveBeenCalledWith(ID);
  });
});

describe("share_draft arguments (A1, A2)", () => {
  it("hands the feature the validated version and target status", async () => {
    features.shareDraftAsAdmin.mockResolvedValueOnce({ ok: true, status: "PENDING", memoryVersion: VERSION });
    await callTool("share_draft", shareArgs);
    expect(features.shareDraftAsAdmin).toHaveBeenCalledExactlyOnceWith(shareArgs);
  });

  it.each([
    { ...shareArgs, status: "HIDDEN" },
    { ...shareArgs, status: "DRAFT" },
    { ...shareArgs, memoryVersion: "yesterday" },
    { memoryId: ID, status: "PENDING" },
    { ...shareArgs, memoryId: "not-a-uuid" },
    { ...shareArgs, contactOptIn: true },
  ])("refuses invalid or extra fields before the feature (%j)", async (args) => {
    const { result } = await callTool("share_draft", args);
    expect(result.isError).toBe(true);
    expect(features.shareDraftAsAdmin).not.toHaveBeenCalled();
  });
});

describe("the error boundary on every tool (case 4)", () => {
  const VALID_ARGS: Array<[string, Record<string, unknown>, keyof typeof features]> = [
    ["list_memories", {}, "listMemoriesForAdmin"],
    ["get_memory", memoryArgs, "getMemoryForAdmin"],
    ["draft_memory", draftArgs, "draftMemory"],
    ["set_coordinates", coordinateArgs, "setMemoryCoordinatesAsAdmin"],
    ["update_memory", changeArgs, "updateMemoryAsAdmin"],
    ["set_status", { memoryId: ID, status: "PENDING" }, "setMemoryStatusAsAdmin"],
    ["share_draft", shareArgs, "shareDraftAsAdmin"],
    ["set_deleted", { memoryId: ID, deleted: true }, "setMemoryDeletedAsAdmin"],
    ["reissue_claim_link", memoryArgs, "reissueDraftClaimLink"],
    ["suggest_places", memoryArgs, "suggestPlacesForMemory"],
  ];

  it.each(VALID_ARGS)("%s answers internal with an event id when its feature throws", async (tool, args, feature) => {
    features[feature].mockRejectedValueOnce(new Error("ECONNREFUSED /var/task/node_modules/@prisma/client"));
    features.adminStatusCounts.mockResolvedValue({ DRAFT: 0, PENDING: 0, APPROVED: 0, HIDDEN: 0, deleted: 0, total: 0 });
    const { status, result, raw } = await callTool(tool, args);
    expect(status).toBe(200);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ code: "internal", eventId: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(raw).not.toMatch(/ECONNREFUSED|\/var\/task|prisma/);
  });
});

describe("schema refusals and prepareInput refusals (case 5)", () => {
  it("refuses a hand-built source + sourceRef with a schema isError (200, not 400) and never calls the feature", async () => {
    const { sourceInput: _sourceInput, ...withoutSourceInput } = draftArgs;
    for (const args of [
      { ...withoutSourceInput, source: "EMAIL", sourceRef: "gmail:1a1a2317fba34eec" },
      { ...draftArgs, source: "EMAIL", sourceRef: "gmail:1a1a2317fba34eec" },
    ]) {
      const { status, result } = await callTool("draft_memory", args);
      expect(status).toBe(200);
      expect(result.isError).toBe(true);
    }
    expect(features.draftMemory).not.toHaveBeenCalled();
  });

  it("refuses an unknown contributor key instead of dropping it (a typo would save the draft without that detail; review R2)", async () => {
    for (const contributor of [
      { ...draftArgs.contributor, relation: "Friend from church" },
      { email: "joyce@example.com", relationship: "Friend", phoneNumber: "+14105551234" },
    ]) {
      const { status, result } = await callTool("draft_memory", { ...draftArgs, contributor });
      expect(status).toBe(200);
      expect(result.isError).toBe(true);
    }
    expect(features.draftMemory).not.toHaveBeenCalled();
  });

  it("refuses arguments outside a tool's schema the same way (out-of-range coordinates, a non-uuid id, DRAFT as a status)", async () => {
    for (const [tool, args] of [
      ["set_coordinates", { ...coordinateArgs, coordinates: { latitude: 91, longitude: 0 } }],
      ["get_memory", { memoryId: "mem_1" }],
      ["set_status", { memoryId: ID, status: "DRAFT" }],
      ["suggest_places", { memoryId: "mem_1" }],
    ] as const) {
      const { status, result } = await callTool(tool, args);
      expect(status, tool).toBe(200);
      expect(result.isError, tool).toBe(true);
    }
    for (const fn of Object.values(features)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("refuses an unknown top-level key on every tool instead of dropping it (Team Code Review G2)", async () => {
    // One plausible model mistake per tool: a key at the wrong level or one the tool does not take.
    for (const [tool, args, key] of [
      ["list_memories", { status: "DRAFT", limit: 5 }, "limit"],
      ["get_memory", { ...memoryArgs, includeCoordinates: false }, "includeCoordinates"],
      ["draft_memory", { ...draftArgs, phone: "+14105551234" }, "phone"],
      ["set_coordinates", { ...coordinateArgs, place: "Broadmead" }, "place"],
      ["update_memory", { ...changeArgs, note: "words beside changes instead of inside it" }, "note"],
      ["set_status", { memoryId: ID, status: "APPROVED", reason: "family asked" }, "reason"],
      ["set_deleted", { memoryId: ID, deleted: true, purge: true }, "purge"],
      ["reissue_claim_link", { ...memoryArgs, confirmed: true }, "confirmed"],
      ["suggest_places", { ...memoryArgs, coordinates: { latitude: 40.689247, longitude: -74.044502 } }, "coordinates"],
    ] as const) {
      const { status, result } = await callTool(tool, args);
      expect(status, tool).toBe(200);
      expect(result.isError, tool).toBe(true);
      expect(result.structuredContent, tool).toBeUndefined();
      expect(result.content[0]!.text, tool).toContain("Input validation error");
      expect(result.content[0]!.text, tool).toContain(key);
    }
    for (const fn of Object.values(features)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("refuses arguments with more than 1000 elements before the schema runs (maxToolInputElements; Team Code Review G3, GHSA-46jr-4wx8-v453)", async () => {
    // 2 members + 1001 array items: over the limit, counted by the SDK before zod sees it.
    const { status, result } = await callTool("update_memory", { ...changeArgs, padding: Array.from({ length: 1001 }, () => 0) });
    expect(status).toBe(200);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]!.text).toBe("Invalid arguments for tool update_memory: arguments contain more than the maximum of 1000 elements");
    // A legitimate call stays far below the limit: the largest input, a full draft, has about 20 elements.
    features.draftMemory.mockResolvedValueOnce({ ok: true, memoryId: ID, claimToken: CLAIM_TOKEN, claimLink: CLAIM_LINK, originalNoteRecorded: false });
    expect((await callTool("draft_memory", draftArgs)).result.isError).toBeUndefined();
    expect(features.updateMemoryAsAdmin).not.toHaveBeenCalled();
  });

  it("maps a prepareInput refusal to invalid with its message, before the feature", async () => {
    const mismatch = await callTool("draft_memory", { ...draftArgs, sourceInput: { kind: "other", email: "someone-else@example.com", originalText: "Dear Rob" } });
    expect(mismatch.result.isError).toBe(true);
    expect(mismatch.result.structuredContent).toEqual({ code: "invalid", message: "sourceInput.email must match contributor.email (the dedup key is the stored address)" });
    const badId = await callTool("draft_memory", { ...draftArgs, sourceInput: { kind: "gmail", messageId: "thread-f:1" } });
    expect(badId.result.structuredContent).toEqual({ code: "invalid", message: "A Gmail message id is 8 to 32 hex characters" });
    expect(features.draftMemory).not.toHaveBeenCalled();
  });
});

/**
 * Case 7: the 2026-07-28 protocol, served natively. Requirements read from
 * @modelcontextprotocol/server 2.4.0 `dist/src-DdvbAHrR.mjs`
 * (`classifyRequestBody`, `validateStandardRequestHeaders`, the 2026 codec's
 * `RequestMetaEnvelopeSchema`) and `dist/index.mjs` (`serveModern`,
 * `standardHeadersOf`): the `MCP-Protocol-Version` and `Mcp-Method` headers,
 * `Mcp-Name` for `tools/call` (it must equal `params.name`), and a `_meta`
 * envelope whose protocol-version key matches the header and which carries
 * `clientCapabilities` (an empty object is valid).
 */
describe("the modern protocol era (case 7)", () => {
  const MODERN = "2026-07-28";
  const envelope = { "io.modelcontextprotocol/protocolVersion": MODERN, "io.modelcontextprotocol/clientCapabilities": {} };

  function modern(method: string, params: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Promise<Response> {
    return authed({ jsonrpc: "2.0", id: 7, method, params: { ...params, _meta: envelope } }, { "mcp-protocol-version": MODERN, "mcp-method": method, ...extraHeaders });
  }

  it("lists the ten tools", async () => {
    const response = await modern("tools/list", {});
    expect(response.status).toBe(200);
    const tools = ((await rpcBody(response)).result?.tools ?? []) as Array<{ name: string }>;
    expect(tools).toHaveLength(10);
  });

  it("calls a tool with the Mcp-Name header", async () => {
    features.getMemoryForAdmin.mockResolvedValueOnce({ id: ID, coordinates: null });
    const response = await modern("tools/call", { name: "get_memory", arguments: memoryArgs }, { "mcp-name": "get_memory" });
    expect(response.status).toBe(200);
    const result = (await rpcBody(response)).result as unknown as ToolCallResult;
    expect(result.structuredContent).toEqual({ id: ID, coordinates: null });
  });

  it("really is the modern path: it refuses a request missing a header the era requires", async () => {
    const withoutMethod = await authed({ jsonrpc: "2.0", id: 7, method: "tools/list", params: { _meta: envelope } }, { "mcp-protocol-version": MODERN });
    expect(withoutMethod.status).toBe(400);
    const withoutName = await modern("tools/call", { name: "get_memory", arguments: memoryArgs });
    expect(withoutName.status).toBe(400);
    expect(features.getMemoryForAdmin).not.toHaveBeenCalled();
  });

  it("refuses subscriptions/listen (maxSubscriptions: 0) instead of holding the function open", async () => {
    const response = await modern("subscriptions/listen", { notifications: { toolsListChanged: true } });
    const body = await rpcBody(response);
    expect(body.error?.message).toBe("Subscription limit reached");
  });
});

/**
 * Review round 2, R8: the tool list is static and `maxSubscriptions: 0` refuses
 * every `subscriptions/listen`, so the server must not advertise
 * `tools.listChanged` (the SDK defaults it to true in `setToolRequestHandlers`).
 * Where each era advertises capabilities, read from @modelcontextprotocol/server
 * 2.4.0 `dist/mcp-oHn3ureC.mjs`: the 2025-era `initialize` result
 * (`_oninitialize`) and the 2026-07-28 `server/discover` result (`_ondiscover`).
 */
describe("advertised capabilities (review R8)", () => {
  it("the 2025-era initialize result says tools.listChanged is false", async () => {
    const response = await authed({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(response.status).toBe(200);
    const result = (await rpcBody(response)).result as { capabilities?: { tools?: { listChanged?: boolean } } };
    expect(result.capabilities?.tools).toEqual({ listChanged: false });
  });

  it("the 2026-07-28 server/discover result says tools.listChanged is false", async () => {
    const response = await authed(
      { jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } },
      { "mcp-protocol-version": "2026-07-28", "mcp-method": "server/discover" }
    );
    expect(response.status).toBe(200);
    const result = (await rpcBody(response)).result as { capabilities?: { tools?: { listChanged?: boolean } } };
    expect(result.capabilities?.tools).toEqual({ listChanged: false });
  });
});
