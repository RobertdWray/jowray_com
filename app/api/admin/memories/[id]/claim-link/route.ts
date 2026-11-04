import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { reissueDraftClaimLink } from "@/features/memories/draft-memory";

import { errorResponse, unauthorized } from "../../../_auth";

export const maxDuration = 30;

/**
 * Reissue a DRAFT's claim link (a deliberate revocation: any link already
 * sent stops working). Bearer `ADMIN_API_SECRET`.
 * 200 { memoryId, claimLink } · 400 invalid id · 404 not_found · 409 not_draft.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/api/admin/memories/[id]/claim-link">): Promise<Response> {
  const denied = unauthorized(request);
  if (denied) {
    return denied;
  }
  const { id } = await params;
  const result = await reissueDraftClaimLink({ memoryId: id });
  if (result.ok) {
    return NextResponse.json({ success: true, data: { memoryId: result.memoryId, claimLink: result.claimLink } });
  }
  switch (result.code) {
    case "invalid":
      return errorResponse(400, "invalid", "The memory id must be a UUID");
    case "not_found":
      return errorResponse(404, "not_found", "No such memory");
    case "not_draft":
      return errorResponse(409, "not_draft", "This memory has already been shared; its link cannot be reissued");
  }
}
