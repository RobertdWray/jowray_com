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

  it("locks the README diagram SVGs down when they are opened as documents, without dropping the global rule", async () => {
    const rules = (await nextConfig.headers!()) as HeaderRule[];
    const diagrams = rules.find((rule) => rule.source === "/diagrams/:path*");
    expect(diagrams?.headers).toContainEqual({
      key: "Content-Security-Policy",
      value: "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:",
    });
    expect(diagrams?.headers).toContainEqual({ key: "X-Content-Type-Options", value: "nosniff" });
    // Next.js applies every matching rule, so /diagrams/* keeps the site-wide Document-Policy too.
    const all = rules.find((rule) => rule.source === "/:path*");
    expect(all?.headers).toContainEqual({ key: "Document-Policy", value: "js-profiling" });
    expect(all?.headers.map((header) => header.key)).not.toContain("Content-Security-Policy");
  });
});
