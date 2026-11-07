import { issueSignedToken, presignUrl } from "@vercel/blob";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as LoggerModule from "@/lib/logger";

interface FakeGetResult {
  statusCode: number;
  stream: ReadableStream<Uint8Array> | null;
  headers: Headers;
  blob: { contentType: string | null; size: number | null; url: string; downloadUrl: string; pathname: string; contentDisposition: string; cacheControl: string; etag: string; uploadedAt: Date };
}

const getMock = vi.fn<(pathname: string, options: Record<string, unknown>) => Promise<FakeGetResult | null>>();
vi.mock("@vercel/blob", () => ({
  BlobNotFoundError: class BlobNotFoundError extends Error {},
  del: vi.fn(),
  get: (pathname: string, options: Record<string, unknown>) => getMock(pathname, options),
  head: vi.fn(),
  issueSignedToken: vi.fn(),
  presignUrl: vi.fn(),
  put: vi.fn(),
}));
vi.mock("@/server/config/env", () => ({ getBlobEnv: () => ({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test_token" }) }));

const { logLines } = vi.hoisted(() => ({ logLines: [] as string[] }));
vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof LoggerModule>();
  const logger = actual.buildLogger({
    level: "trace",
    destination: { write: (line) => { logLines.push(line); } },
  });
  return { ...actual, createLogger: (context: Record<string, unknown>) => logger.child(context) };
});

import { VercelBlobStorageService } from "@/integrations/vercel-blob";

/** A body delivered in `chunk`-byte pieces, counting how much was actually pulled and whether it was cancelled. */
function countingStream(total: number, chunk: number) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= total) {
        controller.close();
        return;
      }
      const size = Math.min(chunk, total - state.pulled);
      controller.enqueue(new Uint8Array(size).fill(0xab));
      state.pulled += size;
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

function result(statusCode: number, stream: ReadableStream<Uint8Array> | null, size: number | null): FakeGetResult {
  return {
    statusCode,
    stream,
    headers: new Headers(),
    blob: { contentType: "video/mp4", size, url: "u", downloadUrl: "d", pathname: "p", contentDisposition: "inline", cacheControl: "", etag: "e", uploadedAt: new Date() },
  };
}

const service = new VercelBlobStorageService();

beforeEach(() => {
  getMock.mockReset();
  vi.mocked(issueSignedToken).mockReset();
  vi.mocked(presignUrl).mockReset();
  logLines.length = 0;
});

describe("VercelBlobStorageService.presignPut", () => {
  it.each([
    { pathname: "originals/m/photo.jpg", contentType: "image/jpeg", maxBytes: 2048, validUntil: 1_800_000_000_000 },
    { pathname: "originals/m/photo.heic", contentType: "image/heic", maxBytes: 4096, validUntil: 1_800_000_060_000 },
    { pathname: "originals/m/video.mov", contentType: "video/quicktime", maxBytes: 8192, validUntil: 1_800_000_120_000 },
  ])("binds a private write-once PUT to $pathname, its type, size and expiry without logging the URL", async (options) => {
    const signed = {
      delegationToken: "test-delegation",
      clientSigningToken: "test-signing-key",
      validUntil: options.validUntil,
    };
    // An inert URL: the SDK is mocked and no upload credential is minted.
    const url = "https://blob.example.invalid/upload";
    vi.mocked(issueSignedToken).mockResolvedValueOnce(signed);
    vi.mocked(presignUrl).mockResolvedValueOnce({ presignedUrl: url });

    const result = await service.presignPut(options);

    expect(issueSignedToken).toHaveBeenCalledExactlyOnceWith({
      pathname: options.pathname,
      operations: ["put"],
      allowedContentTypes: [options.contentType],
      maximumSizeInBytes: options.maxBytes,
      validUntil: options.validUntil,
      token: "vercel_blob_rw_test_token",
    });
    expect(presignUrl).toHaveBeenCalledExactlyOnceWith(signed, {
      operation: "put",
      pathname: options.pathname,
      access: "private",
      allowedContentTypes: [options.contentType],
      maximumSizeInBytes: options.maxBytes,
      addRandomSuffix: false,
      allowOverwrite: false,
      validUntil: options.validUntil,
    });
    expect(result).toEqual({
      url,
      expiresAt: new Date(options.validUntil),
      headers: { "content-type": options.contentType, "x-content-type": options.contentType },
    });
    expect(logLines.join("\n")).not.toContain(url);
  });
});

describe("VercelBlobStorageService.readPrefix (issue #45)", () => {
  it("asks for a byte range and returns the partial body as the prefix (the SDK reports any 2xx, 206 included, as statusCode 200)", async () => {
    const { stream } = countingStream(64, 16);
    getMock.mockResolvedValueOnce(result(200, stream, 64));
    const prefix = await service.readPrefix("originals/m/a.mp4", 128);
    expect(prefix).toHaveLength(64);
    const [pathname, options] = getMock.mock.calls[0]!;
    expect(pathname).toBe("originals/m/a.mp4");
    expect(options).toMatchObject({ access: "private", headers: { Range: "bytes=0-127" } });
  });

  it("reads no more than the prefix and cancels the body when the host answers 200 with the whole file", async () => {
    const { stream, state } = countingStream(10 * 1024 * 1024, 4096);
    getMock.mockResolvedValueOnce(result(200, stream, 10 * 1024 * 1024));
    const prefix = await service.readPrefix("originals/m/a.mp4", 128);
    expect(prefix).toHaveLength(128);
    // One chunk is enough for 128 bytes; the stream's own read-ahead may pull one more. The 10 MB body was not read.
    expect(state.pulled).toBeLessThanOrEqual(2 * 4096);
    expect(state.cancelled).toBe(true);
  });

  it("returns a shorter array for a blob shorter than the prefix, and null when the blob is missing", async () => {
    const { stream } = countingStream(5, 5);
    getMock.mockResolvedValueOnce(result(200, stream, 5));
    expect(await service.readPrefix("k", 128)).toHaveLength(5);
    getMock.mockResolvedValueOnce(null);
    expect(await service.readPrefix("k", 128)).toBeNull();
  });
});

describe("VercelBlobStorageService.readPrefix deadline (B3 fix round 1)", () => {
  it("passes the caller's abort signal to the SDK, so a deadline stops a stalled prefix read too", async () => {
    const controller = new AbortController();
    const { stream } = countingStream(16, 16);
    getMock.mockResolvedValueOnce(result(200, stream, 16));
    expect(await service.readPrefix("k", 128, { signal: controller.signal })).toHaveLength(16);
    expect(getMock.mock.calls[0]![1]).toMatchObject({ abortSignal: controller.signal, headers: { Range: "bytes=0-127" } });
  });

  it("without options, sends no signal (the byte check in recordMedia is unchanged)", async () => {
    const { stream } = countingStream(16, 16);
    getMock.mockResolvedValueOnce(result(200, stream, 16));
    await service.readPrefix("k", 128);
    expect(getMock.mock.calls[0]![1]).toMatchObject({ abortSignal: undefined });
  });
});

describe("VercelBlobStorageService.get", () => {
  it("passes the caller's abort signal to the SDK so a deadline can stop a download", async () => {
    const controller = new AbortController();
    const { stream } = countingStream(3, 3);
    getMock.mockResolvedValueOnce(result(200, stream, 3));
    const got = await service.get("k", { signal: controller.signal });
    expect(got?.contentLength).toBe(3);
    expect(getMock.mock.calls[0]![1]).toMatchObject({ abortSignal: controller.signal });
  });
});
