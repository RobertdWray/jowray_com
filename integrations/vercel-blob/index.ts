import "server-only";

import { BlobNotFoundError, BlobRequestAbortedError, del, get, head, issueSignedToken, presignUrl, put } from "@vercel/blob";

import { createLogger } from "@/lib/logger";
import { RangeNotHonouredError, ShortReadError } from "@/lib/storage-errors";
import { getBlobEnv } from "@/server/config/env";
import type {
  PresignGetOptions,
  PresignGetResult,
  PresignPutOptions,
  PresignPutResult,
  StorageGetOptions,
  StorageGetResult,
  StorageHeadResult,
  StorageService,
} from "@/services/storage/types";

const log = createLogger({ category: "upload" });

/**
 * Blob 2.8.2 retries TimeoutError but bails on AbortError. Give the SDK a
 * default AbortError reason, then restore the caller's reason for SDK aborts.
 * An unrelated failure racing a timeout must retain its original cause.
 * Keep the listener for the whole operation (including prefix/range bodies).
 */
async function withSdkSignal<T>(signal: AbortSignal | undefined, call: (abortSignal?: AbortSignal) => Promise<T>): Promise<T> {
  if (!signal) { return call(); }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) { abort(); }
  else { signal.addEventListener("abort", abort, { once: true }); }
  try {
    return await call(controller.signal);
  } catch (error) {
    if (signal.aborted && (error instanceof BlobRequestAbortedError || (error instanceof DOMException && error.name === "AbortError"))) {
      throw signal.reason;
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

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

  async head(pathname: string, options: StorageGetOptions = {}): Promise<StorageHeadResult | null> {
    try {
      const result = await withSdkSignal(options.signal, (abortSignal) => head(pathname, {
        token: this.token(), ...(abortSignal && { abortSignal }),
      }));
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
    const result = await withSdkSignal(options.signal, (abortSignal) => get(pathname, {
      access: "private", token: this.token(), abortSignal,
    }));
    if (!result || result.statusCode !== 200) {
      return null;
    }
    return {
      // Headers settle the SDK call; the stream pipe owns cancellation from here
      // until EOF/error/cancel, including cancellation of the underlying body.
      stream: options.signal
        ? result.stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>(), { signal: options.signal })
        : result.stream,
      contentType: result.blob.contentType,
      contentLength: result.blob.size,
    };
  }

  /**
   * A `Range` request for the first bytes. The blob host answers 206 with just
   * the prefix (the SDK reports every 2xx as `statusCode: 200`, so the stream
   * is what tells us there is a body); should the host ever send the whole
   * file, only `maxBytes` are read before the stream is cancelled, so the
   * transfer stays bounded either way. Nothing after the prefix is buffered.
   * Callers never ask for a range of an empty blob (that would be a 416). A
   * caller's `signal` aborts the request, body included, as for `get`.
   */
  async readPrefix(pathname: string, maxBytes: number, options: StorageGetOptions = {}): Promise<Uint8Array | null> {
    return withSdkSignal(options.signal, async (abortSignal) => {
      const result = await get(pathname, {
        access: "private",
        token: this.token(),
        headers: { Range: `bytes=0-${Math.max(0, maxBytes - 1)}` },
        abortSignal,
      });
      if (!result || result.stream === null) {
        return null;
      }
      return readUpTo(result.stream, maxBytes);
    });
  }

  readRange(pathname: string, offset: number, length: number, options: StorageGetOptions = {}): Promise<Uint8Array | null> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1) {
      throw new RangeError("Storage range requires a nonnegative safe integer offset and a positive safe integer length.");
    }
    return withSdkSignal(options.signal, async (abortSignal) => {
      const requestedEnd = offset + length - 1;
      const result = await get(pathname, {
        access: "private",
        token: this.token(),
        headers: { Range: `bytes=${offset}-${requestedEnd}` },
        abortSignal,
      });
      if (!result) {
        return null;
      }

      // The SDK reports 206 as 200; only Content-Range establishes which bytes
      // this body contains. A truncated range is valid only at the file's end.
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(result.headers.get("content-range") ?? "");
      const start = Number(match?.[1]);
      const end = Number(match?.[2]);
      const total = Number(match?.[3]);
      if (
        !result.stream || !match || ![start, end, total].every(Number.isSafeInteger) ||
        start !== offset || end < start || end >= total || end > requestedEnd ||
        (end < requestedEnd && end !== total - 1)
      ) {
        await result.stream?.cancel().catch(() => undefined);
        throw new RangeNotHonouredError();
      }

      const promisedBytes = end - start + 1;
      const bytes = await readUpTo(result.stream, promisedBytes);
      if (bytes.byteLength < promisedBytes) {
        throw new ShortReadError();
      }
      return bytes;
    });
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

  async presignPut(options: PresignPutOptions): Promise<PresignPutResult> {
    const signed = await withSdkSignal(options.signal, (abortSignal) => issueSignedToken({
      pathname: options.pathname,
      operations: ["put"],
      allowedContentTypes: [options.contentType],
      maximumSizeInBytes: options.maxBytes,
      validUntil: options.validUntil,
      token: this.token(),
      ...(abortSignal && { abortSignal }),
    }));
    const { presignedUrl } = await presignUrl(signed, {
      operation: "put",
      pathname: options.pathname,
      access: "private",
      allowedContentTypes: [options.contentType],
      maximumSizeInBytes: options.maxBytes,
      addRandomSuffix: false,
      allowOverwrite: false,
      validUntil: options.validUntil,
    });
    return {
      url: presignedUrl,
      expiresAt: new Date(options.validUntil),
      // The CDN enforces x-content-type; content-type also describes the HTTP body.
      headers: { "content-type": options.contentType, "x-content-type": options.contentType },
    };
  }
}
