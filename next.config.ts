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
  tunnelRoute: "/monitoring",
  telemetry: false,
  // Only CI and Vercel builds print upload logs.
  silent: !process.env.CI,
  // Without SENTRY_AUTH_TOKEN (local and worker builds) no source maps are
  // uploaded and the build stays quiet and deterministic.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
