import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createInvites } from "@/features/invites/create-invites";
import { getSiteUrl } from "@/lib/site-url";
import { createInvitesInputSchema } from "@/lib/validations/invite";
import { getMemorialEnv } from "@/server/config/env";

import { errorResponse, unauthorized } from "../_auth";

export const maxDuration = 30;

function serverBinding(): { memorialSlug: string; siteUrl: string } {
  return { memorialSlug: getMemorialEnv().MEMORIAL_SLUG, siteUrl: getSiteUrl() };
}

/** Bearer-protected, read-only preflight: confirm the server's memorial and link origin before importing. */
export async function GET(request: NextRequest): Promise<Response> {
  const denied = unauthorized(request);
  if (denied) {
    return denied;
  }
  return NextResponse.json({ success: true, data: serverBinding() });
}

/**
 * Import approved invitees through scripts/import-invites.ts. Bearer
 * ADMIN_API_SECRET; body: createInvitesInputSchema (at most 200 invites).
 * 200 { success: true, data: { results, memorialSlug, siteUrl } }; 400 invalid; 401 unauthorized.
 * Results identify input indices, never emails. Newly issued tokens belong
 * only in the private local ledger; the feature logs counts, never the body.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const denied = unauthorized(request);
  if (denied) {
    return denied;
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid", "The body must be JSON");
  }
  const parsed = createInvitesInputSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "invalid", parsed.error.issues[0]?.message ?? "Invalid invite input");
  }
  const binding = serverBinding();
  const results = await createInvites(parsed.data);
  return NextResponse.json({ success: true, data: { results, ...binding } });
}
