import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import * as Sentry from "@sentry/nextjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SERVER_HTTP_OPTIONS } from "@/lib/sentry/http-options";
import { FRAME_SERVER_PREFIX } from "@/lib/video-frames";

/**
 * The server init's Http integration (video-posters plan, Task 4). Passing any `httpIntegration` replaces the one
 * @sentry/nextjs 11.11 adds by default, `httpIntegration({ disableIncomingRequestSpans: true })` (Next.js traces
 * its own requests). Dropping that option would give every incoming request a second, `http.server` span, so this
 * runs the real SDK with the repo's options and proves no incoming request, frame server included, gets one.
 */

type TransportOptions = Parameters<NonNullable<NonNullable<Parameters<typeof Sentry.init>[0]>["transport"]>>[0];

const sent: string[] = [];
let server: Server;

function decode(body: string | Uint8Array): string {
  return typeof body === "string" ? body : new TextDecoder().decode(body);
}

/** Every streamed span's `sentry.op` in the captured envelopes (one JSON value per envelope line). */
function spanOps(): string[] {
  const ops: string[] = [];
  for (const envelope of sent) {
    for (const line of envelope.split("\n")) {
      if (!line.startsWith("{")) {
        continue;
      }
      const value: unknown = JSON.parse(line);
      const items = typeof value === "object" && value !== null && "items" in value && Array.isArray(value.items) ? value.items : [];
      for (const item of items as { attributes?: Record<string, { value?: unknown }> }[]) {
        const op = item.attributes?.["sentry.op"]?.value;
        if (typeof op === "string") {
          ops.push(op);
        }
      }
    }
  }
  return ops;
}

function get(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, agent: false }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  Sentry.init({
    dsn: "https://public@o0.ingest.sentry.io/0",
    environment: "test",
    tracesSampleRate: 1.0,
    integrations: [Sentry.httpIntegration(SERVER_HTTP_OPTIONS)],
    transport: (options: TransportOptions) =>
      Sentry.createTransport(options, async (envelopeRequest) => {
        sent.push(decode(envelopeRequest.body));
        return { statusCode: 200 };
      }),
  });
  server = createServer((_req, res) => res.end("ok"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await Sentry.close(2000);
});

describe("SERVER_HTTP_OPTIONS", () => {
  it("keeps @sentry/nextjs's default of no incoming request spans and also ignores frame-server paths", () => {
    expect(SERVER_HTTP_OPTIONS.disableIncomingRequestSpans).toBe(true);
    expect(SERVER_HTTP_OPTIONS.ignoreIncomingRequests(`${FRAME_SERVER_PREFIX}6b1f1c2e-0000-4000-8000-000000000000`)).toBe(true);
    expect(SERVER_HTTP_OPTIONS.ignoreIncomingRequests("/api/upload")).toBe(false);
    expect(SERVER_HTTP_OPTIONS.ignoreIncomingRequests("/")).toBe(false);
  });

  it("creates no http.server span for a frame-server request or any other incoming request", async () => {
    const { port } = server.address() as AddressInfo;
    // Inside a span, as a route's outgoing work would be; the requests carry its trace headers to the server.
    await Sentry.startSpan({ name: "control", op: "test.control" }, async () => {
      expect(await get(port, `${FRAME_SERVER_PREFIX}6b1f1c2e-0000-4000-8000-000000000000`)).toBe(200);
      expect(await get(port, "/api/upload")).toBe(200);
    });
    await Sentry.flush(5000);
    const ops = spanOps();
    // Control: tracing and capture work.
    expect(ops).toContain("test.control");
    expect(ops).not.toContain("http.server");
  });
});
