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
  return "http://localhost:3000";
}
