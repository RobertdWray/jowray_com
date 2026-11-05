export interface StorageHeadResult {
  pathname: string;
  url: string;
  size: number;
  contentType: string;
  uploadedAt: Date;
}

export interface StorageGetResult {
  stream: ReadableStream;
  contentType: string;
  contentLength: number;
}

export interface PresignGetOptions {
  pathname: string;
  /** Absolute expiry, epoch milliseconds. */
  validUntil: number;
}

export interface PresignGetResult {
  url: string;
  expiresAt: Date;
}

/**
 * Private object storage for original uploads. Originals are write-once:
 * `put` never overwrites. Lookups are by pathname (never by a client URL).
 */
export interface StorageGetOptions {
  /** Aborts the fetch, body included; a caller with a deadline passes it so a stalled download cannot outlive it. */
  signal?: AbortSignal;
}

export interface StorageService {
  put(pathname: string, body: ReadableStream | Blob | Buffer, contentType: string): Promise<StorageHeadResult>;
  head(pathname: string): Promise<StorageHeadResult | null>;
  get(pathname: string, options?: StorageGetOptions): Promise<StorageGetResult | null>;
  /**
   * The first `maxBytes` bytes of a blob (fewer when the blob is shorter), or
   * null when it is missing. Transfers the prefix, never the file: this is the
   * byte check that runs before a row becomes READY (issue #45).
   */
  readPrefix(pathname: string, maxBytes: number): Promise<Uint8Array | null>;
  del(pathname: string): Promise<void>;
  /** Short-lived GET URL for a private blob, served by the blob host (supports Range). */
  presignGet(options: PresignGetOptions): Promise<PresignGetResult>;
}
