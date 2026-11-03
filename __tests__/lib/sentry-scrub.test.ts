import { describe, expect, it } from "vitest";

import { scrubBreadcrumb, scrubEvent, scrubSpan, scrubUrl } from "@/lib/sentry/scrub";

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
