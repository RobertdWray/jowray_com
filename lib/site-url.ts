import "server-only";

import { getSiteEnv } from "@/server/config/env";

/**
 * The absolute origin this deployment should use in links it generates
 * (claim links, Blob callback URLs). Production sets NEXT_PUBLIC_SITE_URL to
 * https://www.jowray.com; previews link to their own branch host; local
 * development falls back to localhost.
 */
export function getSiteUrl(): string {
  const env = getSiteEnv();
  if (env.NEXT_PUBLIC_SITE_URL) {
    return env.NEXT_PUBLIC_SITE_URL;
  }
  if (env.VERCEL_ENV === "preview" && env.VERCEL_BRANCH_URL) {
    return `https://${env.VERCEL_BRANCH_URL}`;
  }
  if (env.VERCEL_ENV === "production") {
    // Emailed claim links and the Blob callback URL must never point at localhost.
    throw new Error("NEXT_PUBLIC_SITE_URL must be set in production");
  }
  return "http://localhost:3000";
}
