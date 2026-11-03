export type ReceivedType = "VOICE" | "VIDEO" | "PHOTO" | "TEXT";

export interface MemoryConfirmationInput {
  memoryId: string;
  to: string;
  name?: string | null;
  received: { type: ReceivedType; fileCount: number };
  claimLink: string;
  /** The "how memories are used" sentence from docs/consent/<CONSENT_VERSION>.md. */
  usageSentence?: string;
}

export type SkipReason =
  | "already_sent"
  | "outbound_disabled"
  | "recipient_capped"
  | "failed";

export type SendResult =
  | { sent: true; messageId?: string }
  | { sent: false; skipped: SkipReason; error?: string };

/** A fully rendered message, ready for a transport. */
export interface OutboundEmail {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
}

/** Vendor transport (SendGrid today). Retries inline; throws the last error. */
export interface EmailTransport {
  send(message: OutboundEmail): Promise<{ messageId?: string }>;
}
