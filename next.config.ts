import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
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
        // Claim links carry the raw token in the path; never leak it through Referer,
        // not even to same-origin requests (they would land in request logs).
        source: "/m/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
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
  telemetry: false,
  // Only CI and Vercel builds print upload logs.
  silent: !process.env.CI,
  // Without SENTRY_AUTH_TOKEN (local and worker builds) no source maps are
  // uploaded and the build stays quiet and deterministic.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
