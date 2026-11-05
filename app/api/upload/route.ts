import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { type NextRequest, NextResponse } from "next/server";

import { deriveMedia } from "@/features/memories/derive-media";
import { recordMedia } from "@/features/memories/ingest-upload";
import { createLogger, logError } from "@/lib/logger";
import { afterWithFlush } from "@/lib/sentry/after-flush";
import { tagIds } from "@/lib/sentry/user";
import { getSiteUrl } from "@/lib/site-url";
import { BLOB_TOKEN_LIFETIME_MS, parseTicket, verifyUploadTicket } from "@/lib/upload-ticket";
import { getBlobEnv } from "@/server/config/env";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";

export const maxDuration = 60;

const EVENT_MAX_ATTEMPTS = 3;
/** Budget for the derived copies made from the callback (the route has 60 s). */
const DERIVE_DEADLINE_CALLBACK_MS = 15_000;

const log = createLogger({ category: "upload" });

class UploadRefused extends Error {
  constructor(public readonly code: string) {
    super(`upload refused: ${code}`);
  }
}

/**
 * Vercel Blob client-upload handler. Token exchange: the browser presents the
 * ticket minted by issueUploadTicket()/createUploadTicket() and gets a client
 * token scoped to that one pathname, MIME type and size. Upload completed:
 * the signed callback is the backstop for a tab closed before finalizeUpload().
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    // Request-time read first (Cache Components), then env and data. Inside the
    // `try` so a body that is not JSON is a 400 below, not an unhandled error
    // that `onRequestError` would report to Sentry once per request (issue #43).
    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      token: getBlobEnv().BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const ticket = parseTicket(clientPayload);
        if (!ticket) {
          throw new UploadRefused("missing_ticket");
        }
        const verified = verifyUploadTicket(ticket);
        if (!verified.ok) {
          throw new UploadRefused(verified.reason);
        }
        const { claims } = verified;
        if (claims.pathname !== pathname) {
          throw new UploadRefused("pathname_mismatch");
        }
        const row = await getDb().media.findUnique({
          where: { id: claims.mediaId },
          include: { memory: { select: { deletedAt: true } } },
        });
        // A cancelled reservation (deletedAt) must not receive bytes either.
        if (!row || row.status !== "PENDING" || row.deletedAt !== null || row.memory.deletedAt !== null) {
          throw new UploadRefused("not_pending");
        }
        return {
          allowedContentTypes: [claims.mimeType],
          maximumSizeInBytes: claims.maxBytes,
          validUntil: Date.now() + BLOB_TOKEN_LIFETIME_MS,
          addRandomSuffix: false,
          allowOverwrite: false,
          callbackUrl: `${getSiteUrl()}/api/upload`,
          tokenPayload: JSON.stringify({ mediaId: claims.mediaId }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const mediaId = mediaIdFrom(tokenPayload);
        const db = getDb();
        // Plain JSON for the audit row (PutBlobResult is a class-free object, but Prisma wants InputJsonValue).
        const payload = JSON.parse(JSON.stringify({ blob, tokenPayload: tokenPayload ?? null })) as Prisma.InputJsonValue;
        const event = await db.webhookEvent.create({
          data: { provider: "vercel-blob", kind: "upload_completed", payload },
        });
        if (!mediaId) {
          // Unrecoverable payload: never worth a cron retry.
          await db.webhookEvent.update({ where: { id: event.id }, data: { attempts: EVENT_MAX_ATTEMPTS, error: "no mediaId in tokenPayload" } });
          return;
        }
        tagIds({ mediaId });
        afterWithFlush("upload.callback", async () => {
          try {
            const outcome = await recordMedia({ mediaId });
            // A blob that is not visible yet stays unprocessed so cron step (c) replays it.
            await db.webhookEvent.update({
              where: { id: event.id },
              data: outcome.status === "PENDING" ? { attempts: 1, error: "blob not visible yet" } : { processedAt: new Date(), attempts: 1, error: null },
            });
            if (outcome.status === "READY") {
              // Closed-tab backstop for the derived copies; finalize normally gets there first and the
              // claim rows make the race harmless. A failure here is not a callback failure: cron (g) retries.
              try {
                await deriveMedia({ mediaId, deadlineMs: DERIVE_DEADLINE_CALLBACK_MS });
              } catch (error) {
                logError("derived copies failed after the upload callback", error, { category: "upload", mediaId });
              }
            }
          } catch (error) {
            await db.webhookEvent.update({
              where: { id: event.id },
              data: { attempts: 1, error: error instanceof Error ? error.message.slice(0, 1000) : String(error) },
            });
            logError("upload callback processing failed", error, { category: "upload", mediaId });
          }
        });
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof UploadRefused) {
      log.warn({ action: "refused", code: error.code }, "upload token refused");
      return NextResponse.json({ error: { code: error.code, message: "Upload not allowed" } }, { status: 403 });
    }
    log.warn({ action: "error", error: error instanceof Error ? error.message : String(error) }, "upload handler error");
    return NextResponse.json({ error: { code: "upload_error", message: "Upload request could not be processed" } }, { status: 400 });
  }
}

function mediaIdFrom(tokenPayload: string | null | undefined): string | null {
  if (!tokenPayload) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(tokenPayload);
    const id = (parsed as { mediaId?: unknown })?.mediaId;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}
