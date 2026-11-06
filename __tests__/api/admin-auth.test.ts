import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as LoggerModule from "@/lib/logger";
import { resetEnvCache } from "@/server/config/env";

/**
 * The bearer gate shared by /api/admin/* and /api/mcp (plan 2026-11-06 §4.4):
 * one secret per realm, fail closed, constant-time, header read before env.
 */

const warnLines: unknown[][] = [];
vi.mock("@/lib/logger", async (importOriginal) => {
  const mod = await importOriginal<typeof LoggerModule>();
  const createLogger: typeof mod.createLogger = (...args) => {
    const real = mod.createLogger(...args);
    const capturing: typeof real = Object.create(real) as typeof real;
    capturing.warn = ((...line: unknown[]) => {
      warnLines.push(line);
    }) as typeof real.warn;
    return capturing;
  };
  return { ...mod, createLogger };
});

import { unauthorized } from "@/app/api/admin/_auth";

const ADMIN = "a".repeat(40);
const MCP = "m".repeat(40);

function request(path: string, authorization?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { method: "POST", headers: authorization === undefined ? {} : { authorization } });
}

beforeEach(() => {
  process.env.ADMIN_API_SECRET = ADMIN;
  process.env.MCP_API_SECRET = MCP;
  resetEnvCache();
  warnLines.length = 0;
});

describe("unauthorized(request, realm)", () => {
  it("keeps the admin realm as the default: its own secret passes, the MCP secret does not", () => {
    expect(unauthorized(request("/api/admin/memories", `Bearer ${ADMIN}`))).toBeNull();
    expect(unauthorized(request("/api/admin/memories", `Bearer ${MCP}`))?.status).toBe(401);
  });

  it("checks the MCP realm against MCP_API_SECRET only", () => {
    expect(unauthorized(request("/api/mcp", `Bearer ${MCP}`), "mcp")).toBeNull();
    expect(unauthorized(request("/api/mcp", `Bearer ${ADMIN}`), "mcp")?.status).toBe(401);
    expect(unauthorized(request("/api/mcp"), "mcp")?.status).toBe(401);
    expect(unauthorized(request("/api/mcp", MCP), "mcp")?.status).toBe(401);
  });

  it("fails closed when the MCP secret is unset or empty, whatever the header says", () => {
    delete process.env.MCP_API_SECRET;
    resetEnvCache();
    expect(unauthorized(request("/api/mcp", `Bearer ${MCP}`), "mcp")?.status).toBe(401);
    expect(unauthorized(request("/api/mcp", "Bearer undefined"), "mcp")?.status).toBe(401);
    process.env.MCP_API_SECRET = "";
    resetEnvCache();
    expect(unauthorized(request("/api/mcp", "Bearer "), "mcp")?.status).toBe(401);
  });

  it("answers a plain 401 with no WWW-Authenticate challenge, so Claude shows a connection error rather than a sign-in", async () => {
    const response = unauthorized(request("/api/mcp", "Bearer wrong"), "mcp");
    expect(response?.status).toBe(401);
    expect(response?.headers.get("www-authenticate")).toBeNull();
    expect(await response?.json()).toEqual({ error: { code: "unauthorized", message: "Unauthorized" } });
  });

  it("logs the refusal under the realm's action with the path and whether a secret is configured, never the header", () => {
    unauthorized(request("/api/mcp", "Bearer SENTRYTEST_guess"), "mcp");
    delete process.env.MCP_API_SECRET;
    resetEnvCache();
    unauthorized(request("/api/mcp", "Bearer SENTRYTEST_guess"), "mcp");
    unauthorized(request("/api/admin/memories", "Bearer SENTRYTEST_guess"));
    expect(warnLines.map((line) => line[0])).toEqual([
      { action: "mcp_unauthorized", path: "/api/mcp", configured: true },
      { action: "mcp_unauthorized", path: "/api/mcp", configured: false },
      { action: "admin_unauthorized", path: "/api/admin/memories", configured: true },
    ]);
    expect(JSON.stringify(warnLines)).not.toContain("SENTRYTEST_");
  });

  it("reads the authorization header before it parses the environment (Cache Components rule)", () => {
    process.env.MCP_API_SECRET = "short";
    resetEnvCache();
    const req = request("/api/mcp", `Bearer ${MCP}`);
    const get = vi.spyOn(req.headers, "get");
    expect(() => unauthorized(req, "mcp")).toThrow(/MCP_API_SECRET/);
    expect(get).toHaveBeenCalledWith("authorization");
  });
});
