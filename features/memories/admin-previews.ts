import "server-only";

import { type ExistingDerivedRow, isEligible, MAX_PIXELS } from "@/features/memories/derived-claims";
import { mediaKindOf } from "@/features/memories/media-summary";
import type { DerivedKind, DerivedStatus, MediaStatus, Prisma } from "@/generated/prisma/client";
import { isStagingKey } from "@/lib/derived-keys";
import { createLogger, logError } from "@/lib/logger";
import { MAX_VIDEO_PIXELS } from "@/lib/video-frames";
import { getDb } from "@/server/db/client";
import type { MediaKind, MediaPreview } from "@/services/email";
import { CONTENT_ID, MAX_PREVIEWS, PREVIEW_MAX_BYTES, RESERVED_CONTENT_IDS } from "@/services/email/templates/shared";
import { createStorageService } from "@/services/storage";

/**
 * Pictures for the family-admin alert (video posters plan, T13; D8): a photo's THUMBNAIL and a video's POSTER,
 * carried inline as `cid:preview-<mediaId>` (SendGrid `content_id`, RFC 2392). Only the admin alert uses this; the
 * contributor receipts carry no uploaded picture (issue #46), and the template ignores previews for them anyway.
 *
 * Nothing here makes a copy. The alert runs from the contributor pages' Server Functions, so by D1 it must never load
 * the poster path (`derive-poster`, `services/video-frames`, ffmpeg): it only reads what the producers (the finalize
 * task, the upload callback, MCP and the cron) have published. Neither function throws: a picture is a nicety, and the
 * alert goes out without it.
 */

const log = createLogger({ category: "email" });

/** How long a request-path alert waits for its copies after the response (C22): one budget per after() task. */
export const ADMIN_PREVIEW_WAIT_MS = 15_000;
/** How often the wait re-reads the copies. */
export const PREVIEW_POLL_MS = 1_000;
/** One budget for every storage read of one alert's previews. */
export const PREVIEW_READ_TIMEOUT_MS = 5_000;

/** The copy that shows a file of each kind: the email THUMBNAIL for a photo, the POSTER frame for a video. */
const PREVIEW_COPY: Record<MediaKind, "THUMBNAIL" | "POSTER" | null> = { PHOTO: "THUMBNAIL", VIDEO: "POSTER", VOICE: null };
/** The ceiling each copy's producer judges a `too_many_pixels:<limit>` refusal against (`isEligible`). */
const PIXEL_CEILING: Record<"THUMBNAIL" | "POSTER", number> = { THUMBNAIL: MAX_PIXELS, POSTER: MAX_VIDEO_PIXELS };

const PREVIEW_KINDS: DerivedKind[] = ["THUMBNAIL", "POSTER"];

/** The derived copies the alert reads: select these on each file (`derivatives: PREVIEW_COPIES`). */
export const PREVIEW_COPIES = {
  where: { kind: { in: PREVIEW_KINDS }, status: "READY" },
  select: { kind: true, status: true, storageKey: true, mimeType: true, sizeBytes: true, width: true, height: true },
} satisfies Prisma.Media$derivativesArgs;

/** One derived copy, as `PREVIEW_COPIES` selects it. */
export interface PreviewCopy {
  kind: DerivedKind;
  status: DerivedStatus;
  storageKey: string;
  mimeType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
}

/** One file of the memory with its copies, in the alert's order (`createdAt` ascending). */
export interface PreviewSourceMedia {
  id: string;
  status: MediaStatus;
  mimeType: string;
  derivatives: readonly PreviewCopy[];
}

/** The copy that would show this file in the alert, when the file is READY and of a kind that has one. */
function wantedCopy(file: { status: MediaStatus; mimeType: string }): "THUMBNAIL" | "POSTER" | null {
  return file.status === "READY" ? PREVIEW_COPY[mediaKindOf(file.mimeType)] : null;
}

/**
 * The files the alert can picture: the first `MAX_PREVIEWS` READY photos and videos, in the order given (upload
 * order). The one slot rule for the wait and the loader (R19), so the files waited for are exactly the files loaded:
 * a file keeps its slot whatever becomes of its copy, and one whose copy cannot be used (over the cap, staged, not
 * JPEG, failed) shows as a badge card without passing its slot to a later file nobody waited for.
 */
function previewSlots<T extends { status: MediaStatus; mimeType: string }>(media: readonly T[]): T[] {
  return media.filter((file) => wantedCopy(file) !== null).slice(0, MAX_PREVIEWS);
}

/**
 * Nothing more will come for this file within a request: its copy is READY, or FAILED with no retry left for a
 * producer to make (the one eligibility rule, `isEligible`, under that copy's pixel ceiling). No row, a live or
 * stale claim, and a retryable failure all keep the wait going.
 */
function copySettled(file: { status: MediaStatus; mimeType: string; derivatives: Array<ExistingDerivedRow & { kind: DerivedKind }> }, now: Date): boolean {
  const kind = wantedCopy(file);
  if (kind === null) {
    return true;
  }
  const row = file.derivatives.find((d) => d.kind === kind);
  return row !== undefined && (row.status === "READY" || (row.status === "FAILED" && isEligible(row, now, PIXEL_CEILING[kind]) === "not_eligible"));
}

/**
 * Wait, after the response, until the copies that will show in the alert are settled: each file in a preview slot
 * (`previewSlots`) has its copy READY, or FAILED with no retry left for a producer to make (`isEligible` says
 * `not_eligible`). Re-reads every `pollMs` and gives up at `until`, whichever comes first; returns at once when
 * `until` has passed. A database error ends the wait early: it is logged and the alert goes with what is there.
 */
export async function waitForAdminPreviews({ memoryId, until, pollMs = PREVIEW_POLL_MS }: { memoryId: string; until: number; pollMs?: number }): Promise<void> {
  try {
    while (Date.now() < until) {
      const files = await getDb().media.findMany({
        where: { memoryId, deletedAt: null, status: "READY" },
        orderBy: { createdAt: "asc" },
        select: {
          status: true,
          mimeType: true,
          derivatives: {
            where: { kind: { in: PREVIEW_KINDS } },
            select: { id: true, kind: true, status: true, storageKey: true, error: true, attempts: true, claimedAt: true },
          },
        },
      });
      const now = new Date();
      const left = until - Date.now();
      if (previewSlots(files).every((file) => copySettled(file, now)) || left <= 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, left)));
    }
  } catch (error) {
    logError("admin alert: the preview wait stopped early", error, { category: "email", memoryId });
  }
}

/** A copy chosen for the alert, with the content id it will travel under. */
interface PreviewPick {
  mediaId: string;
  contentId: string;
  copy: PreviewCopy & { width: number; height: number };
}

/** The copy to attach for this file, or null when it has none the email may carry. */
function pickCopy(file: PreviewSourceMedia): PreviewPick | null {
  const kind = wantedCopy(file);
  const copy = kind === null ? undefined : file.derivatives.find((d) => d.kind === kind && d.status === "READY");
  // D2: a browser-staged key holds untrusted bytes and is never attached. The template sends previews as image/jpeg.
  if (!copy || isStagingKey(copy.storageKey) || copy.mimeType !== "image/jpeg") {
    return null;
  }
  // D4: a copy over the email budget (or of unknown size) is never read; the file shows as a badge card.
  if (copy.sizeBytes === null || copy.sizeBytes > PREVIEW_MAX_BYTES) {
    return null;
  }
  const { width, height } = copy;
  if (width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }
  // The template refuses (throws on) an id that is not cid-safe or that a brand mark uses; skip it here instead.
  const contentId = `preview-${file.id}`;
  if (!CONTENT_ID.test(contentId) || RESERVED_CONTENT_IDS.has(contentId)) {
    log.warn({ action: "preview_id_refused", mediaId: file.id }, "admin alert: a file's preview id is not usable; it shows as a badge card");
    return null;
  }
  return { mediaId: file.id, contentId, copy: { ...copy, width, height } };
}

async function readPreview(pick: PreviewPick, signal: AbortSignal): Promise<MediaPreview | null> {
  try {
    const blob = await createStorageService().get(pick.copy.storageKey, { signal });
    if (!blob) {
      log.warn({ action: "preview_missing", mediaId: pick.mediaId }, "admin alert: a READY preview copy is missing from storage");
      return null;
    }
    if (blob.contentLength > PREVIEW_MAX_BYTES) {
      await blob.stream.cancel();
      log.warn({ action: "preview_too_large", mediaId: pick.mediaId, bytes: blob.contentLength }, "admin alert: a preview copy is larger than its row says");
      return null;
    }
    const bytes = Buffer.from(await new Response(blob.stream).arrayBuffer());
    if (bytes.byteLength > PREVIEW_MAX_BYTES) {
      log.warn({ action: "preview_too_large", mediaId: pick.mediaId, bytes: bytes.byteLength }, "admin alert: a preview copy is larger than its row says");
      return null;
    }
    return { contentId: pick.contentId, contentBase64: bytes.toString("base64"), width: pick.copy.width, height: pick.copy.height };
  } catch (error) {
    logError("admin alert: a preview copy could not be read", error, { category: "email", mediaId: pick.mediaId });
    return null;
  }
}

/**
 * The inline previews for the alert, keyed by media id: for each file in a preview slot (`previewSlots`, the files
 * the wait waited for), its READY, non-staging THUMBNAIL (photo) or POSTER (video) JPEG of at most
 * `PREVIEW_MAX_BYTES`, as base64 with the width and height of its derived row. Every read shares `signal` (the
 * caller's one read budget). A file whose copy cannot be used or read gets no preview (a read failure is logged),
 * and the rest still load.
 */
export async function loadAdminPreviews(media: readonly PreviewSourceMedia[], signal: AbortSignal): Promise<Map<string, MediaPreview>> {
  const picks = previewSlots(media).flatMap((file) => pickCopy(file) ?? []);
  const read = await Promise.all(picks.map(async (pick) => [pick.mediaId, await readPreview(pick, signal)] as const));
  const previews = new Map<string, MediaPreview>();
  for (const [mediaId, preview] of read) {
    if (preview) {
      previews.set(mediaId, preview);
    }
  }
  return previews;
}
