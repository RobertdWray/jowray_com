"use server";

import { completeSubmission as completeSubmissionFeature, type ConfirmResult } from "@/features/memories/confirm";
import {
  createMemory as createMemoryFeature,
  createUploadTicket as createUploadTicketFeature,
  issueUploadTicket as issueUploadTicketFeature,
  type CreateMemoryResult,
  type UploadTicketResult,
} from "@/features/memories/create-memory";
import { finalizeUpload as finalizeUploadFeature, type FinalizeResult } from "@/features/memories/ingest-upload";
import type { UploadTicket } from "@/lib/upload-ticket";

// Thin Server Functions: validation and authorization live in features/
// (the ticket and claim token are verified there, not in a proxy).

export async function createMemory(input: unknown): Promise<CreateMemoryResult> {
  return createMemoryFeature(input);
}

export async function createUploadTicket(input: unknown): Promise<UploadTicketResult> {
  return createUploadTicketFeature(input);
}

export async function finalizeUpload(input: { ticket: UploadTicket; claimToken: string }): Promise<FinalizeResult> {
  return finalizeUploadFeature(input);
}

export async function issueUploadTicket(input: unknown): Promise<UploadTicketResult> {
  return issueUploadTicketFeature(input);
}

export async function completeSubmission(input: { claimToken: string }): Promise<ConfirmResult> {
  return completeSubmissionFeature(input);
}
