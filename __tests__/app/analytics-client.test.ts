import type { BeforeSendEvent } from "@vercel/analytics/next";
import type { SpeedInsightsProps } from "@vercel/speed-insights";
import { describe, expect, it } from "vitest";

import { scrubVercelEvent } from "@/app/_components/analytics-client";

const TOKEN = "SENTRYTEST_abcdefghijklmnop0123";
const SITE = "https://www.jowray.com";

describe("scrubVercelEvent (Vercel Web Analytics beforeSend)", () => {
  describe.each(["pageview", "event"] as const)("encoded paths for %s", (type) => {
    it.each([
      ["/s/%53ENTRYTEST_x", "/s/[inviteToken]"],
      ["/s/kENTRYTEST_x%6b", "/s/[inviteToken]"],
      ["/m/%53ENTRYTEST_abcdefghijklmnop0123", "/m/[claimToken]"],
      ["/m/kENTRYTEST_claim%6B", "/m/[claimToken]"],
    ])("keeps canonical route %s with a scrubbed URL", (path, expected) => {
      expect(scrubVercelEvent({ type, url: `${SITE}${path}?from=email` })).toEqual({ type, url: `${SITE}${expected}?from=email` });
    });

    it.each([`/%73/${TOKEN}`, `/%6D/${TOKEN}`, `/%6d/${TOKEN}`, `/x/%73/${TOKEN}`, `/x/%6d/${TOKEN}`])("drops encoded route segment %s", (path) => {
      expect(scrubVercelEvent({ type, url: `${SITE}${path}` })).toBeNull();
    });

    it.each(["/s/%", "/m/%GG", "/share/%E0%A4", "/s/SENTRYTEST_x%", "/m/SENTRYTEST_claim%GG"])("drops malformed encoding %s", (path) => {
      expect(scrubVercelEvent({ type, url: `${SITE}${path}` })).toBeNull();
    });
  });

  it.each(["pageview", "event"] as const)("keeps an invite %s with its URL scrubbed", (type) => {
    const event = scrubVercelEvent({ type, url: "https://www.example.com/s/SENTRYTEST_x?from=email" });
    expect(event?.url).toBe("https://www.example.com/s/[inviteToken]?from=email");
    expect(event?.type).toBe(type);
  });

  it.each(["/s/SENTRYTEST_x/", "/s/a/b", "/S/SENTRYTEST_x", "/x/s/SENTRYTEST_x", "/s/", "//s/SENTRYTEST_x"])("drops mismatched invite path %s", (path) => {
    for (const type of ["pageview", "event"] as const) {
      expect(scrubVercelEvent({ type, url: `https://www.example.com${path}` })).toBeNull();
    }
  });

  it("leaves /share and non-invite s prefixes unchanged", () => {
    for (const path of ["/share", "/s", "/stories/SENTRYTEST_x"]) {
      const url = `https://www.example.com${path}`;
      expect(scrubVercelEvent({ type: "pageview", url })?.url).toBe(url);
    }
  });

  it("removes the claim token from a /m/<token> page view", () => {
    const event = scrubVercelEvent({ type: "pageview", url: `${SITE}/m/${TOKEN}` });
    expect(event).toEqual({ type: "pageview", url: `${SITE}/m/[claimToken]` });
  });

  it("scrubs custom events on the claim page the same way", () => {
    const event = scrubVercelEvent({ type: "event", url: `${SITE}/m/${TOKEN}?from=email` });
    expect(event).toEqual({ type: "event", url: `${SITE}/m/[claimToken]?from=email` });
  });

  it("removes a ?t= claim token and keeps the other parameters", () => {
    const event = scrubVercelEvent({ type: "pageview", url: `${SITE}/share?t=${TOKEN}&from=email` });
    expect(event?.url).toBe(`${SITE}/share?from=email`);
  });

  it("removes the admin entry key from the fragment", () => {
    const event = scrubVercelEvent({ type: "pageview", url: `${SITE}/admin/enter#key=${TOKEN}` });
    expect(event?.url).toBe(`${SITE}/admin/enter`);
  });

  it("leaves an ordinary URL unchanged", () => {
    const url = `${SITE}/how-it-was-built?section=diagrams`;
    expect(scrubVercelEvent({ type: "pageview", url })?.url).toBe(url);
  });

  it("leaves paths that only start with the letter m unchanged", () => {
    for (const url of [`${SITE}/mx/${TOKEN}`, `${SITE}/media/abc`, `${SITE}/m`]) {
      expect(scrubVercelEvent({ type: "pageview", url })?.url).toBe(url);
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
    expect(scrubVercelEvent({ type: "pageview", url: `${SITE}${path}` })).toBeNull();
  });

  it("drops a custom event under a mismatched claim path", () => {
    expect(scrubVercelEvent({ type: "event", url: `${SITE}/m/${TOKEN}/extra` })).toBeNull();
  });

  it("drops an event whose URL cannot be parsed", () => {
    expect(scrubVercelEvent({ type: "pageview", url: `not a url /m/${TOKEN}` })).toBeNull();
  });

  it("keeps the runtime fields the script adds beyond the declared type", () => {
    // The script passes { type, url, payload, __cdp? } and reads payload and __cdp back.
    const payload = { name: "share-sent", data: { cards: 2 } };
    const event = { type: "event", url: `${SITE}/m/${TOKEN}`, payload, __cdp: true } as BeforeSendEvent;
    expect(scrubVercelEvent(event)).toEqual({ type: "event", url: `${SITE}/m/[claimToken]`, payload, __cdp: true });
  });
});

// Speed Insights script 0.1.3 calls beforeSend({ type: "vital", url, route }) and
// copies back only the returned `url`. `url` is location.href (query and fragment
// included); `route` comes from the Next wrapper (useParams + computeRoute), which is
// the raw pathname on the root not-found page and can lag behind a client navigation.
// A token-bearing route therefore has to drop the whole event.
type VitalEvent = Parameters<NonNullable<SpeedInsightsProps["beforeSend"]>>[0];

describe("scrubVercelEvent (Vercel Speed Insights beforeSend)", () => {
  const vital = (path: string, route?: string): VitalEvent =>
    route === undefined ? { type: "vital", url: `${SITE}${path}` } : { type: "vital", url: `${SITE}${path}`, route };

  it("keeps a claim-page vital with the token, ?t= and #key= removed from the URL (T1)", () => {
    const event = scrubVercelEvent(vital(`/m/${TOKEN}?t=${TOKEN}#key=${TOKEN}`, "/m/[claimToken]"));
    expect(event).toEqual({ type: "vital", url: `${SITE}/m/[claimToken]`, route: "/m/[claimToken]" });
    expect(JSON.stringify(event)).not.toContain("SENTRYTEST_");
  });

  it("keeps an invite-page vital with its URL scrubbed (T2)", () => {
    const event = scrubVercelEvent(vital("/s/SENTRYTEST_invite01?from=email", "/s/[inviteToken]"));
    expect(event).toEqual({ type: "vital", url: `${SITE}/s/[inviteToken]?from=email`, route: "/s/[inviteToken]" });
  });

  it.each([
    ["an upper-case M", `/M/${TOKEN}`],
    ["an extra claim segment", `/m/${TOKEN}/extra`],
    ["a trailing slash", `/m/${TOKEN}/`],
    ["a nested invite path", `/share/s/${TOKEN}`],
    ["an encoded m segment", `/%6d/${TOKEN}`],
  ])("drops a vital whose route has %s even when the URL is safe (T3)", (_case, route) => {
    expect(scrubVercelEvent(vital("/", route))).toBeNull();
  });

  it("drops a not-found claim path whose raw route carries the token (T4)", () => {
    expect(scrubVercelEvent(vital(`/m/${TOKEN}/extra`, `/m/${TOKEN}/extra`))).toBeNull();
  });

  it("keeps an ordinary vital and its static route unchanged (T5)", () => {
    const event = vital("/share?from=email", "/share");
    expect(scrubVercelEvent(event)).toEqual(event);
  });

  it("keeps a vital that carries no route (T6)", () => {
    const event = vital("/how-it-was-built");
    expect(scrubVercelEvent(event)).toEqual(event);
  });

  it("drops a vital whose route has malformed percent-encoding (T7)", () => {
    expect(scrubVercelEvent(vital("/share", "/%E0%A4"))).toBeNull();
  });
});
