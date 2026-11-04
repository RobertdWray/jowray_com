import type { CardMediaItem, MemoryCard } from "@/lib/memory-cards";

/**
 * The browser side of a send (Task 15): create the whole submission once,
 * upload every file one at a time (photos first, since they are small and
 * make the email), finalize each, and complete exactly once in a `finally`.
 * Dependency-injected so the sequencing, retry and progress rules are tested
 * in Node; the form passes the Server Functions and `uploadWithTicket`.
 */

/** The browser's view of the Server Functions it calls; structurally typed so this module imports nothing above `lib/`. */
export interface PipelineTicket {
  mediaId: string;
  memoryId: string;
  pathname: string;
  mimeType: string;
  maxBytes: number;
  expiresAt: number;
  sig: string;
}
export interface PipelineGrant {
  pathname: string;
  ticket: PipelineTicket;
}
export type PipelineCreateResult =
  | { ok: true; submissionId: string; memories: Array<{ index: number; memoryId: string; claimToken: string; files: Array<{ fileIndex: number; mediaId: string }> }>; emailed: boolean }
  | { ok: false; code: string; message: string; memoryIndex: number | null; fileIndex: number | null };
export type PipelineTicketResult = { ok: true; upload: PipelineGrant } | { ok: false; code: string };
export type PipelineFinalizeResult = { status: "READY" | "PENDING" | "FAILED" | "REJECTED" };
export type PipelineCompleteResult = { ok: true; emailed: boolean } | { ok: false; code: string };

export interface PipelineDeps {
  createSubmission(input: unknown): Promise<PipelineCreateResult>;
  issueUploadTicket(input: { claimToken: string; mediaId: string }): Promise<PipelineTicketResult>;
  upload(grant: PipelineGrant, file: File, onProgress: (percentage: number) => void): Promise<void>;
  finalizeUpload(input: { ticket: PipelineTicket; claimToken: string }): Promise<PipelineFinalizeResult>;
  completeSubmission(input: { claimTokens: string[] }): Promise<PipelineCompleteResult>;
}

export interface PipelineInput {
  name: string;
  relationship: string;
  email: string;
  visibility: "PUBLIC" | "FAMILY" | "PRIVATE";
  contactOptIn: boolean;
  mailingListOptIn: boolean;
  notifyWhenPosted: boolean;
  /** The cards being sent, in order; only these are numbered. */
  cards: MemoryCard[];
}

export interface PipelineProgress {
  fileNumber: number;
  fileCount: number;
  /** Byte-weighted across the whole send. */
  percent: number;
  cardId: string;
  mediaId: string;
  text: string;
}

export interface PipelineMemory {
  position: number;
  cardId: string;
  claimToken: string;
  claimLink: string;
  /** Names of files that did not make it after the retry. */
  failedFiles: string[];
}

export type PipelineResult =
  | { ok: true; submissionId: string; memories: PipelineMemory[]; emailed: boolean }
  | { ok: false; code: string; message: string; memoryIndex: number | null; fileIndex: number | null };

export interface PipelineHooks {
  /** `window.location.origin`, for the on-screen links. */
  origin: string;
  onProgress?: (progress: PipelineProgress) => void;
  /** Each file's outcome as it is known, for the per-row progress bars. */
  onFileDone?: (cardId: string, mediaId: string, ok: boolean) => void;
}

export const UNREACHABLE_MESSAGE = "We couldn't get through just now. Nothing was lost; your words are still here. Check your connection and press Send again.";

export function progressText(fileNumber: number, fileCount: number, percent: number): string {
  return `Sending file ${fileNumber} of ${fileCount} · ${percent}% done`;
}

function toFileInput(item: CardMediaItem): { name: string; type: string; size: number; durationSeconds?: number } {
  return { name: item.name, type: item.mimeType, size: item.size, ...(item.source === "recording" && item.durationSeconds ? { durationSeconds: item.durationSeconds } : {}) };
}

interface Job {
  cardIndex: number;
  cardId: string;
  item: CardMediaItem;
  mediaId: string;
  claimToken: string;
}

/** One attempt: ticket, upload, finalize. Returns the file's status, or null when the upload failed and the file is not there. */
async function attempt(job: Job, deps: PipelineDeps, onProgress: (pct: number) => void): Promise<"READY" | "PENDING" | "FAILED" | "REJECTED" | "no_ticket" | "not_pending" | "not_there"> {
  const ticketed = await deps.issueUploadTicket({ claimToken: job.claimToken, mediaId: job.mediaId });
  if (!ticketed.ok) {
    // `not_pending` on a retry means the first upload landed after all and the callback recorded it.
    return ticketed.code === "not_pending" ? "not_pending" : "no_ticket";
  }
  let uploaded = true;
  try {
    await deps.upload(ticketed.upload, job.item.file, onProgress);
  } catch {
    // The file may still have landed (multipart retries, a lost response): finalize before deciding.
    uploaded = false;
  }
  const finalized = await deps.finalizeUpload({ ticket: ticketed.upload.ticket, claimToken: job.claimToken });
  if (!uploaded && finalized.status === "PENDING") {
    return "not_there";
  }
  return finalized.status;
}

export async function runSubmission(input: PipelineInput, deps: PipelineDeps, hooks: PipelineHooks): Promise<PipelineResult> {
  const { cards, ...contributor } = input;
  let created: PipelineCreateResult;
  try {
    created = await deps.createSubmission({
      ...contributor,
      memories: cards.map((card) => ({ approxDateText: card.approxDateText, place: card.place, note: card.note, files: card.media.map(toFileInput) })),
    });
  } catch {
    // Unknown outcome (network, timeout): never resend on our own.
    return { ok: false, code: "unreachable", message: UNREACHABLE_MESSAGE, memoryIndex: null, fileIndex: null };
  }
  if (!created.ok) {
    return created;
  }

  const memories: PipelineMemory[] = created.memories.map((m) => ({
    position: m.index + 1,
    cardId: cards[m.index]!.id,
    claimToken: m.claimToken,
    claimLink: `${hooks.origin}/m/${m.claimToken}`,
    failedFiles: [],
  }));
  const jobs: Job[] = [];
  for (const memory of created.memories) {
    const card = cards[memory.index]!;
    for (const file of memory.files) {
      const item = card.media[file.fileIndex];
      if (item) {
        jobs.push({ cardIndex: memory.index, cardId: card.id, item, mediaId: file.mediaId, claimToken: memory.claimToken });
      }
    }
  }
  if (jobs.length === 0) {
    // A text-only send is completed on the server, inside createSubmission.
    return { ok: true, submissionId: created.submissionId, memories, emailed: created.emailed };
  }
  // Photos first: small, and they make the email's thumbnails.
  jobs.sort((a, b) => Number(b.item.kind === "PHOTO") - Number(a.item.kind === "PHOTO"));

  const totalBytes = jobs.reduce((sum, job) => sum + job.item.size, 0) || 1;
  let doneBytes = 0;
  const report = (job: Job, index: number, pct: number) => {
    const percent = Math.min(100, Math.round(((doneBytes + (job.item.size * pct) / 100) / totalBytes) * 100));
    hooks.onProgress?.({ fileNumber: index + 1, fileCount: jobs.length, percent, cardId: job.cardId, mediaId: job.mediaId, text: progressText(index + 1, jobs.length, percent) });
  };

  let emailed = false;
  try {
    for (const [index, job] of jobs.entries()) {
      report(job, index, 0);
      let ok = false;
      try {
        let status = await attempt(job, deps, (pct) => report(job, index, pct));
        if (status === "not_there") {
          status = await attempt(job, deps, (pct) => report(job, index, pct));
          if (status === "not_pending") {
            status = "READY";
          }
        }
        ok = status === "READY" || status === "PENDING";
      } catch {
        ok = false;
      }
      if (!ok) {
        memories[job.cardIndex]!.failedFiles.push(job.item.name);
      }
      doneBytes += job.item.size;
      report(job, index, 100);
      hooks.onFileDone?.(job.cardId, job.mediaId, ok);
    }
  } finally {
    try {
      const completed = await deps.completeSubmission({ claimTokens: created.memories.map((m) => m.claimToken) });
      emailed = completed.ok && completed.emailed;
    } catch {
      // The links on screen still work; the cron finishes the send once the lease runs out.
      emailed = false;
    }
  }
  return { ok: true, submissionId: created.submissionId, memories, emailed };
}
