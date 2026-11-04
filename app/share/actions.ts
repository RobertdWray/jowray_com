"use server";

import { completeSubmission as completeSubmissionFeature, type CompleteSubmissionResult } from "@/features/memories/complete-submission";
import { createSubmission as createSubmissionFeature, type CreateSubmissionResult } from "@/features/memories/create-submission";
import { finalizeUpload as finalizeUploadFeature, type FinalizeResult } from "@/features/memories/ingest-upload";
import { issueUploadTicket as issueUploadTicketFeature, type IssueTicketResult } from "@/features/memories/issue-upload-ticket";
import { instrumentedAction } from "@/lib/sentry/server-action";
import type { UploadTicket } from "@/lib/upload-ticket";

// Thin Server Functions: validation and authorization live in features/
// (the ticket and claim token are verified there, not in a proxy). Server
// Functions are reachable by direct POST, so nothing here trusts the caller.
// Each one is instrumented by name (traces, scrubbed input and result).

/** A whole send from the memory cards (Task 15): the contributor once, 1–10 memories, files ticketed later one by one. */
export async function createSubmission(input: unknown): Promise<CreateSubmissionResult> {
  return instrumentedAction("createSubmission", input, () => createSubmissionFeature(input));
}

/** The ticket for one file, minted right before its upload. */
export async function issueUploadTicket(input: unknown): Promise<IssueTicketResult> {
  return instrumentedAction("issueUploadTicket", input, () => issueUploadTicketFeature(input));
}

/** Called once after the uploads, with every raw token, so the receipt can carry every link. */
export async function completeSubmission(input: unknown): Promise<CompleteSubmissionResult> {
  return instrumentedAction("completeSubmission", input, () => completeSubmissionFeature(input));
}

export async function finalizeUpload(input: { ticket: UploadTicket; claimToken: string }): Promise<FinalizeResult> {
  return instrumentedAction("finalizeUpload", input, () => finalizeUploadFeature(input));
}
