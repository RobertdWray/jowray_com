/** How to derive the two server-made copies from one original. */
export interface DeriveOptions {
  /** Canonical MIME of the original (lib/media-types). */
  sourceMime: string;
  /** Hard deadline for the decode step (HEIC runs in a terminable worker). */
  deadlineMs: number;
  /** Refuse originals with more pixels than this before decoding them; for an animation the whole frame strip counts. */
  maxPixels: number;
  /** Refuse animations with more frames than this before decoding them (issue #45). */
  maxFrames: number;
  web: { maxEdge: number; quality: number };
  thumb: { maxEdge: number; quality: number; fallbackQuality: number; maxBytes: number; background: string };
}

export interface Encoded {
  data: Buffer;
  mimeType: string;
  extension: string;
  width: number;
  height: number;
}

export interface DerivedSet {
  /** Upright dimensions of the original as decoded. */
  sourceWidth: number;
  sourceHeight: number;
  /** Inline copy for pages: same container family as the original, long edge ≤ web.maxEdge. */
  web: Encoded;
  /** Email copy: JPEG ≤ thumb.maxBytes on the paper colour, or `too_large` when even the fallback quality is over budget. */
  thumb: Encoded | { failed: "too_large" };
}

/**
 * The one decode slot of this process, held by whoever acquired it. The
 * holder downloads the original and decodes it while holding the slot, so
 * at most one original is buffered per process (issue #45), then releases.
 */
export interface DeriveSlot {
  /** Decode once, encode both copies. Throws `ImageDeriveError` when the original cannot be used at all. */
  derive(input: Buffer, options: DeriveOptions): Promise<DerivedSet>;
  /** Hand the slot to the next waiter. Idempotent. */
  release(): void;
}

export interface ImageService {
  /**
   * Wait for the slot, at most `deadlineMs`. Rejects at once with `busy`
   * when the waiting line is full (nothing is read or decoded; the caller
   * leaves the work to the cron) and with `timeout` when the deadline passes
   * first. Waiters are served in order.
   */
  acquire(deadlineMs: number): Promise<DeriveSlot>;
  /** `acquire` + decode + release in one call; the deadline covers the wait. */
  derive(input: Buffer, options: DeriveOptions): Promise<DerivedSet>;
  /** Derivations currently running in this process (0 or 1: they are serialised). */
  inFlight(): number;
  /** Callers waiting for the slot right now. */
  waiting(): number;
}
