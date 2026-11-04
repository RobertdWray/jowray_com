"use server";

import {
  createMemory as createMemoryFeature,
  createUploadTicket as createUploadTicketFeature,
  type CreateMemoryResult,
  type UploadTicketResult,
} from "@/features/memories/create-memory";
import { completeSubmission as completeSubmissionFeature, type CompleteSubmissionResult } from "@/features/memories/complete-submission";
import { createSubmission as createSubmissionFeature, type CreateSubmissionResult } from "@/features/memories/create-submission";
import { finalizeUpload as finalizeUploadFeature, type FinalizeResult } from "@/features/memories/ingest-upload";
import { issueUploadTicket as issueUploadTicketFeature, type IssueTicketResult } from "@/features/memories/issue-upload-ticket";
import type { UploadTicket } from "@/lib/upload-ticket";

// Thin Server Functions: validation and authorization live in features/
// (the ticket and claim token are verified there, not in a proxy). Server
// Functions are reachable by direct POST, so nothing here trusts the caller.

/** A whole send from the memory cards (Task 15): the contributor once, 1–10 memories, files ticketed later one by one. */
export async function createSubmission(input: unknown): Promise<CreateSubmissionResult> {
  return createSubmissionFeature(input);
}

/** The ticket for one file, minted right before its upload. */
export async function issueUploadTicket(input: unknown): Promise<IssueTicketResult> {
  return issueUploadTicketFeature(input);
}

/** Called once after the uploads, with every raw token, so the receipt can carry every link. */
export async function completeSubmission(input: unknown): Promise<CompleteSubmissionResult> {
  return completeSubmissionFeature(input);
}

export async function createMemory(input: unknown): Promise<CreateMemoryResult> {
  return createMemoryFeature(input);
}

export async function createUploadTicket(input: unknown): Promise<UploadTicketResult> {
  return createUploadTicketFeature(input);
}

export async function finalizeUpload(input: { ticket: UploadTicket; claimToken: string }): Promise<FinalizeResult> {
  return finalizeUploadFeature(input);
}
