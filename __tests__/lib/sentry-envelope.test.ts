import * as Sentry from "@sentry/nextjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DATA_COLLECTION } from "@/lib/sentry/data-collection";
import { scrubBreadcrumb, scrubEvent, scrubLog, scrubSpan } from "@/lib/sentry/scrub";

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
        data: JSON.stringify({ claimToken: CLAIM_TOKEN, ticket: { sig: TICKET_SIG } }),
      },
    });
    try {
      throwWithSecretLocals();
    } catch (error) {
      Sentry.captureException(error);
    }
    Sentry.logger.info(`confirming /m/${CLAIM_TOKEN}`, { claimLink: `https://preview.test/m/${CLAIM_TOKEN}` });
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
