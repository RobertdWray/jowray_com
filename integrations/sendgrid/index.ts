import "server-only";

import type { ResponseError } from "@sendgrid/mail";

import { createLogger } from "@/lib/logger";
import type { EmailTransport, OutboundEmail } from "@/services/email/types";

import { getSendGridClient } from "./client";

const log = createLogger({ category: "email" });

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;
/** Malformed request, bad key, forbidden: retrying cannot help. */
const NON_RETRYABLE = new Set([400, 401, 403]);

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

/** SendGrid transport: three inline attempts with linear backoff; 202 means accepted. */
export class SendGridTransport implements EmailTransport {
  async send(message: OutboundEmail): Promise<{ messageId?: string }> {
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
          trackingSettings: {
            clickTracking: { enable: false, enableText: false },
            openTracking: { enable: false },
          },
        });
        return { messageId: messageIdOf(response.headers) };
      } catch (error) {
        lastError = error;
        const code = statusCodeOf(error);
        if (code !== undefined && NON_RETRYABLE.has(code)) {
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
