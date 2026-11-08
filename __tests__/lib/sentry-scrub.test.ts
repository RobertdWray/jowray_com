import { segmentToTransportSegment } from "next/dist/shared/lib/rsc-transport";
import { describe, expect, it } from "vitest";

import { scrubBreadcrumb, scrubEvent, scrubLog, scrubSpan, scrubUrl } from "@/lib/sentry/scrub";

const TOKEN = "AbCdEf0123456789_-AbCdEf0123456789_-AbCdEf0";

describe("scrubUrl", () => {
  it("replaces a claim token path segment", () => {
    expect(scrubUrl(`https://www.jowray.com/m/${TOKEN}`)).toBe(
      "https://www.jowray.com/m/[claimToken]"
    );
    expect(scrubUrl(`/m/${TOKEN}/edit`)).toBe("/m/[claimToken]/edit");
  });

  it("drops a t= query parameter and keeps the others", () => {
    expect(scrubUrl(`/api/media/abc?t=${TOKEN}&download=1`)).toBe("/api/media/abc?download=1");
    expect(scrubUrl(`https://x.test/api/media/abc?t=${TOKEN}`)).toBe("https://x.test/api/media/abc");
  });

  it("drops the admin entry key whether it travels as a query parameter or a fragment (V16)", () => {
    const KEY = "k".repeat(64);
    expect(scrubUrl(`https://www.jowray.com/admin/enter?key=${KEY}`)).toBe("https://www.jowray.com/admin/enter");
    expect(scrubUrl(`/admin/enter?x=1&key=${KEY}&y=2`)).toBe("/admin/enter?x=1&y=2");
    expect(scrubUrl(`https://www.jowray.com/admin/enter#key=${KEY}`)).toBe("https://www.jowray.com/admin/enter");
    expect(scrubUrl(`/admin/enter?t=${TOKEN}#key=${KEY}`)).toBe("/admin/enter");
    expect(scrubUrl(`/admin/enter#key=${KEY}&other=1`)).toBe("/admin/enter#other=1");
    expect(scrubUrl("/admin?monkey=1")).toBe("/admin?monkey=1");
  });

  it("leaves other urls alone", () => {
    expect(scrubUrl("/share?step=2")).toBe("/share?step=2");
  });
});

describe("scrubEvent", () => {
  it("scrubs request url, transaction name and span data", () => {
    const event = scrubEvent({
      transaction: `/m/${TOKEN}`,
      request: { url: `https://www.jowray.com/m/${TOKEN}?t=${TOKEN}`, query_string: `t=${TOKEN}` },
      spans: [
        {
          span_id: "a".repeat(16),
          trace_id: "b".repeat(32),
          start_timestamp: 0,
          timestamp: 1,
          status: "ok",
          data: { "url.full": `https://www.jowray.com/api/media/1?t=${TOKEN}`, "url.query": `t=${TOKEN}` },
        },
      ],
    });
    expect(JSON.stringify(event)).not.toContain(TOKEN);
    expect(event.transaction).toBe("/m/[claimToken]");
    expect(event.request?.url).toBe("https://www.jowray.com/m/[claimToken]");
    expect(event.request?.query_string).toBeUndefined();
  });
});

describe("scrubBreadcrumb", () => {
  it("scrubs breadcrumb urls", () => {
    const crumb = scrubBreadcrumb({ category: "fetch", data: { url: `/api/media/1?t=${TOKEN}` } });
    expect(JSON.stringify(crumb)).not.toContain(TOKEN);
  });
});

describe("scrubSpan (streamed spans never pass through beforeSendTransaction)", () => {
  it("scrubs the description and every string attribute", () => {
    const span = scrubSpan({
      span_id: "a".repeat(16),
      trace_id: "b".repeat(32),
      start_timestamp: 0,
      timestamp: 1,
      status: "ok",
      description: `GET /m/${TOKEN}`,
      op: "http.server",
      data: { "url.path": `/m/${TOKEN}`, "url.full": `https://www.jowray.com/api/media/1?t=${TOKEN}`, "http.response.status_code": 200 },
    });
    expect(JSON.stringify(span)).not.toContain(TOKEN);
    expect(span.description).toBe("GET /m/[claimToken]");
    expect(span.data?.["http.response.status_code"]).toBe(200);
  });
});

describe("scrubSpan on Sentry 11's StreamedSpanJSON shape (name + attributes)", () => {
  it("scrubs the name and the url.* attributes", () => {
    const span = scrubSpan({
      trace_id: "b".repeat(32), span_id: "a".repeat(16), start_timestamp: 0, status: "ok" as const, is_segment: true,
      name: `GET /m/${TOKEN}`,
      attributes: { "url.path": { value: `/m/${TOKEN}`, type: "string" }, "url.full": { value: `https://www.jowray.com/m/${TOKEN}?t=${TOKEN}`, type: "string" } },
    });
    expect(JSON.stringify(span)).not.toContain(TOKEN);
    expect(span.name).toBe("GET /m/[claimToken]");
  });
});

describe("scrubUrl edge cases from the team review", () => {
  it("removes every t= parameter, including consecutive ones", () => {
    expect(scrubUrl(`/api/media/1?t=${TOKEN}&t=${TOKEN}`)).toBe("/api/media/1");
    expect(scrubUrl(`/api/media/1?t=${TOKEN}&t=${TOKEN}&download=1`)).toBe("/api/media/1?download=1");
    expect(scrubUrl(`t=${TOKEN}&t=${TOKEN}`)).toBe("");
  });

  it("scrubs claim paths and t= values embedded in free-form messages", () => {
    expect(scrubUrl(`GET /m/${TOKEN} 200 in 12ms`)).toBe("GET /m/[claimToken] 200 in 12ms");
    expect(scrubUrl(`fetch /api/media/1?t=${TOKEN} failed with 404`)).toBe("fetch /api/media/1 failed with 404");
  });
});

describe("scrubLog", () => {
  it("scrubs the message and string attributes of a Sentry log", () => {
    const log = scrubLog({ level: "warn", message: `slow request /m/${TOKEN}`, attributes: { url: `/api/media/1?t=${TOKEN}`, count: 2 } });
    expect(JSON.stringify(log)).not.toContain(TOKEN);
    expect(log.attributes?.count).toBe(2);
  });
});

describe("scrubUrl leaves ordinary text alone", () => {
  it("does not strip punctuation from messages without tokens", () => {
    expect(scrubUrl("Is the upload done?")).toBe("Is the upload done?");
    expect(scrubUrl("Tom & Jerry")).toBe("Tom & Jerry");
    expect(scrubUrl("/share?utm=1&st=2")).toBe("/share?utm=1&st=2");
  });
});

// ---------------------------------------------------------------------------
// Scrubber v2 (plan 2026-11-04 §7.3): bearer secrets by key, not only by URL.
// ---------------------------------------------------------------------------
import { scrubHeaders, scrubRecordingEvent, scrubReplayEvent, scrubSecrets, scrubString } from "@/lib/sentry/scrub";
import { SECRET_FIELD_KEYS, SECRET_HEADER_KEYS, SECRET_KEY_FRAGMENTS } from "@/lib/sentry/secrets";

const TEST_TOKEN = "SENTRYTEST_" + "a".repeat(32);
const TEST_TOKEN_2 = "SENTRYTEST_" + "b".repeat(32);
const FILTERED = "[Filtered]";

describe("secrets constants", () => {
  it("name the bearer fields, key fragments and headers", () => {
    expect(SECRET_FIELD_KEYS).toEqual(["claimToken", "claimTokens", "claimLink", "ticket", "clientPayload", "sig", "key", "presignedUrl", "shareUrl", "inviteToken"]);
    expect(SECRET_KEY_FRAGMENTS).toEqual(["token", "ticket"]);
    expect(SECRET_HEADER_KEYS).toEqual(["cookie", "authorization", "x-vercel-protection-bypass", "x-vercel-signature", "next-router-state-tree"]);
  });
});

describe("presigned Blob URLs are bearer credentials (MCP attach A19)", () => {
  // Synthetic only: the PUT shape comes from the S0.3 spike; GET uses the private Blob host.
  const putUrl = "https://vercel.com/api/blob/?pathname=dev%2Foriginals%2Fm%2Fx.jpg&vercel-blob-delegation=SENTRYTEST_D&vercel-blob-signature=SENTRYTEST_S&vercel-blob-maximum-size-in-bytes=10";
  const putScrubbed = "https://vercel.com/api/blob/?pathname=dev%2Foriginals%2Fm%2Fx.jpg&vercel-blob-maximum-size-in-bytes=10";
  const getUrl = "https://test.private.blob.vercel-storage.com/dev/originals/m/x.jpg?vercel-blob-delegation=SENTRYTEST_D&vercel-blob-signature=SENTRYTEST_S";
  const getScrubbed = "https://test.private.blob.vercel-storage.com/dev/originals/m/x.jpg";

  describe.each([
    { method: "PUT", url: putUrl, scrubbed: putScrubbed },
    { method: "GET", url: getUrl, scrubbed: getScrubbed },
  ])("$method", ({ url, scrubbed }) => {
    it("removes both query credentials while preserving the path and non-secret parameters", () => {
      expect(scrubUrl(url)).toBe(scrubbed);
      expect(scrubSecrets(`request ${url} failed`)).toBe(`request ${scrubbed} failed`);
    });

    it("filters presignedUrl in an event and scrubs its request URL", () => {
      const event = scrubEvent({
        extra: { upload: { presignedUrl: url }, mediaId: "med_1" },
        request: { url },
      });
      expect(event.extra).toEqual({ upload: { presignedUrl: FILTERED }, mediaId: "med_1" });
      expect(event.request?.url).toBe(scrubbed);
      expect(JSON.stringify(event)).not.toContain("SENTRYTEST_");
    });

    it("filters presignedUrl and serialized MCP tool output in span attributes", () => {
      const span = scrubSpan({
        name: "request_upload",
        attributes: {
          presignedUrl: { value: url, type: "string" },
          "mcp.tool.output": { value: JSON.stringify({ upload: { presignedUrl: url }, mediaId: "med_1" }), type: "string" },
          "url.full": { value: url, type: "string" },
        },
      });
      expect(span.attributes).toEqual({
        presignedUrl: FILTERED,
        "mcp.tool.output": { value: '{"upload":{"presignedUrl":"[Filtered]"},"mediaId":"med_1"}', type: "string" },
        "url.full": { value: scrubbed, type: "string" },
      });
      expect(JSON.stringify(span)).not.toContain("SENTRYTEST_");
    });

    it("filters presignedUrl in breadcrumb data and query credentials in its message", () => {
      const breadcrumb = scrubBreadcrumb({ category: "fetch", data: { upload: { presignedUrl: url } }, message: `request ${url} failed` });
      expect(breadcrumb.data).toEqual({ upload: { presignedUrl: FILTERED } });
      expect(breadcrumb.message).toBe(`request ${scrubbed} failed`);
      expect(JSON.stringify(breadcrumb)).not.toContain("SENTRYTEST_");
    });

    it("filters presignedUrl in Sentry log attributes and query credentials in its message", () => {
      const log = scrubLog({ message: `request ${url} failed`, attributes: { upload: { presignedUrl: url }, mediaId: "med_1" } });
      expect(log.attributes).toEqual({ upload: { presignedUrl: FILTERED }, mediaId: "med_1" });
      expect(log.message).toBe(`request ${scrubbed} failed`);
      expect(JSON.stringify(log)).not.toContain("SENTRYTEST_");
    });
  });

  it.each(["presignedUrl", "PresignedURL", "PRESIGNEDURL"])("matches %s as a whole key, including serialized and escaped Flight members", (key) => {
    const output = { upload: { [key]: putUrl }, presignedUrlExpiresAt: "keep" };
    const expected = { upload: { [key]: FILTERED }, presignedUrlExpiresAt: "keep" };
    expect(scrubSecrets(output)).toEqual(expected);
    expect(scrubSecrets(JSON.stringify(output))).toBe(JSON.stringify(expected));
    expect(scrubSecrets(`1:${JSON.stringify(output)}`)).toBe(`1:${JSON.stringify(expected)}`);
    expect(scrubSecrets(`1:${JSON.stringify(JSON.stringify(output))}`)).toBe(`1:${JSON.stringify(JSON.stringify(expected))}`);
    expect(scrubSecrets(`1:{"${key}":"${putUrl}`)).toBe(`1:{"${key}":"[Filtered]"`);
  });

  it.each(["vercel-blob-signature", "vercel-blob-delegation"])("removes %s at every query position, including repeats and bare queries", (key) => {
    const parameter = `${key}=SENTRYTEST_QUERY`;
    expect(scrubUrl(`/blob?${parameter}`)).toBe("/blob");
    expect(scrubUrl(`/blob?${parameter}&pathname=keep`)).toBe("/blob?pathname=keep");
    expect(scrubUrl(`/blob?pathname=keep&${parameter}&download=1`)).toBe("/blob?pathname=keep&download=1");
    expect(scrubUrl(`/blob?pathname=keep&${parameter}`)).toBe("/blob?pathname=keep");
    expect(scrubUrl(`/blob?${parameter}&${parameter}#section`)).toBe("/blob#section");
    expect(scrubUrl(`${parameter}&pathname=keep&${parameter}`)).toBe("pathname=keep");
    expect(scrubUrl(`/blob#${parameter}&pathname=keep`)).toBe("/blob#pathname=keep");
    expect(scrubUrl(`/blob?${key}=&pathname=keep`)).toBe("/blob?pathname=keep");
    expect(scrubUrl(`/blob?x-${key}=keep&${key}-suffix=keep`)).toBe(`/blob?x-${key}=keep&${key}-suffix=keep`);
  });
});

describe("scrubSecrets", () => {
  it("filters the completeSubmission input (claimTokens array) whatever the value type", () => {
    expect(scrubSecrets({ claimTokens: [TEST_TOKEN, TEST_TOKEN_2], anchorId: "mem_1" })).toEqual({ claimTokens: FILTERED, anchorId: "mem_1" });
  });

  it("filters the admin entry key (the enterAdmin Server Function argument) but not keys that merely contain the word", () => {
    expect(scrubSecrets({ key: TEST_TOKEN, storageKey: "originals/mem_1/a.jpg" })).toEqual({ key: FILTERED, storageKey: "originals/mem_1/a.jpg" });
    expect(scrubSecrets(`{"key":"${TEST_TOKEN}","storageKey":"k"}`)).toBe(`{"key":"${FILTERED}","storageKey":"k"}`);
  });

  it("filters a createSubmission response as an object and as JSON text", () => {
    const object = scrubSecrets({ memories: [{ id: "mem_1", claimToken: TEST_TOKEN }] });
    expect(JSON.stringify(object)).not.toContain(TEST_TOKEN);
    expect(object).toEqual({ memories: [{ id: "mem_1", claimToken: FILTERED }] });
    const text = scrubSecrets(JSON.stringify({ memories: [{ id: "mem_1", claimToken: TEST_TOKEN }] })) as string;
    expect(text).not.toContain(TEST_TOKEN);
    expect(text).toContain('"id":"mem_1"');
    expect(text).toContain(`"claimToken":"${FILTERED}"`);
  });

  it("filters an upload ticket object and the keys inside it, in objects and in JSON text", () => {
    expect(scrubSecrets({ ticket: { sig: TEST_TOKEN, pathname: "uploads/x" }, memoryId: "mem_1" })).toEqual({ ticket: FILTERED, memoryId: "mem_1" });
    const text = scrubSecrets(`{"ticket":{"sig":"${TEST_TOKEN}","pathname":"uploads/x"},"memoryId":"mem_1"}`) as string;
    expect(text).not.toContain(TEST_TOKEN);
    expect(text).toContain('"memoryId":"mem_1"');
  });

  it("matches keys case-insensitively and by fragment (future *Token* and *Ticket* fields)", () => {
    expect(scrubSecrets({ ClaimToken: TEST_TOKEN, uploadTicketId: "t_1", accessTOKEN: TEST_TOKEN_2, okay: 1 })).toEqual({ ClaimToken: FILTERED, uploadTicketId: FILTERED, accessTOKEN: FILTERED, okay: 1 });
    expect(scrubSecrets(`{"accessToken":"${TEST_TOKEN}","ok":true}`)).toBe(`{"accessToken":"${FILTERED}","ok":true}`);
  });

  it("walks nested arrays", () => {
    const out = scrubSecrets([[{ claimLink: `https://x.test/m/${TEST_TOKEN}` }], [`/m/${TEST_TOKEN}`]]);
    expect(JSON.stringify(out)).not.toContain(TEST_TOKEN);
    expect(out).toEqual([[{ claimLink: FILTERED }], ["/m/[claimToken]"]]);
  });

  it("still removes the token from truncated JSON text", () => {
    const truncated = `{"memories":[{"id":"mem_1","claimToken":"${TEST_TOKEN.slice(0, 20)}`;
    expect(scrubSecrets(truncated)).not.toContain(TEST_TOKEN.slice(0, 20));
    const truncatedArray = `{"claimTokens":["${TEST_TOKEN}","${TEST_TOKEN_2.slice(0, 12)}`;
    expect(scrubSecrets(truncatedArray)).not.toContain("SENTRYTEST_");
  });

  it("scrubs URLs inside ordinary strings and leaves other values alone", () => {
    expect(scrubSecrets({ url: `/api/media/1?t=${TEST_TOKEN}`, count: 2, flag: true, nothing: null })).toEqual({ url: "/api/media/1", count: 2, flag: true, nothing: null });
  });

  it("stops at the depth cap instead of recursing forever", () => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let depth = 0; depth < 30; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.child = next;
      cursor = next;
    }
    cursor.claimToken = TEST_TOKEN;
    expect(() => scrubSecrets(root)).not.toThrow();
  });
});

describe("scrubHeaders", () => {
  it("drops the bearer headers (any case) and keeps the rest", () => {
    expect(scrubHeaders({ "X-Vercel-Protection-Bypass": TEST_TOKEN, cookie: "a=b", Authorization: "Bearer x", "content-type": "application/json" })).toEqual({ "content-type": "application/json" });
  });
});

describe("scrubEvent with the alpha data policy", () => {
  it("scrubs contexts, extra, request data, request headers and frame locals, and keeps the user", () => {
    const event = scrubEvent({
      user: { email: "sentry-test@jowray.com", username: "Sentry Test" },
      contexts: { server_action_input: { claimTokens: [TEST_TOKEN], note: "keep" } },
      extra: { ticket: { sig: TEST_TOKEN }, memoryId: "mem_1" },
      request: {
        url: `https://x.test/m/${TEST_TOKEN}`,
        data: JSON.stringify({ claimToken: TEST_TOKEN }),
        headers: { "x-vercel-protection-bypass": TEST_TOKEN, "content-type": "application/json" },
      },
      exception: { values: [{ type: "Error", value: "boom", stacktrace: { frames: [{ filename: "a.ts", vars: { claimToken: TEST_TOKEN, ticket: { sig: TEST_TOKEN }, memoryId: "mem_1" } }] } }] },
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain(TEST_TOKEN);
    expect(event.user).toEqual({ email: "sentry-test@jowray.com", username: "Sentry Test" });
    expect(event.contexts?.server_action_input).toEqual({ claimTokens: FILTERED, note: "keep" });
    expect(event.extra).toEqual({ ticket: FILTERED, memoryId: "mem_1" });
    expect(event.request?.headers).toEqual({ "content-type": "application/json" });
    expect(event.exception?.values?.[0]?.stacktrace?.frames?.[0]?.vars).toEqual({ claimToken: FILTERED, ticket: FILTERED, memoryId: "mem_1" });
  });
});

describe("scrubSpan / scrubLog / scrubBreadcrumb also filter secret keys", () => {
  it("filters secret keys in span attributes, log attributes and breadcrumb data", () => {
    expect(JSON.stringify(scrubSpan({ name: "x", attributes: { "http.request.body": `{"claimToken":"${TEST_TOKEN}"}`, claimToken: { value: TEST_TOKEN, type: "string" } } }))).not.toContain(TEST_TOKEN);
    expect(JSON.stringify(scrubLog({ message: "m", attributes: { claimLink: `https://x.test/m/${TEST_TOKEN}` } }))).not.toContain(TEST_TOKEN);
    expect(JSON.stringify(scrubBreadcrumb({ category: "xhr", data: { ticket: { sig: TEST_TOKEN } } }))).not.toContain(TEST_TOKEN);
  });
});

describe("scrubReplayEvent", () => {
  it("scrubs the urls of a replay_event and returns other events unchanged", () => {
    const replay = scrubReplayEvent({ type: "replay_event", urls: [`https://x.test/m/${TEST_TOKEN}`, "/share"] } as never);
    expect(replay).toEqual({ type: "replay_event", urls: ["https://x.test/m/[claimToken]", "/share"] });
    const error = { message: `not a replay /m/${TEST_TOKEN}` };
    expect(scrubReplayEvent(error as never)).toBe(error);
  });
});

describe("scrubRecordingEvent", () => {
  it("filters tokens out of replay network bodies, urls and console args", () => {
    const out = scrubRecordingEvent({
      type: 5,
      timestamp: 1,
      data: {
        tag: "performanceSpan",
        payload: {
          op: "resource.fetch",
          description: `/api/media/1?t=${TEST_TOKEN}`,
          data: { request: { body: JSON.stringify({ claimTokens: [TEST_TOKEN] }) }, response: { body: `{"memories":[{"claimToken":"${TEST_TOKEN}"}]}` } },
        },
      },
    });
    expect(JSON.stringify(out)).not.toContain(TEST_TOKEN);
    expect(out.type).toBe(5);
    expect((out.data as { payload: { description: string } }).payload.description).toBe("/api/media/1");
  });
});

// ---------------------------------------------------------------------------
// Whole-stack review (2026-11-04): the app's real wire shapes, as text.
// ---------------------------------------------------------------------------
describe("scrubSecrets on the app's real wire shapes", () => {
  const ticket = { mediaId: "med_1", memoryId: "mem_1", pathname: "originals/mem_1/a.jpg", mimeType: "image/jpeg", maxBytes: 100, expiresAt: 1, sig: TEST_TOKEN };

  it("filters the ticket signature inside the double-encoded clientPayload the Blob client sends to /api/upload", () => {
    const body = JSON.stringify({ type: "blob.generate-client-token", payload: { pathname: ticket.pathname, callbackUrl: "https://www.jowray.com/api/upload", clientPayload: JSON.stringify(ticket), multipart: true } });
    const out = scrubSecrets(body) as string;
    expect(out).not.toContain(TEST_TOKEN);
    expect(out).toContain('"pathname":"originals/mem_1/a.jpg"');
    expect(out).toContain('"multipart":true');
  });

  it("filters a double-encoded ticket and a double-encoded claim token at any depth", () => {
    const flight = JSON.stringify([JSON.stringify({ ticket: { sig: TEST_TOKEN } }), { nested: JSON.stringify({ changes: { note: "x" }, claimToken: TEST_TOKEN_2 }) }]);
    const out = scrubSecrets(flight) as string;
    expect(out).not.toContain("SENTRYTEST_");
    expect(out).toContain("note");
  });

  it("filters nested arrays and arrays of objects under a secret key, and values with escaped quotes", () => {
    expect(scrubSecrets(`{"claimTokens":[["${TEST_TOKEN}"],["${TEST_TOKEN_2}"]],"ok":1}`)).not.toContain("SENTRYTEST_");
    expect(scrubSecrets(`{"ticket":[{"sig":"${TEST_TOKEN}","a":[1]},{"sig":"${TEST_TOKEN_2}"}],"ok":1}`)).not.toContain("SENTRYTEST_");
    expect(scrubSecrets(`{"note":"she said \\"hi\\"","claimToken":"${TEST_TOKEN}"}`)).not.toContain(TEST_TOKEN);
    expect(scrubSecrets(`{"outer":{"inner":{"x":1}},"claimToken":"${TEST_TOKEN}"}`)).not.toContain(TEST_TOKEN);
  });

  it("filters the double-encoded admin entry key (PR #31's enterAdmin argument on the RSC wire)", () => {
    const flight = JSON.stringify([JSON.stringify({ key: TEST_TOKEN })]);
    expect(scrubSecrets(flight)).not.toContain("SENTRYTEST_");
  });

  it("still filters truncated double-encoded text", () => {
    const body = JSON.stringify({ payload: { clientPayload: JSON.stringify(ticket) } });
    expect(scrubSecrets(body.slice(0, body.indexOf("sig") + 30))).not.toContain(TEST_TOKEN.slice(0, 12));
  });
});

describe("scrubReplayEvent covers every event type beforeSend never sees", () => {
  it("scrubs request.url and the feedback context of a feedback event, and request.url of a replay event", () => {
    const feedback = scrubReplayEvent({ type: "feedback", request: { url: `https://www.jowray.com/m/${TEST_TOKEN}` }, contexts: { feedback: { url: `https://www.jowray.com/m/${TEST_TOKEN}`, message: "it broke" } } } as never);
    expect(JSON.stringify(feedback)).not.toContain(TEST_TOKEN);
    expect(JSON.stringify(feedback)).toContain("it broke");
    const replay = scrubReplayEvent({ type: "replay_event", request: { url: `https://www.jowray.com/m/${TEST_TOKEN}?t=${TEST_TOKEN}` }, urls: [`/m/${TEST_TOKEN}`] } as never);
    expect(JSON.stringify(replay)).not.toContain(TEST_TOKEN);
    expect((replay as { urls: string[] }).urls).toEqual(["/m/[claimToken]"]);
  });
});

// ---------------------------------------------------------------------------
// Team Code Review (Oscar, 2026-11-04): headers, messages, Flight text, depth.
// ---------------------------------------------------------------------------
describe("scrubHeaders drops Next's routing headers and scrubs URL-bearing values", () => {
  it("removes next-router-state-tree (the encoded router state carries the claim-token segment) and scrubs next-url and referer", () => {
    const tree = encodeURIComponent(JSON.stringify(["", { children: ["m", { children: [["claimToken", TEST_TOKEN, "d"], { children: ["__PAGE__", {}] }] }] }]));
    const out = scrubHeaders({ "Next-Router-State-Tree": tree, "next-url": `/m/${TEST_TOKEN}`, referer: `https://www.jowray.com/m/${TEST_TOKEN}`, "content-type": "text/plain" });
    expect(JSON.stringify(out)).not.toContain(TEST_TOKEN);
    expect(out["Next-Router-State-Tree"]).toBeUndefined();
    expect(out["next-url"]).toBe("/m/[claimToken]");
    expect(out["content-type"]).toBe("text/plain");
    expect(SECRET_HEADER_KEYS).toContain("next-router-state-tree");
  });
});

describe("messages get the same key-aware scrubbing as attributes", () => {
  it("scrubs a serialized ticket in a log message, a breadcrumb message and a span description", () => {
    const text = JSON.stringify({ ticket: { sig: TEST_TOKEN }, note: "keep" });
    expect(scrubLog({ message: `upload refused ${text}` }).message).not.toContain(TEST_TOKEN);
    expect(scrubLog({ message: text }).message).toContain("keep");
    expect(scrubBreadcrumb({ message: `console: {"sig":"${TEST_TOKEN}"}` }).message).not.toContain(TEST_TOKEN);
    expect(scrubSpan({ description: `POST /share {"claimTokens":["${TEST_TOKEN}"]}` }).description).not.toContain(TEST_TOKEN);
  });
});

describe("the non-JSON fallback fails closed on React Flight text", () => {
  it("filters nested arrays and objects under a secret key inside a record-prefixed line", () => {
    const flight = `1:{"claimTokens":[["${TEST_TOKEN}"],["${TEST_TOKEN_2}"]],"anchorId":"mem_1"}\n2:{"ticket":{"sig":"${TEST_TOKEN}","inner":{"deep":[1,2]}},"ok":true}\n`;
    const out = scrubSecrets(flight) as string;
    expect(out).not.toContain("SENTRYTEST_");
    expect(out).toContain('"anchorId":"mem_1"');
    expect(out).toContain('"ok":true');
  });

  it("filters escaped keys and values in Flight text, and a truncated nested value to the end of the text", () => {
    const escaped = `0:["$@1",{\\"claimToken\\":\\"${TEST_TOKEN}\\",\\"note\\":\\"n\\"}]`;
    expect(scrubSecrets(escaped)).not.toContain(TEST_TOKEN);
    const truncated = `1:{"ticket":{"sig":"${TEST_TOKEN}","inner":{"deep":[1,`;
    expect(scrubSecrets(truncated)).not.toContain(TEST_TOKEN);
  });
});

describe("the depth cap fails closed", () => {
  it("replaces anything deeper than the cap with the filtered marker, in objects and in serialized bodies", () => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let depth = 0; depth < 25; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.child = next;
      cursor = next;
    }
    cursor.claimToken = TEST_TOKEN;
    cursor.note = "deep";
    expect(JSON.stringify(scrubSecrets(root))).not.toContain(TEST_TOKEN);
    expect(scrubSecrets(JSON.stringify(root))).not.toContain(TEST_TOKEN);
    const shallow = { a: { b: { claimToken: TEST_TOKEN, note: "keep" } } };
    expect(scrubSecrets(shallow)).toEqual({ a: { b: { claimToken: FILTERED, note: "keep" } } });
  });
});

// ---------------------------------------------------------------------------
// Team Code Review of PR #47 (George #1) and the regression review after it:
// the key's quoting and the value's quoting can disagree in malformed text.
// The key's quoting decides, exactly as the regex scanner on main did. Two
// "improvements" were tried and both hid a *later* member by swallowing its
// opening quote; those inputs are pinned here. The remaining residual (text
// after whitespace or a comma inside a mixed-quoted value is not part of the
// value) is main's behaviour too, and our secrets contain neither.
// ---------------------------------------------------------------------------
describe("mixed quoting between a secret key and its value (PR #47 review, George #1)", () => {
  it("keeps the fail-closed reading after an escaped-looking key: a plain-quoted value runs to the end of the text, exactly as on main", () => {
    expect(scrubSecrets(`{"a":"\\"token":"${TEST_TOKEN}"}`)).toBe(`{"a":"\\"token":\\"${FILTERED}\\"`);
    expect(scrubSecrets(`C:\\dir\\"token":"${TEST_TOKEN}" tail`)).toBe(`C:\\dir\\"token":\\"${FILTERED}\\"`);
  });

  it("never hides the member after an escaped key whose value starts with a plain quote (regression review of c648ce4)", () => {
    // Flight-style line (not JSON): attacker text in the note sits right before the real claim token.
    const flight = `1:{"note":"x\\"token\\":","claimToken":"${TEST_TOKEN}"}`;
    expect(scrubSecrets(flight)).toBe(`1:{"note":"x\\"token\\":\\"${FILTERED}\\"`);
    // The same shape as a truncated plain JSON body (no closing brace, so the scanner runs instead of JSON.parse).
    const truncated = `{"note":"x\\"token\\":","claimToken":"${TEST_TOKEN}"`;
    expect(scrubSecrets(truncated)).toBe(`{"note":"x\\"token\\":\\"${FILTERED}\\"`);
  });

  it("never hides the member after a plain key whose value starts with an escaped quote (the other direction; found by the differential test)", () => {
    // Upgrading the reading to escaped here would run to the `\"` after `ticket` and swallow that key.
    const text = `{"claimToken":\\","ticket\\":\\"${TEST_TOKEN}\\",\\"key\\":\\"${TEST_TOKEN_2}`;
    const out = scrubSecrets(text) as string;
    expect(out).not.toContain("SENTRYTEST_");
    expect(out).toBe(`{"claimToken":"${FILTERED}","ticket\\":"${FILTERED}",\\"key\\":\\"${FILTERED}\\"`);
  });

  it("reads a plain key's escaped-looking value as a scalar, as on main: the secret goes, text after whitespace or a comma inside it stays", () => {
    expect(scrubSecrets(`"token\\":\\"${TEST_TOKEN}\\"`)).toBe(`"token\\":"${FILTERED}"`);
    expect(scrubSecrets(`"token\\":\\"${TEST_TOKEN} tail\\" rest`)).toBe(`"token\\":"${FILTERED}" tail\\" rest`);
    expect(scrubSecrets(`"claimToken":\\"${TEST_TOKEN},x\\" rest`)).toBe(`"claimToken":"${FILTERED}",x\\" rest`);
  });

  it("never leaves the secret itself behind whatever the quoting, and stays idempotent", () => {
    const texts = [
      `{"a":"\\"token":"${TEST_TOKEN}"}`,
      `"token\\":\\"${TEST_TOKEN} tail\\" rest`,
      `"claimToken":\\"${TEST_TOKEN},x\\" rest`,
      `\\"ticket":{"sig":"${TEST_TOKEN}"} tail`,
      `"ticket\\":{\\"sig\\":\\"${TEST_TOKEN}\\"} tail`,
      `\\"claimToken":"${TEST_TOKEN} with space" tail`,
    ];
    for (const text of texts) {
      const once = scrubSecrets(text) as string;
      expect(once).not.toContain(TEST_TOKEN);
      expect(once).not.toContain("SENTRYTEST_");
      expect(scrubSecrets(once)).toBe(once);
    }
  });
});

describe("the escaped-context scanner is idempotent (regression check M2)", () => {
  it("keeps the inner JSON string well formed and leaves neighbouring keys alone on repeated passes", () => {
    const flight = `1:{"p":"{\\"ticket\\":\\"${TEST_TOKEN}\\",\\"b\\":\\"keep\\"}"}`;
    const once = scrubSecrets(flight) as string;
    expect(once).not.toContain(TEST_TOKEN);
    expect(once).toContain('\\"b\\":\\"keep\\"');
    expect(once).toContain('\\"ticket\\":\\"[Filtered]\\"');
    expect(scrubSecrets(once)).toBe(once);
    expect(scrubSecrets(scrubSecrets(once))).toBe(once);
  });

  it("steps over three-character inner escapes (\\\\n) without overshooting the closing quote", () => {
    const flight = `1:{"p":"{\\"claimToken\\":\\"${TEST_TOKEN}\\\\n\\",\\"b\\":\\"keep\\"}"}`;
    const once = scrubSecrets(flight) as string;
    expect(once).not.toContain(TEST_TOKEN);
    expect(once).toContain('\\"b\\":\\"keep\\"');
  });
});


describe("invite bearer secrets (R10) and router tuples (D21)", () => {
  const inviteToken = "SENTRYTEST_x";

  it.each([inviteToken, `${inviteToken}longer_-`])("scrubs invite paths containing 12 or more base64url characters: %s", (token) => {
    expect(scrubUrl(`/s/${token}`)).toBe("/s/[inviteToken]");
    expect(scrubUrl(`/S/${token}/edit`)).toBe("/s/[inviteToken]/edit");
    expect(scrubUrl(`https://www.example.com/s/${token}?x=1`)).toBe("https://www.example.com/s/[inviteToken]?x=1");
    expect(scrubString(`Visit https://www.example.com/s/${token}?x=1 now?`)).toBe("Visit https://www.example.com/s/[inviteToken]?x=1 now?");
    expect(scrubString(`Visit /s/${token}?`)).toBe("Visit /s/[inviteToken]?");
  });

  it.each(["/s/SENTRYTEST_", "/s/short", "/share", "/s/", "Is this ready?", "Alice & Bob"])("keeps ordinary text or short paths: %s", (text) => {
    expect(scrubUrl(text)).toBe(text);
  });

  it("filters shareUrl and inviteToken keys while retaining invitee identity", () => {
    const value = { firstName: "Alice Example", email: "alice@example.com", shareUrl: `https://www.example.com/s/${inviteToken}`, inviteToken };
    const expected = { ...value, shareUrl: FILTERED, inviteToken: FILTERED };
    expect(scrubSecrets(value)).toEqual(expected);
    expect(scrubString(JSON.stringify(value))).toBe(JSON.stringify(expected));
    expect(scrubString(`1:${JSON.stringify(value)}`)).toBe(`1:${JSON.stringify(expected)}`);
    expect(scrubString(`1:${JSON.stringify(JSON.stringify(value))}`)).toBe(`1:${JSON.stringify(JSON.stringify(expected))}`);
  });

  describe.each(["inviteToken", "claimToken"])("%s tuples", (key) => {
    const tuple = [key, inviteToken, "d"];
    const filtered = [key, FILTERED, "d"];

    it("filters only the string value in arrays, including nested router state", () => {
      expect(scrubSecrets(tuple)).toEqual(filtered);
      expect(scrubString(JSON.stringify(tuple))).toBe(JSON.stringify(filtered));
      const state = ["", { children: ["s", { children: [tuple, {}] }] }];
      const expected = ["", { children: ["s", { children: [filtered, {}] }] }];
      expect(scrubSecrets(state)).toEqual(expected);
      expect(scrubString(JSON.stringify(state))).toBe(JSON.stringify(expected));
      expect(tuple[1]).toBe(inviteToken); // callers keep their bearer value
    });

    it("filters Flight lines and escaped JSON inside strings", () => {
      for (const prefix of ["1:", "log "]) {
        expect(scrubString(`${prefix}${JSON.stringify(tuple)}`)).toBe(`${prefix}${JSON.stringify(filtered)}`);
        expect(scrubString(`${prefix}${JSON.stringify(JSON.stringify(tuple))}`)).toBe(`${prefix}${JSON.stringify(JSON.stringify(filtered))}`);
      }
      expect(scrubString(JSON.stringify(JSON.stringify(tuple)))).toBe(JSON.stringify(JSON.stringify(filtered)));
      expect(scrubSecrets({ body: JSON.stringify({ state: JSON.stringify(tuple) }) })).toEqual({ body: JSON.stringify({ state: JSON.stringify(filtered) }) });
    });

    it("preserves arbitrary whitespace around tuple tokens in Flight text", () => {
      for (const quote of ['"', '\\"']) {
        const text = `1:[ \n\t${quote}${key}${quote}\r , \t${quote}${inviteToken}${quote} , ${quote}d${quote} ]`;
        expect(scrubString(text)).toBe(text.replace(inviteToken, FILTERED));
      }
    });

    it("handles whitespace escaped by an enclosing JSON string", () => {
      const spaced = `[ \n\t"${key}"\r , \t"${inviteToken}" , "d" ]`;
      const encoded = JSON.stringify(spaced);
      expect(scrubString(encoded)).toBe(encoded.replace(inviteToken, FILTERED));
      expect(scrubString(`1:${encoded}`)).toBe(`1:${encoded.replace(inviteToken, FILTERED)}`);
    });

    it("filters unterminated values to the end, including escaped values", () => {
      for (const quote of ['"', '\\"']) {
        expect(scrubString(`1:[${quote}${key}${quote},${quote}${inviteToken}`)).toBe(`1:[${quote}${key}${quote},${quote}${FILTERED}${quote}`);
      }
    });

    it("does not confuse a non-string value or a later array element with a router tuple", () => {
      for (const value of [[key, 7, "d"], ["name", key, "Alice Example"], ["name", "Alice Example"]]) {
        expect(scrubSecrets(value)).toEqual(value);
        expect(scrubString(`1:${JSON.stringify(value)}`)).toBe(`1:${JSON.stringify(value)}`);
      }
    });
  });
});


describe("Next RSC response transport segments (B1)", () => {
  describe.each([
    { name: "inviteToken", token: "SENTRYTEST_ab" },
    { name: "claimToken", token: "SENTRYTEST_abcdefghij" },
  ])("$name", ({ name, token }) => {
    function fixture() {
      // Installed Next requires the fourth tuple entry (static siblings; null = unknown).
      const segment = segmentToTransportSegment([name, token, "d", null]);
      // Pin the installed Next wire shape: an upgrade must not make this proof vacuous.
      expect(segment).toHaveProperty("k", token);
      expect(segment).toHaveProperty("n", name);
      const wrap = (s: unknown) => ({ b: "build", f: [["", "children", { s, d: { r: { email: "alice@example.com", firstName: "Alice Example" } } }]], S: false });
      return { segment, payload: wrap(segment), expected: wrap(segmentToTransportSegment([name, FILTERED, "d", null])) };
    }

    describe.each(["plain", "escaped"])("resync after raw text (%s, S1)", (quoting) => {
      it.each([
        ["a Flight T row", "1:Ta,5' 2\" tall\n"],
        ["an unmatched quote in a log message", 'client said "hi '],
        ["an unmatched escaped quote", 'client said \\"hi '],
        ["three escaped quotes", '\\"one \\"two \\"three '],
      ])("filters the segment after %s, retaining the preceding text", (_label, prefix) => {
        const { payload, expected } = fixture();
        const encode = (value: unknown) => quoting === "plain" ? JSON.stringify(value) : JSON.stringify(JSON.stringify(value));
        const text = `${prefix}0:${encode(payload)}`;
        const result = scrubString(text);
        expect(result).toBe(`${prefix}0:${encode(expected)}`);
        expect(result).not.toContain(token);
        expect(result).toContain("alice@example.com");
        expect(scrubString(result)).toBe(result);
      });

      it("resyncs again after another unmatched quote between segments", () => {
        const { payload, expected } = fixture();
        const encode = (value: unknown) => quoting === "plain" ? JSON.stringify(value) : JSON.stringify(JSON.stringify(value));
        const rawNote = quoting === "plain" ? 'client said "hi ' : 'client said \\"hi ';
        const result = scrubString(`${rawNote}0:${encode(payload)}\n${rawNote}1:${encode(payload)}`);
        expect(result).toBe(`${rawNote}0:${encode(expected)}\n${rawNote}1:${encode(expected)}`);
      });
    });

    it("filters k in parsed values, retaining and recursively scrubbing the other members", () => {
      const { segment, payload, expected } = fixture();
      expect(scrubSecrets(payload)).toEqual(expected);
      expect(scrubString(JSON.stringify(payload))).toBe(JSON.stringify(expected));
      expect(segment).toHaveProperty("k", token);
      expect(scrubSecrets({ n: name, k: token, other: { claimToken: token }, email: "alice@example.com" })).toEqual({ n: name, k: FILTERED, other: { claimToken: FILTERED }, email: "alice@example.com" });
    });

    it("filters real Flight lines and escaped JSON inside strings", () => {
      const { payload, expected } = fixture();
      for (const encode of [
        (value: unknown) => `0:${JSON.stringify(value)}`,
        (value: unknown) => JSON.stringify(JSON.stringify(value)),
        (value: unknown) => `0:${JSON.stringify(JSON.stringify(value))}`,
        (value: unknown) => `0:${JSON.stringify({ body: JSON.stringify(value) })}`,
      ]) {
        const result = scrubString(encode(payload));
        expect(result).toBe(encode(expected));
        expect(result).toContain("alice@example.com");
        expect(result).not.toContain(token);
        expect(scrubString(result)).toBe(result);
      }
    });

    it("accepts whitespace around members and encoded whitespace inside a JSON string", () => {
      const text = `{ \n "n" \t: "${name}" ,\r "t" : "d" , "k" \n: \t"${token}" , "s" : null }`;
      for (const value of [text, JSON.stringify(text)]) {
        expect(scrubString(`0:${value}`)).toBe(`0:${value.replace(token, FILTERED)}`);
      }
    });

    it("stays in the matching object, crossing nested values without filtering their k members", () => {
      const value = { n: name, child: { k: "keep-child", text: "braces } and { in a string" }, list: [{ k: "keep-list" }], k: token, after: { k: "keep-after" } };
      for (const encode of [JSON.stringify, (v: unknown) => JSON.stringify(JSON.stringify(v))]) {
        expect(scrubString(`1:${encode(value)}`)).toBe(`1:${encode({ ...value, k: FILTERED })}`);
        const siblings = [{ n: name, child: { k: "keep-child" } }, { k: "keep-sibling" }];
        expect(scrubString(`1:${encode(siblings)}`)).toBe(`1:${encode(siblings)}`);
      }
    });

    it("filters nested matching objects and an outer k independently", () => {
      const value = { n: name, child: { n: name, k: token }, k: token };
      const expected = { n: name, child: { n: name, k: FILTERED }, k: FILTERED };
      expect(scrubString(`1:${JSON.stringify(value)}`)).toBe(`1:${JSON.stringify(expected)}`);
      expect(scrubString(`1:${JSON.stringify(JSON.stringify(value))}`)).toBe(`1:${JSON.stringify(JSON.stringify(expected))}`);
    });

    it("filters a truncated k string through EOF, in both quotings", () => {
      for (const quote of ['"', '\\"']) {
        const prefix = `1:{${quote}n${quote}:${quote}${name}${quote},${quote}t${quote}:${quote}d${quote},${quote}k${quote}:${quote}`;
        expect(scrubString(`${prefix}${token}`)).toBe(`${prefix}${FILTERED}${quote}`);
      }
    });
  });

  it("keeps ordinary segment names and non-string k values", () => {
    for (const value of [{ n: "slug", t: "d", k: "keep" }, { n: "inviteToken", k: null }, { n: "claimToken", k: 7 }]) {
      expect(scrubSecrets(value)).toEqual(value);
      expect(scrubString(`1:${JSON.stringify(value)}`)).toBe(`1:${JSON.stringify(value)}`);
    }
  });
});
