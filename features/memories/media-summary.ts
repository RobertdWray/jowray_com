import "server-only";

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
 * READY files in the order given (callers order by `createdAt`), as the email
 * templates show them. `preview` stays null until the derived-media pipeline
 * (issue #17 PR A) fills it here, for both the confirmation and the admin
 * alert at once.
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
