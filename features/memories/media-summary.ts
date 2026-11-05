import "server-only";

import { TICKET_TTL_MS } from "@/lib/upload-ticket";
import type { MediaKind, MemoryMediaSummary } from "@/services/email";

/** The columns the email summaries need; both `confirmMemory` and `notifyAdminsOfMemory` select exactly these. */
export interface SummarizableMedia {
  status: "PENDING" | "READY" | "FAILED";
  mimeType: string;
  originalFilename: string | null;
  durationSeconds: number | null;
}

export function mediaKindOf(mimeType: string): MediaKind {
  if (mimeType.startsWith("image/")) {
    return "PHOTO";
  }
  if (mimeType.startsWith("audio/")) {
    return "VOICE";
  }
  return "VIDEO";
}

/**
 * READY files in the order given (callers order by `createdAt`), as the admin
 * alert shows them. `preview` stays null until the derived-media pipeline
 * (issue #17 PR A) fills it here. Only the admin audience may see previews:
 * since issue #46 the contributor receipts take kind and length only and never
 * carry an uploaded picture.
 */
export function summarizeReadyMedia(rows: SummarizableMedia[]): MemoryMediaSummary[] {
  return rows
    .filter((row) => row.status === "READY")
    .map((row) => ({
      kind: mediaKindOf(row.mimeType),
      originalFilename: row.originalFilename,
      durationSeconds: row.durationSeconds,
      preview: null,
    }));
}

/**
 * Is this submission still sending files? Rows are created when the memory
 * is and ticketed later, so a reservation counts as in flight while the
 * submission lease is open, or (claim-page adds, no lease) while it is
 * younger than a ticket lifetime. Both emails wait for it unless the
 * contributor settles the submission (completeSubmission).
 */
export function submissionInFlight(memory: { uploadLeaseUntil: Date | null; media: Array<{ status: string; createdAt: Date }> }, now = Date.now()): boolean {
  const leaseOpen = memory.uploadLeaseUntil !== null && memory.uploadLeaseUntil.getTime() > now;
  return memory.media.some((m) => m.status === "PENDING" && (leaseOpen || m.createdAt.getTime() > now - TICKET_TTL_MS));
}
