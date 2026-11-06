export type MediaKind = "PHOTO" | "VOICE" | "VIDEO";

/**
 * One READY file as the contributor's receipt shows it: its kind and its
 * length, nothing else. No filename and no uploaded image: the receipt is
 * fixed content (issue #46, D1, 2026-11-05; review #6), because an uploaded
 * picture is as much the visitor's content as their words.
 */
export interface ReceiptMediaSummary {
  kind: MediaKind;
  durationSeconds: number | null;
}

/**
 * One READY file as the family-admin alert shows it: the receipt's summary
 * plus the name the contributor gave the file and the derived preview JPEG
 * when one exists (the admins are the audience that may see uploaded content).
 */
export interface MemoryMediaSummary extends ReceiptMediaSummary {
  originalFilename: string | null;
  preview: { contentId: string; contentBase64: string; width: number; height: number } | null;
}

/**
 * Everything the confirmation template renders. Nothing here is contributor-written
 * text: the receipt is fixed content (issue #46, D1, 2026-11-05, replacing ruling
 * R1 of 2026-11-03), so an anonymous send can never put a visitor's words into a
 * jowray.com-signed email to an address of their choosing. `hasWords` only picks
 * between "your words" and nothing in the fixed "what you sent" line.
 */
export interface MemoryConfirmationContent {
  hasWords: boolean;
  media: ReceiptMediaSummary[];
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

/** One memory of a send as the receipt shows it (Task 15). Fixed content: nothing here is contributor-written text (issue #46, D1). */
export interface SubmissionMemoryContent {
  /** 1-based place in the send: the stable "Memory N" heading. */
  position: number;
  hasWords: boolean;
  media: ReceiptMediaSummary[];
  claimLink: string;
  /** How many files never arrived (cron path), so the person can add them again from the link. Names stay out of the email. */
  missingFiles: number;
}

/** Everything the send receipt renders: every memory in order. */
export interface SubmissionConfirmationContent {
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
  /** The global outbound ceiling for contributor email is reached; the row is FAILED with `nextAttemptAt` at the window's end, so the cron sends it later (issue #46, D2). */
  | "global_capped"
  /** More admin alerts this hour than `ADMIN_ALERT_HOURLY_CAP`; a terminal SKIPPED row, the admins got one pause notice (issue #46, D4). */
  | "admin_capped"
  /** The outbound lock could not be taken within its bound; nothing was written, so the cron's catch-up finds the memory and tries again. */
  | "busy"
  | "no_recipients"
  | "nothing_to_send"
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
