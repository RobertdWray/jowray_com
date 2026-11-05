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
import { scrubHeaders, scrubRecordingEvent, scrubReplayEvent, scrubSecrets } from "@/lib/sentry/scrub";
import { SECRET_FIELD_KEYS, SECRET_HEADER_KEYS, SECRET_KEY_FRAGMENTS } from "@/lib/sentry/secrets";

const TEST_TOKEN = "SENTRYTEST_" + "a".repeat(32);
const TEST_TOKEN_2 = "SENTRYTEST_" + "b".repeat(32);
const FILTERED = "[Filtered]";

describe("secrets constants", () => {
  it("name the bearer fields, key fragments and headers", () => {
    expect(SECRET_FIELD_KEYS).toEqual(["claimToken", "claimTokens", "claimLink", "ticket", "clientPayload", "sig", "key"]);
    expect(SECRET_KEY_FRAGMENTS).toEqual(["token", "ticket"]);
    expect(SECRET_HEADER_KEYS).toEqual(["cookie", "authorization", "x-vercel-protection-bypass", "x-vercel-signature", "next-router-state-tree"]);
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
// Team Code Review of PR #47 (George #1): the key's quoting and the value's
// quoting can disagree in malformed text. The value's own opening quote decides
// how far the value runs; when the value is not a string, the more cautious
// (escaped) reading wins. Either way the whole value goes, never a tail of it.
// ---------------------------------------------------------------------------
describe("mixed quoting between a secret key and its value (PR #47 review, George #1)", () => {
  it("consumes exactly the plain string value after an escaped-looking key (a backslash before the key in broken JSON or log text)", () => {
    expect(scrubSecrets(`{"a":"\\"token":"${TEST_TOKEN}"}`)).toBe(`{"a":"\\"token":"${FILTERED}"}`);
    expect(scrubSecrets(`C:\\dir\\"token":"${TEST_TOKEN}" tail`)).toBe(`C:\\dir\\"token":"${FILTERED}" tail`);
  });

  it("consumes the whole escaped string value after a plain key, including spaces and commas inside it", () => {
    expect(scrubSecrets(`"token\\":\\"${TEST_TOKEN}\\"`)).toBe(`"token\\":\\"${FILTERED}\\"`);
    expect(scrubSecrets(`"token\\":\\"${TEST_TOKEN} tail\\" rest`)).toBe(`"token\\":\\"${FILTERED}\\" rest`);
    expect(scrubSecrets(`"claimToken":\\"${TEST_TOKEN},x\\" rest`)).toBe(`"claimToken":\\"${FILTERED}\\" rest`);
  });

  it("never leaves a tail of a secret value behind whatever the quoting, and stays idempotent", () => {
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
