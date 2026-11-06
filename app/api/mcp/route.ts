import * as Sentry from "@sentry/nextjs";
import { createMcpHandler, type McpHandlerOptions } from "mcp-handler";
import type { NextRequest } from "next/server";

import { createLogger } from "@/lib/logger";

import { unauthorized } from "../admin/_auth";

import { registerTools } from "./tools";

export const maxDuration = 30;

const log = createLogger({ category: "api" });

type McpHandlerEvent = Parameters<NonNullable<McpHandlerOptions["onEvent"]>>[0];

/**
 * Every error the MCP SDK reports through `onerror` (a factory or
 * `registerTools` throw, a transport failure, a protocol rejection of an
 * authenticated caller) reaches mcp-handler's `onEvent` as an ERROR event and
 * is dropped unless something listens (review round 1, R1). Each one goes to
 * Sentry once, which holds the message and scrubs it; Pino gets ids only. The
 * request events carry the request's parameters, so they are not logged.
 * Module scope: no env, nothing built per request.
 */
function reportHandlerEvent(event: McpHandlerEvent): void {
  if (event.type !== "ERROR") {
    return;
  }
  const error = event.error instanceof Error ? event.error : new Error(event.error);
  const eventId = Sentry.captureException(error, { mechanism: { type: "mcp.handler", handled: true }, captureContext: { level: event.severity, tags: { mcp_source: event.source } } });
  log.error({ action: "mcp_handler_error", source: event.source, severity: event.severity, eventId }, "MCP handler reported an error");
}

/**
 * The jowray MCP server (plan 2026-11-06): eight admin tools for the Claude
 * connector at https://www.jowray.com/api/mcp, configured with "No sign-in"
 * and the request header `authorization: Bearer <MCP_API_SECRET>`.
 *
 * Built once per instance at module scope; mcp-handler then runs
 * `registerTools` on a fresh server for every request (stateless, both the
 * 2026-07-28 protocol and the 2025-era Streamable HTTP fallback). No
 * subscribable resources, so `subscriptions/listen` is refused rather than
 * holding the function open until `maxDuration`. `verboseLogs` stays off;
 * `onEvent` reports the handler's errors (above). The features log ids, the
 * tools log the tool name, memory id and Sentry event id.
 */
const handler = createMcpHandler(registerTools, { serverInfo: { name: "jowray", version: "1" }, maxSubscriptions: 0, onEvent: reportHandlerEvent });

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
