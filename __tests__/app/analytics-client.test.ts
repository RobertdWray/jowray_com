import type { BeforeSendEvent } from "@vercel/analytics/next";
import { describe, expect, it } from "vitest";

import { scrubPageView } from "@/app/_components/analytics-client";

const TOKEN = "SENTRYTEST_abcdefghijklmnop0123";
const SITE = "https://www.jowray.com";

describe("scrubPageView (Vercel Web Analytics beforeSend)", () => {
  it("removes the claim token from a /m/<token> page view", () => {
    const event = scrubPageView({ type: "pageview", url: `${SITE}/m/${TOKEN}` });
    expect(event).toEqual({ type: "pageview", url: `${SITE}/m/[claimToken]` });
  });

  it("scrubs custom events on the claim page the same way", () => {
    const event = scrubPageView({ type: "event", url: `${SITE}/m/${TOKEN}?from=email` });
    expect(event).toEqual({ type: "event", url: `${SITE}/m/[claimToken]?from=email` });
  });

  it("removes a ?t= claim token and keeps the other parameters", () => {
    const event = scrubPageView({ type: "pageview", url: `${SITE}/share?t=${TOKEN}&from=email` });
    expect(event?.url).toBe(`${SITE}/share?from=email`);
  });

  it("removes the admin entry key from the fragment", () => {
    const event = scrubPageView({ type: "pageview", url: `${SITE}/admin/enter#key=${TOKEN}` });
    expect(event?.url).toBe(`${SITE}/admin/enter`);
  });

  it("leaves an ordinary URL unchanged", () => {
    const url = `${SITE}/how-it-was-built?section=diagrams`;
    expect(scrubPageView({ type: "pageview", url })?.url).toBe(url);
  });

  it("leaves paths that only start with the letter m unchanged", () => {
    for (const url of [`${SITE}/mx/${TOKEN}`, `${SITE}/media/abc`, `${SITE}/m`]) {
      expect(scrubPageView({ type: "pageview", url })?.url).toBe(url);
    }
  });

  // The route (`dp`) is sent outside beforeSend and is the raw pathname whenever
  // no page matched, so every token-bearing path except the claim route itself
  // must drop the whole event.
  it.each([
    ["an extra segment after the token", `/m/${TOKEN}/extra`],
    ["a trailing slash after the token", `/m/${TOKEN}/`],
    ["an upper-case M", `/M/${TOKEN}`],
    ["no token at all", "/m/"],
    ["a claim path below another segment", `/share/m/${TOKEN}`],
    ["a doubled leading slash", `//m/${TOKEN}`],
  ])("drops a page view with %s", (_case, path) => {
    expect(scrubPageView({ type: "pageview", url: `${SITE}${path}` })).toBeNull();
  });

  it("drops a custom event under a mismatched claim path", () => {
    expect(scrubPageView({ type: "event", url: `${SITE}/m/${TOKEN}/extra` })).toBeNull();
  });

  it("drops an event whose URL cannot be parsed", () => {
    expect(scrubPageView({ type: "pageview", url: `not a url /m/${TOKEN}` })).toBeNull();
  });

  it("keeps the runtime fields the script adds beyond the declared type", () => {
    // The script passes { type, url, payload, __cdp? } and reads payload and __cdp back.
    const payload = { name: "share-sent", data: { cards: 2 } };
    const event = { type: "event", url: `${SITE}/m/${TOKEN}`, payload, __cdp: true } as BeforeSendEvent;
    expect(scrubPageView(event)).toEqual({ type: "event", url: `${SITE}/m/[claimToken]`, payload, __cdp: true });
  });
});
