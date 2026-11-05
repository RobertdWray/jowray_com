import "server-only";

import { BlobNotFoundError, del, get, head, issueSignedToken, presignUrl, put } from "@vercel/blob";

import { createLogger } from "@/lib/logger";
import { getBlobEnv } from "@/server/config/env";
import type {
  PresignGetOptions,
  PresignGetResult,
  StorageGetOptions,
  StorageGetResult,
  StorageHeadResult,
  StorageService,
} from "@/services/storage/types";

const log = createLogger({ category: "upload" });

/** Read at most `maxBytes` from a stream, then cancel it; what was read is returned as one array. */
async function readUpTo(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, out.byteLength - offset);
    out.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= out.byteLength) {
      break;
    }
  }
  return out;
}

export class VercelBlobStorageService implements StorageService {
  private token(): string {
    return getBlobEnv().BLOB_READ_WRITE_TOKEN;
  }

  async put(
    pathname: string,
    body: ReadableStream | Blob | Buffer,
    contentType: string
  ): Promise<StorageHeadResult> {
    await put(pathname, body, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
      token: this.token(),
    });
    const meta = await this.head(pathname);
    if (!meta) {
      throw new Error(`Blob vanished after put: ${pathname}`);
    }
    log.info({ action: "put", pathname, sizeBytes: meta.size }, "blob stored");
    return meta;
  }

  async head(pathname: string): Promise<StorageHeadResult | null> {
    try {
      const result = await head(pathname, { token: this.token() });
      return {
        pathname: result.pathname,
        url: result.url,
        size: result.size,
        contentType: result.contentType,
        uploadedAt: result.uploadedAt,
      };
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async get(pathname: string, options: StorageGetOptions = {}): Promise<StorageGetResult | null> {
    const result = await get(pathname, { access: "private", token: this.token(), abortSignal: options.signal });
    if (!result || result.statusCode !== 200) {
      return null;
    }
    return {
      stream: result.stream,
      contentType: result.blob.contentType,
      contentLength: result.blob.size,
    };
  }

  /**
   * A `Range` request for the first bytes. The blob host answers 206 with just
   * the prefix; should it ever answer 200 (the whole body), only `maxBytes`
   * are read before the stream is cancelled, so the transfer stays bounded
   * either way. Nothing after the prefix is ever buffered.
   */
  async readPrefix(pathname: string, maxBytes: number): Promise<Uint8Array | null> {
    const result = await get(pathname, {
      access: "private",
      token: this.token(),
      headers: { Range: `bytes=0-${Math.max(0, maxBytes - 1)}` },
    });
    if (!result || result.stream === null) {
      return null;
    }
    return readUpTo(result.stream, maxBytes);
  }

  async del(pathname: string): Promise<void> {
    await del(pathname, { token: this.token() });
    log.info({ action: "del", pathname }, "blob deleted");
  }

  async presignGet(options: PresignGetOptions): Promise<PresignGetResult> {
    const signed = await issueSignedToken({
      pathname: options.pathname,
      operations: ["get"],
      validUntil: options.validUntil,
      token: this.token(),
    });
    const { presignedUrl } = await presignUrl(signed, {
      access: "private",
      operation: "get",
      pathname: options.pathname,
      validUntil: options.validUntil,
    });
    return { url: presignedUrl, expiresAt: new Date(options.validUntil) };
  }
}
