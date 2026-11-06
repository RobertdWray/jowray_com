import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/server/config/env";

/**
 * /api/mcp (plan 2026-11-06 §4.5, §4.6): the bearer gate, the eight tools as
 * thin adapters over the admin features, and the single error boundary. The
 * features are mocked; the route, `_auth.ts`, the env accessor, mcp-handler
 * and the MCP SDK are real.
 */

const SECRET = "a".repeat(40);
const ID = "00000000-0000-4000-8000-000000000001";

const features = vi.hoisted(() => ({
  listMemoriesForAdmin: vi.fn(),
  adminStatusCounts: vi.fn(),
  getMemoryForAdmin: vi.fn(),
  setMemoryCoordinatesAsAdmin: vi.fn(),
  updateMemoryAsAdmin: vi.fn(),
  setMemoryStatusAsAdmin: vi.fn(),
  setMemoryDeletedAsAdmin: vi.fn(),
  draftMemory: vi.fn(),
  reissueDraftClaimLink: vi.fn(),
}));
vi.mock("@/features/admin/list-memories", () => ({ listMemoriesForAdmin: features.listMemoriesForAdmin, adminStatusCounts: features.adminStatusCounts }));
vi.mock("@/features/admin/get-memory", () => ({ getMemoryForAdmin: features.getMemoryForAdmin }));
vi.mock("@/features/admin/set-coordinates", () => ({ setMemoryCoordinatesAsAdmin: features.setMemoryCoordinatesAsAdmin }));
vi.mock("@/features/admin/update-memory", () => ({ updateMemoryAsAdmin: features.updateMemoryAsAdmin }));
vi.mock("@/features/admin/set-status", () => ({ setMemoryStatusAsAdmin: features.setMemoryStatusAsAdmin }));
vi.mock("@/features/admin/set-deleted", () => ({ setMemoryDeletedAsAdmin: features.setMemoryDeletedAsAdmin }));
vi.mock("@/features/memories/draft-memory", () => ({ draftMemory: features.draftMemory, reissueDraftClaimLink: features.reissueDraftClaimLink }));

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
  it("lists the eight tools", async () => {
    const response = await authed({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.status).toBe(200);
    const body = await rpcBody(response);
    const tools = (body.result?.tools ?? []) as Array<{ name: string }>;
    expect(tools.map((t) => t.name).sort()).toEqual(["draft_memory", "get_memory", "list_memories", "reissue_claim_link", "set_coordinates", "set_deleted", "set_status", "update_memory"]);
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
