import "server-only";

import type { ResponseError } from "@sendgrid/mail";

import { createLogger } from "@/lib/logger";
import type { EmailTransport, OutboundEmail } from "@/services/email/types";

import { getSendGridClient } from "./client";

const log = createLogger({ category: "email" });

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;
/** Of the 4xx family only a timeout or rate limit can succeed on retry. */
const RETRYABLE_4XX = new Set([408, 429]);

function isRetryable(code: number | undefined): boolean {
  if (code === undefined) {
    return true; // network error
  }
  if (code >= 400 && code < 500) {
    return RETRYABLE_4XX.has(code);
  }
  return true;
}

/**
 * Turn a SendGrid ResponseError into a plain Error carrying only the HTTP
 * status: the SDK error exposes `response.body`, whose free-text messages can
 * echo the recipient address, and Pino/Sentry would serialize it.
 */
function sanitizeError(error: unknown): Error {
  const code = statusCodeOf(error);
  if (code !== undefined) {
    const text = error instanceof Error && error.message ? error.message : "request failed";
    return new Error(`SendGrid ${code}: ${text}`);
  }
  return error instanceof Error ? new Error(error.message) : new Error(String(error));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusCodeOf(error: unknown): number | undefined {
  if (error instanceof Error && "code" in error && typeof (error as ResponseError).code === "number") {
    return (error as ResponseError).code;
  }
  return undefined;
}

function messageIdOf(headers: unknown): string | undefined {
  if (!headers || typeof headers !== "object") {
    return undefined;
  }
  const record = headers as Record<string, unknown>;
  const value = record["x-message-id"] ?? record["X-Message-Id"] ?? record["X-Message-ID"];
  return typeof value === "string" ? value : undefined;
}

const CONTENT_ID = /^[a-z0-9-]+$/;
const ATTACHMENT_FILENAME = /^[A-Za-z0-9._-]+$/;

/** The MIME contract at the vendor boundary: ids and names that cannot break headers or be mistaken for paths. */
function assertAttachmentContract(message: OutboundEmail): void {
  for (const attachment of message.attachments ?? []) {
    if (!CONTENT_ID.test(attachment.contentId)) {
      throw new Error(`attachment content id is not cid-safe: ${JSON.stringify(attachment.contentId)}`);
    }
    if (!ATTACHMENT_FILENAME.test(attachment.filename)) {
      throw new Error(`attachment filename is not header-safe: ${JSON.stringify(attachment.filename)}`);
    }
  }
}

/** SendGrid transport: three inline attempts with linear backoff; 202 means accepted. */
export class SendGridTransport implements EmailTransport {
  async send(message: OutboundEmail): Promise<{ messageId?: string }> {
    assertAttachmentContract(message);
    const client = getSendGridClient();
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const [response] = await client.send({
          to: message.to,
          from: message.from,
          subject: message.subject,
          text: message.text,
          html: message.html,
          // Inline images by Content-ID; the helper library serialises `contentId` as `content_id`.
          ...(message.attachments && message.attachments.length > 0
            ? {
                attachments: message.attachments.map((a) => ({
                  content: a.contentBase64,
                  filename: a.filename,
                  type: a.contentType,
                  disposition: "inline",
                  contentId: a.contentId,
                })),
              }
            : {}),
          trackingSettings: {
            clickTracking: { enable: false, enableText: false },
            openTracking: { enable: false },
          },
        });
        return { messageId: messageIdOf(response.headers) };
      } catch (error) {
        lastError = sanitizeError(error);
        const code = statusCodeOf(error);
        if (!isRetryable(code)) {
          break;
        }
        if (attempt < MAX_ATTEMPTS) {
          log.warn({ action: "send_retry", attempt, statusCode: code }, "SendGrid send failed; retrying");
          await sleep(BASE_DELAY_MS * attempt);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
