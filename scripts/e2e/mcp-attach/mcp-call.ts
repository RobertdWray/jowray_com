// Standalone tsx client: it does not load the app's env, telemetry or server-only modules.
import {
  HarnessError, isMain, isRecord, parseJson, parseMcpArgs, publicError,
  redactResult, uploadUrlFromResult, writeCurlConfig, type McpArgs,
} from "./lib";

function unwrap(message: unknown, id: number): unknown {
  if (!isRecord(message) || message.jsonrpc !== "2.0" || message.id !== id) {
    throw new HarnessError("Unexpected MCP JSON-RPC response.");
  }
  if (isRecord(message.error)) {
    const code = typeof message.error.code === "number" ? ` (${message.error.code})` : "";
    throw new HarnessError(`MCP JSON-RPC error${code}; remote message omitted to protect credentials.`);
  }
  if (!("result" in message)) {
    throw new HarnessError("MCP JSON-RPC response has no result.");
  }
  return message.result;
}

/** Return as soon as the matching event arrives; a Streamable HTTP connection may stay open. */
async function readResult(response: Response, id: number): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType === "application/json") {
    return unwrap(parseJson(await response.text()), id);
  }
  if (contentType !== "text/event-stream" || !response.body) {
    await response.body?.cancel();
    throw new HarnessError("Expected application/json or text/event-stream from MCP.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer)) !== null) {
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (!data) { continue; }
        const message = parseJson(data);
        if (isRecord(message) && message.id === id) {
          return unwrap(message, id);
        }
      }
      if (chunk.done) {
        throw new HarnessError("MCP event stream ended without the requested response.");
      }
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function callMcp(args: McpArgs, secret: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  if (!secret) { throw new HarnessError("MCP_API_SECRET is required."); }
  const sessionHeaders: Record<string, string> = {};

  async function rpc(method: string, params: Record<string, unknown> | undefined, id?: number): Promise<unknown> {
    const response = await fetchImpl(args.url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(35_000),
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...sessionHeaders,
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, ...(params ? { params } : {}) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (method === "notifications/initialized") {
        console.error(`mcp-call: notifications/initialized returned HTTP ${response.status}; continuing with the tool request.`);
        return undefined;
      }
      throw new HarnessError(`MCP HTTP ${response.status}; response body omitted to protect credentials.`);
    }
    const session = response.headers.get("mcp-session-id");
    if (session) { sessionHeaders["mcp-session-id"] = session; }
    if (id === undefined) {
      await response.body?.cancel();
      return undefined;
    }
    return readResult(response, id);
  }

  // The route supports the 2025 Streamable HTTP fallback, including this version.
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-06-18", capabilities: {},
    clientInfo: { name: "jowray-mcp-attach-e2e", version: "1.0.0" },
  }, 1);
  if (!isRecord(initialized) || !["2025-03-26", "2025-06-18", "2025-11-25"].includes(String(initialized.protocolVersion))) {
    throw new HarnessError("MCP initialization did not negotiate a supported Streamable HTTP version.");
  }
  sessionHeaders["mcp-protocol-version"] = String(initialized.protocolVersion);
  await rpc("notifications/initialized", undefined);
  return rpc(args.method, args.params, 2);
}

async function main(): Promise<void> {
  const args = parseMcpArgs(process.argv.slice(2), { MCP_URL: process.env.MCP_URL });
  const secret = process.env.MCP_API_SECRET;
  if (!secret) { throw new HarnessError("MCP_API_SECRET is required."); }
  const result = await callMcp(args, secret);
  // Reservation ids must survive a local config-write failure so the operator can recover.
  console.log(JSON.stringify(redactResult(result, [secret]), null, 2));
  const url = uploadUrlFromResult(result);
  if (args.urlFile && url) {
    await writeCurlConfig(args.urlFile, url);
  }
  if (isRecord(result) && result.isError === true) {
    process.exitCode = 1;
  }
}

if (isMain(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`mcp-call: ${publicError(error)}`);
    process.exitCode = 1;
  });
}
