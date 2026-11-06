import { McpServer } from "@modelcontextprotocol/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as LoggerModule from "@/lib/logger";
import type * as SentryModule from "@sentry/nextjs";
import { resetEnvCache } from "@/server/config/env";

/**
 * Review round 1, R1: mcp-handler hands every error the MCP SDK reports
 * through `onerror` to `onEvent` and drops it otherwise (`emitError`). The
 * route's `onEvent` sends each ERROR event to Sentry once and logs ids only;
 * the request events, which carry the request's parameters, are ignored.
 *
 * The trigger is real: the SDK builds a fresh McpServer per request and runs
 * `registerTools` inside its factory; a registration that throws makes the
 * factory reject, which the legacy fallback's catch and the modern `handle`
 * catch both pass to `onerror` (@modelcontextprotocol/server 2.4.0
 * `dist/index.mjs` `createLegacyStatelessFallback`, `createMcpHandler`).
 */

const SECRET = "a".repeat(40);
const LEAK = "SENTRYTEST_registration exploded at /var/task/app";

const captureException = vi.hoisted(() => vi.fn((_error: unknown, _hint?: unknown) => "e".repeat(32)));
vi.mock("@sentry/nextjs", async (importOriginal) => {
  const mod = await importOriginal<typeof SentryModule>();
  return { ...mod, captureException };
});

const logLines: Array<{ level: string; line: unknown[] }> = [];
vi.mock("@/lib/logger", async (importOriginal) => {
  const mod = await importOriginal<typeof LoggerModule>();
  const createLogger: typeof mod.createLogger = (...args) => {
    const real = mod.createLogger(...args);
    const capturing: typeof real = Object.create(real) as typeof real;
    for (const level of ["info", "warn", "error"] as const) {
      capturing[level] = ((...line: unknown[]) => {
        logLines.push({ level, line });
      }) as typeof real.info;
    }
    return capturing;
  };
  return { ...mod, createLogger };
});

// The one feature a successful call below touches; no database in unit tests.
vi.mock("@/features/admin/list-memories", () => ({
  listMemoriesForAdmin: async () => ({ ok: true, query: {}, rows: [], shown: 0, total: 0 }),
  adminStatusCounts: async () => ({ DRAFT: 0, PENDING: 0, APPROVED: 0, HIDDEN: 0, deleted: 0, total: 0 }),
}));

import { POST } from "@/app/api/mcp/route";

const LEGACY = { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${SECRET}` };
const MODERN_ENVELOPE = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(new NextRequest("http://localhost:3000/api/mcp", { method: "POST", headers: { ...LEGACY, ...headers }, body: JSON.stringify(body) }));
}

function handlerErrorLines(): unknown[] {
  return logLines.filter(({ line }) => (line[0] as { action?: string } | undefined)?.action === "mcp_handler_error").map(({ line }) => line[0]);
}

beforeEach(() => {
  process.env.MCP_API_SECRET = SECRET;
  resetEnvCache();
  captureException.mockClear();
  logLines.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("errors the MCP SDK reports through onerror (review R1)", () => {
  it.each([
    ["the 2025-era stateless fallback", {}, {}],
    ["the 2026-07-28 protocol", { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" }, { _meta: MODERN_ENVELOPE }],
  ])("a tool registration that throws on %s reaches Sentry once and Pino with ids only", async (_era, headers, params) => {
    const boom = new Error(LEAK);
    vi.spyOn(McpServer.prototype, "registerTool").mockImplementationOnce(() => {
      throw boom;
    });
    const response = await post({ jsonrpc: "2.0", id: 1, method: "tools/list", params }, headers);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("SENTRYTEST_");

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(boom, { mechanism: { type: "mcp.handler", handled: true }, captureContext: { level: "error", tags: { mcp_source: "request" } } });
    expect(handlerErrorLines()).toEqual([{ action: "mcp_handler_error", source: "request", severity: "error", eventId: "e".repeat(32) }]);
    // Sentry holds the message (and scrubs it); Pino never does.
    expect(JSON.stringify(logLines)).not.toContain("SENTRYTEST_");
    expect(JSON.stringify(logLines)).not.toContain("registration exploded");
  });

  it("reports a protocol rejection for an authenticated caller too (a modern request without Mcp-Method)", async () => {
    const response = await post({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: MODERN_ENVELOPE } }, { "mcp-protocol-version": "2026-07-28" });
    expect(response.status).toBe(400);
    expect(captureException).toHaveBeenCalledTimes(1);
    const [error] = captureException.mock.calls[0]!;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/Mcp-Method/);
    expect(handlerErrorLines()).toHaveLength(1);
  });

  it("ignores the request events: a normal call reaches neither Sentry nor the log, and its parameters are never logged", async () => {
    const response = await post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_memories", arguments: { q: "SENTRYTEST_search" } } });
    expect(response.status).toBe(200);
    expect(captureException).not.toHaveBeenCalled();
    expect(handlerErrorLines()).toEqual([]);
    expect(JSON.stringify(logLines)).not.toContain("SENTRYTEST_search");
  });
});
