import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import * as Sentry from "@sentry/nextjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { registerTools } from "@/app/api/mcp/tools";
import { DATA_COLLECTION } from "@/lib/sentry/data-collection";
import { scrubBreadcrumb, scrubEvent, scrubLog, scrubSpan } from "@/lib/sentry/scrub";
import { instrumentedAction } from "@/lib/sentry/server-action";

// `headers()` only works inside a request; the wrapper reads it for trace propagation.
// The headers a Server Function POST from a claim page carries: Next's router state encodes the claim-token
// segment, and the Vercel protection cookie rides along on a protected preview.
const ROUTE_TOKEN = "SENTRYTEST_" + "h".repeat(32);
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      "x-forwarded-for": "203.0.113.9",
      "next-router-state-tree": encodeURIComponent(JSON.stringify(["", { children: ["m", { children: [["claimToken", "SENTRYTEST_" + "h".repeat(32), "d"], { children: ["__PAGE__", {}] }] }] }])),
      "next-url": "/m/SENTRYTEST_" + "h".repeat(32),
      cookie: "_vercel_jwt=SENTRYTEST_" + "j".repeat(32),
    }),
}));

// The MCP draft_memory and reissue_claim_link tools return a claim link in their results (plan 2026-11-06 §4.6;
// Team Code Review G4 added the reissue); the feature is the only mock. Each tool gets its own token.
const { MCP_TOKEN, MCP_REISSUE_TOKEN } = vi.hoisted(() => ({ MCP_TOKEN: "SENTRYTEST_" + "m".repeat(32), MCP_REISSUE_TOKEN: "SENTRYTEST_" + "r".repeat(32) }));
vi.mock("@/features/memories/draft-memory", () => ({
  draftMemory: async () => ({ ok: true, memoryId: "00000000-0000-4000-8000-000000000001", claimToken: MCP_TOKEN, claimLink: `https://preview.test/m/${MCP_TOKEN}`, originalNoteRecorded: false }),
  reissueDraftClaimLink: async () => ({ ok: true, memoryId: "00000000-0000-4000-8000-000000000001", claimLink: `https://preview.test/m/${MCP_REISSUE_TOKEN}` }),
}));

/**
 * The decisive gate for the expanded data policy (plan §7.4): the real server
 * SDK, the production `dataCollection` and the production `before*` hooks,
 * with a transport that captures every envelope instead of sending it. No
 * synthetic bearer secret may leave the process; the contributor's email must.
 *
 * Tokens start with `SENTRYTEST_` so a leak is greppable (plan §12).
 */
const CLAIM_TOKEN = "SENTRYTEST_" + "c".repeat(32);
const TICKET_SIG = "SENTRYTEST_" + "s".repeat(32);
const BYPASS_SECRET = "SENTRYTEST_" + "b".repeat(32);
const EMAIL = "sentry-test@jowray.com";

const sent: string[] = [];

// The init options are a client/server union, so the transport factory's
// parameter is typed from `Sentry.init` itself rather than contextually.
type TransportOptions = Parameters<NonNullable<NonNullable<Parameters<typeof Sentry.init>[0]>["transport"]>>[0];

function decode(body: string | Uint8Array): string {
  return typeof body === "string" ? body : new TextDecoder().decode(body);
}

function throwWithSecretLocals(): never {
  const claimToken = CLAIM_TOKEN;
  const ticket = { sig: TICKET_SIG, pathname: "uploads/x" };
  throw new Error(`upload failed for ${ticket.pathname} (${claimToken.length} chars)`);
}

beforeAll(() => {
  Sentry.init({
    dsn: "https://public@o0.ingest.sentry.io/0",
    environment: "test",
    // As in both inits: Server Function inputs and results nest four or five deep (cards → files).
    normalizeDepth: 6,
    // Streamed spans go through beforeSendSpan on the real StreamedSpanJSON shape only with tracing on.
    tracesSampleRate: 1.0,
    dataCollection: DATA_COLLECTION,
    transport: (options: TransportOptions) =>
      Sentry.createTransport(options, async (request) => {
        sent.push(decode(request.body));
        return { statusCode: 200 };
      }),
    beforeSend: (event) => scrubEvent(event),
    beforeSendSpan: (span) => scrubSpan(span),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
    beforeSendLog: (log) => scrubLog(log),
  });
});

afterAll(async () => {
  await Sentry.close(2000);
});

describe("server SDK envelopes with the alpha data policy", () => {
  it("carry the contributor's email but never a claim token, upload ticket or bypass header", async () => {
    Sentry.setUser({ email: EMAIL, username: "Sentry Test" });
    Sentry.setContext("server_action_input", {
      claimTokens: [CLAIM_TOKEN],
      ticket: { sig: TICKET_SIG, pathname: "uploads/x" },
      note: "a note that stays",
    });
    Sentry.addBreadcrumb({ category: "fetch", data: { url: `/api/media/1?t=${CLAIM_TOKEN}` } });
    Sentry.getCurrentScope().setSDKProcessingMetadata({
      normalizedRequest: {
        url: `https://preview.test/m/${CLAIM_TOKEN}?t=${CLAIM_TOKEN}`,
        method: "POST",
        headers: { "x-vercel-protection-bypass": BYPASS_SECRET, "content-type": "application/json" },
        // The exact body lib/upload-client.ts sends: the ticket is a double-encoded JSON string.
        data: JSON.stringify({ type: "blob.generate-client-token", payload: { pathname: "originals/mem_1/a.jpg", clientPayload: JSON.stringify({ mediaId: "med_1", pathname: "originals/mem_1/a.jpg", sig: TICKET_SIG }), multipart: true } }),
      },
    });
    try {
      throwWithSecretLocals();
    } catch (error) {
      Sentry.captureException(error);
    }
    Sentry.logger.info(`confirming /m/${CLAIM_TOKEN}`, { claimLink: `https://preview.test/m/${CLAIM_TOKEN}` });
    // console.warn of a serialized object becomes a Sentry Log *message* (consoleLoggingIntegration in the browser).
    Sentry.logger.warn(`upload refused ${JSON.stringify({ ticket: { sig: TICKET_SIG, pathname: "uploads/x" } })}`);
    await Sentry.flush(5000);

    expect(sent.length).toBeGreaterThan(0);
    const errorEnvelope = sent.find((envelope) => envelope.includes('"type":"event"'));
    expect(errorEnvelope).toBeDefined();
    expect(errorEnvelope).toContain(EMAIL);
    expect(errorEnvelope).toContain("a note that stays");
    expect(errorEnvelope).toContain("content-type");
    const logEnvelope = sent.find((envelope) => envelope.includes('"type":"log"'));
    expect(logEnvelope).toBeDefined();
    expect(logEnvelope).toContain(EMAIL);
    for (const envelope of sent) {
      expect(envelope).not.toContain(CLAIM_TOKEN);
      expect(envelope).not.toContain(TICKET_SIG);
      expect(envelope).not.toContain(BYPASS_SECRET);
      expect(envelope).not.toContain("SENTRYTEST_");
    }
  });
});

describe("tunnel route (handler mode, plan §7.1)", () => {
  it("exports the SDK's POST handler and rejects an envelope for a foreign DSN", async () => {
    const { POST } = await import("@/app/sentry-tunnel/route");
    expect(typeof POST).toBe("function");
    const foreign = JSON.stringify({ dsn: "https://other@o1.ingest.sentry.io/1" }) + "\n" + JSON.stringify({ type: "event" }) + "\n{}";
    const response = await POST(
      new Request("https://preview.test/sentry-tunnel", {
        method: "POST",
        headers: { "content-length": String(new TextEncoder().encode(foreign).byteLength) },
        body: foreign,
      })
    );
    expect(response.status).toBe(403);
  });
});

describe("instrumentedAction (plan §8.5)", () => {
  it("names the transaction, attaches the scrubbed input as context, and nothing inside the action leaks a token", async () => {
    const before = sent.length;
    const result = await instrumentedAction("createSubmission", { email: EMAIL, memories: [{ note: "hi", files: [{ name: "a.jpg" }] }], claimTokens: [CLAIM_TOKEN] }, async () => {
      // An error reported while the action runs (what the features do) carries the action's context.
      Sentry.captureMessage("inside the action");
      return { ok: true, memories: [{ index: 0, memoryId: "mem_1", claimToken: CLAIM_TOKEN, files: [] }] };
    });
    expect(result.memories[0]?.claimToken).toBe(CLAIM_TOKEN); // the caller still gets the real token
    await Sentry.flush(5000);
    const envelope = sent.slice(before).find((item) => item.includes("inside the action"));
    expect(envelope).toBeDefined();
    expect(envelope).toContain('"transaction":"serverAction/createSubmission"');
    // Events captured inside the action carry no request headers (only the trace comes from them), so the proof is the negatives.
    expect(envelope).not.toContain("next-router-state-tree");
    expect(envelope).not.toContain("_vercel_jwt");
    expect(envelope).not.toContain(ROUTE_TOKEN);
    expect(envelope).toContain('"server_action_input":{"email":"sentry-test@jowray.com","memories":[{"note":"hi","files":[{"name":"a.jpg"}]}],"claimTokens":"[Filtered]"}');
    expect(envelope).not.toContain("SENTRYTEST_");
  });
});

describe("streamed spans (beforeSendSpan on the real SDK)", () => {
  it("a server span carrying a claim URL and the Server Function span leave without a token", async () => {
    const before = sent.length;
    // Named the way Next.js names its http.server spans (the parameterized route); the raw URL sits in the attributes.
    // The envelope header's trace context repeats the root span name, which beforeSendSpan cannot touch, and the SDK
    // leaves URL-sourced names out of it, so the route-pattern name is the realistic shape to pin.
    await Sentry.startSpan(
      { name: "GET /m/[claimToken]", op: "http.server", attributes: { "url.full": `https://preview.test/m/${CLAIM_TOKEN}?t=${CLAIM_TOKEN}`, "url.path": `/m/${CLAIM_TOKEN}`, "http.route": "/m/[claimToken]" } },
      async () => {
        // Prisma's shape with databaseQueryData on: the statement is parameterized and the bound value is the token's
        // hash (the app never queries by a raw token); a secret-named attribute is filtered by key.
        await Sentry.startSpan(
          { name: "db.query", op: "db", attributes: { "db.statement": "SELECT ... WHERE claim_token_hash = $1", "db.query.parameter.0": "a".repeat(64), claimToken: CLAIM_TOKEN } },
          async () => undefined
        );
      }
    );
    await Sentry.flush(5000);
    const spans = sent.slice(before).filter((item) => item.includes('"type":"span"'));
    expect(spans.length).toBeGreaterThan(0);
    // The Server Function span from the instrumentedAction case above is streamed too.
    expect(sent.some((item) => item.includes('"type":"span"') && item.includes("createSubmission"))).toBe(true);
    for (const envelope of sent) {
      expect(envelope).not.toContain("SENTRYTEST_");
    }
  });
});

describe("MCP tool spans (plan 2026-11-06 §4.6)", () => {
  it("record each tool call as an MCP span, and the claim link in a draft_memory or reissue_claim_link result leaves without the token", async () => {
    const before = sent.length;
    const server = new McpServer({ name: "jowray", version: "1" });
    // registerTools wraps the server with wrapMcpServerWithSentry before it registers the tools.
    registerTools(server);
    const [client, serverSide] = InMemoryTransport.createLinkedPair();
    const responses: Array<{ id?: unknown; result?: { structuredContent?: { claimLink?: string }; isError?: boolean } }> = [];
    client.onmessage = (message) => {
      responses.push(message as (typeof responses)[number]);
    };
    await server.connect(serverSide);
    await client.start();
    await client.send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "draft_memory",
        arguments: { contributor: { email: EMAIL }, note: "Jo was a light.", sourceInput: { kind: "gmail", messageId: "1a1a2317fba34eec" } },
      },
    });
    await client.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "reissue_claim_link", arguments: { memoryId: "00000000-0000-4000-8000-000000000001" } } });
    await vi.waitFor(() => expect(responses.some((r) => r.id === 1) && responses.some((r) => r.id === 2)).toBe(true));
    // The caller (the model) still gets the real links.
    expect(responses.find((r) => r.id === 1)?.result?.structuredContent?.claimLink).toBe(`https://preview.test/m/${MCP_TOKEN}`);
    expect(responses.find((r) => r.id === 2)?.result?.structuredContent?.claimLink).toBe(`https://preview.test/m/${MCP_REISSUE_TOKEN}`);
    await server.close();
    await Sentry.flush(5000);

    const envelopes = sent.slice(before);
    // The wrapper's spans exist, one per tool, and they carried the tool results (the attribute the scrubber had to clean).
    for (const tool of ["draft_memory", "reissue_claim_link"]) {
      expect(envelopes.some((item) => item.includes(`"mcp.tool.name":"${tool}"`) || item.includes(`"mcp.tool.name":{"value":"${tool}"`)), tool).toBe(true);
    }
    expect(envelopes.some((item) => item.includes("mcp.tool.result.content"))).toBe(true);
    for (const envelope of sent) {
      expect(envelope).not.toContain(MCP_TOKEN);
      expect(envelope).not.toContain(MCP_REISSUE_TOKEN);
      expect(envelope).not.toContain("SENTRYTEST_");
    }
  });
});
