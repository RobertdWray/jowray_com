export type MediaKind = "PHOTO" | "VOICE" | "VIDEO";

/** One READY file as the email shows it; `preview` is the derived JPEG when one exists. */
export interface MemoryMediaSummary {
  kind: MediaKind;
  originalFilename: string | null;
  durationSeconds: number | null;
  preview: { contentId: string; contentBase64: string; width: number; height: number } | null;
}

/** Everything the confirmation template renders; every field is untrusted contributor input except `claimLink` and `media[].preview`. */
export interface MemoryConfirmationContent {
  name?: string | null;
  relationship?: string | null;
  approxDateText?: string | null;
  place?: string | null;
  note?: string | null;
  media: MemoryMediaSummary[];
  claimLink: string;
}

export interface MemoryConfirmationInput extends MemoryConfirmationContent {
  memoryId: string;
  to: string;
  /**
   * Cron path only: the link in this email carries a freshly minted token;
   * its hash is written together with the SENT status in one transaction so
   * a delivered email can never point at a hash that was not saved.
   */
  rotateToClaimTokenHash?: string;
}

export type SkipReason =
  | "already_sent"
  | "in_progress"
  | "outbound_disabled"
  | "recipient_capped"
  | "failed";

export type SendResult =
  | { sent: true; messageId?: string }
  | { sent: false; skipped: SkipReason; error?: string };

/**
 * An image carried inside the message (MIME `Content-ID`), referenced from
 * the HTML as `cid:<contentId>`. Nothing in an email is ever fetched from a
 * URL: previews and brand marks travel this way so no token or tracking
 * request leaves the reader's client.
 */
export interface EmailAttachment {
  filename: string;
  contentType: "image/jpeg" | "image/png";
  contentBase64: string;
  /** `[a-z0-9-]+`, built from server ids only. */
  contentId: string;
}

/** A fully rendered message, ready for a transport. */
export interface OutboundEmail {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  attachments?: EmailAttachment[];
}

/** Vendor transport (SendGrid today). Retries inline; throws the last error. */
export interface EmailTransport {
  send(message: OutboundEmail): Promise<{ messageId?: string }>;
}
