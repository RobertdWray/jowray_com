"use server";

import { updateMemoryFromClaim, type ClaimUpdateResult } from "@/features/memories/claim";
import { createUploadTicket as createUploadTicketFeature, type UploadTicketResult } from "@/features/memories/create-memory";
import { finalizeUpload as finalizeUploadFeature, type FinalizeResult } from "@/features/memories/ingest-upload";
import type { UploadTicket } from "@/lib/upload-ticket";

export async function updateMemory(input: { claimToken: string; changes: unknown }): Promise<ClaimUpdateResult> {
  return updateMemoryFromClaim(input);
}

export async function addFileTicket(input: unknown): Promise<UploadTicketResult> {
  return createUploadTicketFeature(input);
}

export async function finalizeAddedFile(input: { ticket: UploadTicket; claimToken: string }): Promise<FinalizeResult> {
  return finalizeUploadFeature(input);
}
