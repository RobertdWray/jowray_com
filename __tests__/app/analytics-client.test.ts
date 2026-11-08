import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { BeforeSendEvent } from "@vercel/analytics/next";
import type { SpeedInsightsProps } from "@vercel/speed-insights";
import { describe, expect, it } from "vitest";

import { scrubVercelEvent } from "@/app/_components/analytics-client";

const TOKEN = "SENTRYTEST_abcdefghijklmnop0123";
const SITE = "https://www.jowray.com";

describe("scrubVercelEvent (Vercel Web Analytics beforeSend)", () => {
  describe.each(["pageview", "event"] as const)("encoded paths for %s", (type) => {
    // The wrapper compares the encoded pathname with decoded params, so the route
    // (`dp`) it builds for these is the raw path, token included.
    it.each(["/s/%53ENTRYTEST_x", "/s/kENTRYTEST_x%6b", "/m/%53ENTRYTEST_abcdefghijklmnop0123", "/m/kENTRYTEST_claim%6B"])(
      "drops encoded token path %s, whose route would carry the token",
      (path) => {
        expect(scrubVercelEvent({ type, url: `${SITE}${path}?from=email` })).toBeNull();
      },
    );

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

  it("keeps percent-encoding outside a claim or invite token segment", () => {
    const ordinary = `${SITE}/memories/caf%C3%A9?tag=caf%C3%A9`;
    expect(scrubVercelEvent({ type: "pageview", url: ordinary })?.url).toBe(ordinary);
    const claim = scrubVercelEvent({ type: "pageview", url: `${SITE}/m/${TOKEN}?from=e%20mail` });
    expect(claim?.url).toBe(`${SITE}/m/[claimToken]?from=e%20mail`);
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
// the raw pathname on the root not-found page and on a claim or invite link with an
// encoded token character, and can lag behind a client navigation. A claim or invite
// route other than the exact placeholder therefore has to drop the whole event.
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

  // Reproduced live on 2026-11-08: a hard load of an encoded claim or invite link left the
  // wrapper's route as the raw path, because computeRoute compares the encoded
  // pathname with decoded params.
  it.each([
    "/m/%53ENTRYTEST_abcdefghijklmnop0123",
    "/s/%53ENTRYTEST_invite01",
  ])("drops an encoded-token vital whose route the wrapper left raw: %s (T8)", (link) => {
    expect(scrubVercelEvent(vital(link, link))).toBeNull();
  });

  it.each([
    `/m/${TOKEN}`,
    "/s/SENTRYTEST_invite01",
    "/m/%53ENTRYTEST_abcdefghijklmnop0123",
  ])("drops a vital whose single-segment route %s carries a token even when the URL is safe (T9)", (route) => {
    expect(scrubVercelEvent(vital("/", route))).toBeNull();
  });

  it.each(["/m/[claimToken]", "/s/[inviteToken]"])("keeps a lagging placeholder route %s under another page's URL (T10)", (route) => {
    const event = vital("/how-it-was-built", route);
    expect(scrubVercelEvent(event)).toEqual(event);
  });

  it.each(["/M/[claimToken]", "/m/[claimtoken]", "/m/[claimToken]/", "/S/[inviteToken]", "/s/[InviteToken]"])(
    "accepts only the exact placeholder, so route %s drops (T11)",
    (route) => {
      expect(scrubVercelEvent(vital("/", route))).toBeNull();
    },
  );

  it("names the placeholders after the dynamic route folders the wrapper reads (T12)", () => {
    // useParams() keys come from these folders; renaming one would drop every vital on that page.
    expect(existsSync(resolve(__dirname, "../../app/m/[claimToken]/page.tsx"))).toBe(true);
    expect(existsSync(resolve(__dirname, "../../app/s/[inviteToken]/page.tsx"))).toBe(true);
  });
});
