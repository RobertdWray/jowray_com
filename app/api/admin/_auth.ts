import { type NextRequest, NextResponse } from "next/server";

import { safeEqualHex } from "@/lib/claim-token";
import { createLogger } from "@/lib/logger";
import { getAdminEnv, getMcpEnv } from "@/server/config/env";

const log = createLogger({ category: "api" });

/** Which bearer secret a route checks: the admin API's or the MCP endpoint's (each rotates on its own). */
export type AuthRealm = "admin" | "mcp";

function secretFor(realm: AuthRealm): string | undefined {
  return realm === "mcp" ? getMcpEnv().MCP_API_SECRET : getAdminEnv().ADMIN_API_SECRET;
}

/**
 * Bearer check for the admin API and the MCP endpoint, the same fail-closed,
 * constant-time shape as the cron route: no secret configured, or a wrong one,
 * answers 401. The `authorization` header is read first, before any env, so
 * callers satisfy the Cache Components rule by calling this before touching
 * Prisma or env. The 401 carries no `WWW-Authenticate` challenge: the MCP
 * connector is configured with a static header and "No sign-in", and a
 * challenge would send Claude into an OAuth flow with nothing behind it.
 */
export function unauthorized(request: NextRequest, realm: AuthRealm = "admin"): NextResponse | null {
  const authorization = request.headers.get("authorization") ?? "";
  const secret = secretFor(realm);
  if (!secret || !safeEqualHex(authorization, `Bearer ${secret}`)) {
    // Failed attempts are logged (never the header) so a guessing run is visible in the logs.
    log.warn({ action: `${realm}_unauthorized`, path: request.nextUrl.pathname, configured: Boolean(secret) }, `${realm} API request refused`);
    return NextResponse.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
  }
  return null;
}

export function errorResponse(status: number, code: string, message: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}
