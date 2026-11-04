import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };

/** The response headers PR 3 of plan 2026-11-04 relies on (§9.3): browser profiling needs `Document-Policy: js-profiling` on every page. */
describe("next.config headers", () => {
  it("sends Document-Policy: js-profiling on every path and keeps the claim pages' Referrer-Policy", async () => {
    const rules = (await nextConfig.headers!()) as HeaderRule[];
    const all = rules.find((rule) => rule.source === "/:path*");
    expect(all?.headers).toContainEqual({ key: "Document-Policy", value: "js-profiling" });
    const claim = rules.find((rule) => rule.source === "/m/:path*");
    expect(claim?.headers).toContainEqual({ key: "Referrer-Policy", value: "no-referrer" });
  });
});
