import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The admin entry key travels as a Server Function argument (enterAdmin);
  // the dev logger would otherwise print every call's arguments as JSON.
  logging: { serverFunctions: false },
  // The HEIC decoder is libheif compiled to WebAssembly (embedded in a JS
  // bundle); it uses Node features and runs inside a worker thread, so it is
  // required from node_modules instead of being bundled. `sharp` is already on
  // Next's built-in external list.
  serverExternalPackages: ["heic-decode", "libheif-js"],
  // The decoder is only ever loaded by name from inside the worker thread, so
  // nothing in the bundle references it and file tracing would drop it.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/heic-decode/**", "./node_modules/libheif-js/**"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        // Browser profiling (Sentry, plan 2026-11-04 §9.3): the JS Self-Profiling API only
        // runs when the document carries this policy. Chromium only; harmless elsewhere.
        source: "/:path*",
        headers: [{ key: "Document-Policy", value: "js-profiling" }],
      },
      {
        // Claim links carry the raw token in the path; never leak it through Referer,
        // not even to same-origin requests (they would land in request logs).
        source: "/m/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        // The family admin pages: never indexed, and admin URLs never reach another
        // host's logs through Referer. `:path*` is zero or more segments, so `/admin` matches.
        source: "/admin/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        // The README diagrams on /how-it-was-built (public/diagrams/*.svg, made by scripts/make-readme-diagrams.ts).
        // "Open … full size" opens one as a same-origin document, so lock it down even though every file passes
        // findUnsafeSvg: no script, no fetches; only its own <style> and the fonts and images it carries as data:
        // URLs. Rules add up, so the Document-Policy above still applies here.
        source: "/diagrams/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "med3ai",
  project: "jowray_com",
  // Route browser events through this app so ad blockers do not drop them.
  // Handler mode: app/sentry-tunnel/route.ts forwards only the envelope body
  // and works behind Vercel Deployment Protection (rewrite mode does not on
  // SDK 11.9+). The build prints the "tunnel route sends events through" line.
  tunnelRoute: "/sentry-tunnel",
  // Readable frames inside Next.js and React internals (longer builds, fine for the alpha).
  widenClientFileUpload: true,
  // data-sentry-component on every element, so replays and breadcrumbs name the component (Turbopack, Next 16+).
  reactComponentAnnotation: { enabled: true },
  // Paired with thirdPartyErrorFilterIntegration in instrumentation-client.ts: our frames vs. extensions.
  applicationKey: "jowray_com",
  telemetry: false,
  // Only CI and Vercel builds print upload logs.
  silent: !process.env.CI,
  // Without SENTRY_AUTH_TOKEN (local and worker builds) no source maps are
  // uploaded and the build stays quiet and deterministic.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
