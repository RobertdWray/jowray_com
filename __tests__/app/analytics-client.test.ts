import { describe, expect, it } from "vitest";

import { scrubPageView } from "@/app/_components/analytics-client";

const TOKEN = "SENTRYTEST_abcdefghijklmnop0123";

describe("scrubPageView (Vercel Web Analytics beforeSend)", () => {
  it("removes the claim token from a /m/<token> page view", () => {
    const event = scrubPageView({ type: "pageview", url: `https://www.jowray.com/m/${TOKEN}` });
    expect(event).toEqual({ type: "pageview", url: "https://www.jowray.com/m/[claimToken]" });
  });

  it("removes a ?t= claim token and keeps the other parameters", () => {
    const event = scrubPageView({ type: "pageview", url: `https://www.jowray.com/share?t=${TOKEN}&from=email` });
    expect(event?.url).toBe("https://www.jowray.com/share?from=email");
  });

  it("removes the admin entry key from the fragment", () => {
    const event = scrubPageView({ type: "pageview", url: `https://www.jowray.com/admin/enter#key=${TOKEN}` });
    expect(event?.url).toBe("https://www.jowray.com/admin/enter");
  });

  it("scrubs custom events the same way", () => {
    const event = scrubPageView({ type: "event", url: `https://www.jowray.com/m/${TOKEN}/` });
    expect(event).toEqual({ type: "event", url: "https://www.jowray.com/m/[claimToken]/" });
  });

  it("leaves an ordinary URL unchanged", () => {
    const url = "https://www.jowray.com/how-it-was-built?section=diagrams";
    expect(scrubPageView({ type: "pageview", url })?.url).toBe(url);
  });
});
