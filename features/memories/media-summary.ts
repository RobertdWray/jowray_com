import "server-only";

import { TICKET_TTL_MS } from "@/lib/upload-ticket";
import type { MediaKind, MediaPreview, MemoryMediaSummary } from "@/services/email";

/**
 * The columns the admin alert's file list needs; `notifyAdminsOfMemory` selects them. The receipts
 * (`confirmMemory`, `confirmSubmission`) list kind and length only and never call `summarizeReadyMedia`.
 */
export interface SummarizableMedia {
  id: string;
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
 * alert shows them, each with its preview from `previews` (keyed by media id;
 * `loadAdminPreviews` makes them) or null. Only the admin audience may see
 * previews: since issue #46 the contributor receipts take kind and length only
 * and never carry an uploaded picture.
 */
export function summarizeReadyMedia(rows: SummarizableMedia[], previews: ReadonlyMap<string, MediaPreview> = new Map()): MemoryMediaSummary[] {
  return rows
    .filter((row) => row.status === "READY")
    .map((row) => ({
      kind: mediaKindOf(row.mimeType),
      originalFilename: row.originalFilename,
      durationSeconds: row.durationSeconds,
      preview: previews.get(row.id) ?? null,
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
