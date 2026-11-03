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
export interface StorageService {
  put(pathname: string, body: ReadableStream | Blob | Buffer, contentType: string): Promise<StorageHeadResult>;
  head(pathname: string): Promise<StorageHeadResult | null>;
  get(pathname: string): Promise<StorageGetResult | null>;
  del(pathname: string): Promise<void>;
  /** Short-lived GET URL for a private blob, served by the blob host (supports Range). */
  presignGet(options: PresignGetOptions): Promise<PresignGetResult>;
}
