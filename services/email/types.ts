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

/** One memory of a send as the receipt shows it (Task 15). Every field but `position`, `claimLink` and `media[].preview` is untrusted contributor input. */
export interface SubmissionMemoryContent {
  /** 1-based place in the send: the stable "Memory N" heading. */
  position: number;
  approxDateText?: string | null;
  place?: string | null;
  note?: string | null;
  media: MemoryMediaSummary[];
  claimLink: string;
  /** Original filenames of files that never arrived (cron path), so the person can add them again from the link. */
  missingFiles: string[];
}

/** Everything the send receipt renders: the contributor once, then every memory in order. */
export interface SubmissionConfirmationContent {
  name?: string | null;
  relationship?: string | null;
  memories: SubmissionMemoryContent[];
}

/** A claim-token rotation to commit together with SENT; the caller pins the order (anchor first, then ascending index). */
export interface ClaimRotation {
  memoryId: string;
  claimTokenHash: string;
}

export interface SubmissionConfirmationInput extends SubmissionConfirmationContent {
  /** The send's index-0 memory: the one `EmailLog` row for the receipt hangs off it. */
  anchorMemoryId: string;
  to: string;
  /** Cron path only: every link in this email carries a fresh token; the hashes are written with SENT in one transaction. */
  rotations?: ClaimRotation[];
}

export type MemoryVisibility = "PUBLIC" | "FAMILY" | "PRIVATE";

/**
 * Everything the family-admin alert renders. Every field except `memoryId`,
 * `submittedAt`, `visibility`, the flags and `media[].preview` is untrusted
 * contributor input. There is deliberately no link: the claim link belongs to
 * the contributor (ruling R2, 2026-11-03).
 */
export interface AdminNewMemoryContent {
  memoryId: string;
  submittedAt: Date;
  name?: string | null;
  relationship?: string | null;
  email?: string | null;
  contactOptIn: boolean;
  mailingListOptIn: boolean;
  notifyWhenPosted: boolean;
  approxDateText?: string | null;
  place?: string | null;
  note?: string | null;
  visibility: MemoryVisibility;
  media: MemoryMediaSummary[];
  /** Files the contributor started that are not READY (still uploading or failed), so the alert can say so. */
  filesNotReady: number;
}

export type SkipReason =
  | "already_sent"
  | "in_progress"
  | "outbound_disabled"
  | "recipient_capped"
  | "no_recipients"
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

/** A fully rendered message, ready for a transport. Several recipients means one message they all see (the admin alert). */
export interface OutboundEmail {
  to: string | string[];
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
