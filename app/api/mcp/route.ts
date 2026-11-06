import { createMcpHandler } from "mcp-handler";
import type { NextRequest } from "next/server";

import { unauthorized } from "../admin/_auth";

import { registerTools } from "./tools";

export const maxDuration = 30;

/**
 * The jowray MCP server (plan 2026-11-06): eight admin tools for the Claude
 * connector at https://www.jowray.com/api/mcp, configured with "No sign-in"
 * and the request header `authorization: Bearer <MCP_API_SECRET>`.
 *
 * Built once per instance at module scope; mcp-handler then runs
 * `registerTools` on a fresh server for every request (stateless, both the
 * 2026-07-28 protocol and the 2025-era Streamable HTTP fallback). No
 * subscribable resources, so `subscriptions/listen` is refused rather than
 * holding the function open until `maxDuration`. `verboseLogs` stays off and
 * there is no `onEvent` logger: the features log ids, the tools log the tool
 * name, memory id and Sentry event id.
 */
const handler = createMcpHandler(registerTools, { serverInfo: { name: "jowray", version: "1" }, maxSubscriptions: 0 });

/**
 * Our own gate, not mcp-handler's `withMcpAuth`: that answers with an RFC 9728
 * challenge that would steer Claude into an OAuth discovery with no
 * authorization server behind it. `unauthorized` reads `request.headers`
 * before any env or Prisma access (Cache Components: a GET Route Handler is
 * prerendered like a page) and answers a plain 401 with no `WWW-Authenticate`.
 */
async function gated(request: NextRequest): Promise<Response> {
  const denied = unauthorized(request, "mcp");
  if (denied) {
    return denied;
  }
  return handler(request);
}

export { gated as GET, gated as POST };
