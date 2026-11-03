/** How to derive the two server-made copies from one original. */
export interface DeriveOptions {
  /** Canonical MIME of the original (lib/media-types). */
  sourceMime: string;
  /** Hard deadline for the decode step (HEIC runs in a terminable worker). */
  deadlineMs: number;
  /** Refuse originals with more pixels than this before decoding them. */
  maxPixels: number;
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

export interface ImageService {
  /** Decode once, encode both copies. Throws `ImageDeriveError` when the original cannot be used at all. */
  derive(input: Buffer, options: DeriveOptions): Promise<DerivedSet>;
  /** Derivations currently running in this process (0 or 1: they are serialised). */
  inFlight(): number;
}
