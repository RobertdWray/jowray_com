import { type NextRequest, NextResponse } from "next/server";

import { safeEqualHex } from "@/lib/claim-token";
import { getAdminEnv } from "@/server/config/env";

/**
 * Bearer check for the admin API, the same fail-closed, constant-time shape as
 * the cron route: no secret configured, or a wrong one, answers 401. Callers
 * read `request.headers` here as their first request-time read (Cache
 * Components rule) before touching Prisma or env.
 */
export function unauthorized(request: NextRequest): NextResponse | null {
  const authorization = request.headers.get("authorization") ?? "";
  const secret = getAdminEnv().ADMIN_API_SECRET;
  if (!secret || !safeEqualHex(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
  }
  return null;
}

export function errorResponse(status: number, code: string, message: string, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}
