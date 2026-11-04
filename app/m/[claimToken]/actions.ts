"use server";

import {
  cancelReservation as cancelReservationFeature,
  type ClaimMediaResult,
  removeMediaFromClaim,
  type ClaimUpdateResult,
  updateMediaFromClaim as updateMediaFromClaimFeature,
  updateMemoryFromClaim,
} from "@/features/memories/claim";
import {
  createReplacementTicket as createReplacementTicketFeature,
  createUploadTicket as createUploadTicketFeature,
  type UploadTicketResult,
} from "@/features/memories/create-memory";
import { finalizeUpload as finalizeUploadFeature, type FinalizeResult } from "@/features/memories/ingest-upload";
import { issueUploadTicket as issueUploadTicketFeature, type IssueTicketResult } from "@/features/memories/issue-upload-ticket";
import type { UploadTicket } from "@/lib/upload-ticket";

// Thin wrappers: validation and authorization (the claim-token check) live in features/.
// Server Functions are reachable by direct POST, so nothing here trusts the caller.

export async function updateMemory(input: { claimToken: string; changes: unknown }): Promise<ClaimUpdateResult> {
  return updateMemoryFromClaim(input);
}

export async function addFileTicket(input: unknown): Promise<UploadTicketResult> {
  return createUploadTicketFeature(input);
}

export async function replaceFileTicket(input: unknown): Promise<UploadTicketResult> {
  return createReplacementTicketFeature(input);
}

export async function finalizeAddedFile(input: { ticket: UploadTicket; claimToken: string }): Promise<FinalizeResult> {
  return finalizeUploadFeature(input);
}

export async function removeFile(input: unknown): Promise<ClaimMediaResult> {
  return removeMediaFromClaim(input);
}

export async function cancelReservation(input: unknown): Promise<ClaimMediaResult> {
  return cancelReservationFeature(input);
}

/** A fresh ticket for a file that was reserved but never arrived ("Try again"); the same path the share page uses per file. */
export async function retryUploadTicket(input: unknown): Promise<IssueTicketResult> {
  return issueUploadTicketFeature(input);
}

export async function updateMediaWords(input: unknown): Promise<ClaimMediaResult> {
  return updateMediaFromClaimFeature(input);
}
