import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { draftMemory } from "@/features/memories/draft-memory";
import { createLogger } from "@/lib/logger";

import { errorResponse, unauthorized } from "../_auth";

export const maxDuration = 30;

const log = createLogger({ category: "api" });

/**
 * Draft a memory on a sender's behalf (the jowray-draft-memory skill, through
 * scripts/draft-memory.ts). Bearer `ADMIN_API_SECRET`. Body: draftMemoryInputSchema.
 * 200 { memoryId, claimLink } · 400 invalid · 409 duplicate { memoryId, status } · 429 budget_exceeded.
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
  const result = await draftMemory(body);
  if (result.ok) {
    return NextResponse.json({ success: true, data: { memoryId: result.memoryId, claimLink: result.claimLink } });
  }
  switch (result.code) {
    case "invalid":
      return errorResponse(400, "invalid", result.message);
    case "duplicate":
      log.info({ action: "admin_draft_duplicate", memoryId: result.memoryId }, "draft refused: source already has a memory");
      return errorResponse(409, "duplicate", "A memory already exists for this source", { memoryId: result.memoryId, status: result.status });
    case "budget_exceeded":
      return errorResponse(429, "budget_exceeded", "The daily memory budget is spent; try again later");
  }
}
