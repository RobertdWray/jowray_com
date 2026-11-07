import { BlobNotFoundError, BlobRequestAbortedError, head, issueSignedToken, presignUrl } from "@vercel/blob";
import type * as BlobModule from "@vercel/blob";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as LoggerModule from "@/lib/logger";

interface FakeGetResult {
  statusCode: number;
  stream: ReadableStream<Uint8Array> | null;
  headers: Headers;
  blob: { contentType: string | null; size: number | null; url: string; downloadUrl: string; pathname: string; contentDisposition: string; cacheControl: string; etag: string; uploadedAt: Date };
}

const getMock = vi.fn<(pathname: string, options: Record<string, unknown>) => Promise<FakeGetResult | null>>();
vi.mock("@vercel/blob", async (importOriginal) => {
  const { BlobNotFoundError, BlobRequestAbortedError } = await importOriginal<typeof BlobModule>();
  return {
    BlobNotFoundError,
    BlobRequestAbortedError,
    del: vi.fn(),
    get: (pathname: string, options: Record<string, unknown>) => getMock(pathname, options),
    head: vi.fn(),
    issueSignedToken: vi.fn(),
    presignUrl: vi.fn(),
    put: vi.fn(),
  };
});
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
  vi.mocked(head).mockReset();
  vi.mocked(issueSignedToken).mockReset();
  vi.mocked(presignUrl).mockReset();
  logLines.length = 0;
});
afterEach(() => { vi.restoreAllMocks(); });

describe("VercelBlobStorageService.presignPut", () => {
  it("passes the caller's deadline to token issuance and propagates its abort", async () => {
    const controller = new AbortController();
    vi.mocked(issueSignedToken).mockImplementationOnce(async (options) => {
      expect(options.abortSignal).toBeInstanceOf(AbortSignal);
      expect(options.abortSignal).not.toBe(controller.signal);
      return new Promise((_, reject) => options.abortSignal!.addEventListener("abort", () => reject(options.abortSignal!.reason), { once: true }));
    });
    const options = { pathname: "originals/m/photo.jpg", contentType: "image/jpeg", maxBytes: 2048, validUntil: 1_800_000_000_000, signal: controller.signal };
    const pending = service.presignPut(options);
    controller.abort();
    await expect(pending).rejects.toBe(controller.signal.reason);
    expect(presignUrl).not.toHaveBeenCalled();
  });
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

describe("VercelBlobStorageService.head deadline", () => {
  it("passes the caller's signal to the SDK and propagates an aborted lookup", async () => {
    const controller = new AbortController();
    vi.mocked(head).mockImplementationOnce(async (_pathname, options) => {
      expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
      expect(options?.abortSignal).not.toBe(controller.signal);
      return new Promise((_, reject) => options!.abortSignal!.addEventListener("abort", () => reject(options!.abortSignal!.reason), { once: true }));
    });
    const options = { signal: controller.signal };
    const pending = service.head("originals/m/photo.jpg", options);
    controller.abort();
    await expect(pending).rejects.toBe(controller.signal.reason);
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
    expect(getMock.mock.calls[0]![1]).toMatchObject({ abortSignal: expect.any(AbortSignal), headers: { Range: "bytes=0-127" } });
    expect(getMock.mock.calls[0]![1].abortSignal).not.toBe(controller.signal);
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
    expect(getMock.mock.calls[0]![1]).toMatchObject({ abortSignal: expect.any(AbortSignal) });
    expect(getMock.mock.calls[0]![1].abortSignal).not.toBe(controller.signal);
  });
});

const PUT_OPTIONS = { pathname: "originals/m/photo.jpg", contentType: "image/jpeg", maxBytes: 2048, validUntil: 1_800_000_000_000 };
const OPERATIONS = ["head", "get", "readPrefix", "presignPut"] as const;
type Operation = typeof OPERATIONS[number];

function callStorage(operation: Operation, signal?: AbortSignal): Promise<unknown> {
  switch (operation) {
    case "head": return service.head("k", { signal });
    case "get": return service.get("k", { signal });
    case "readPrefix": return service.readPrefix("k", 128, { signal });
    case "presignPut": return service.presignPut({ ...PUT_OPTIONS, signal });
  }
}

/** Model 2.8.2: only AbortError stops retries; a TimeoutError never settles here. */
function sdkAbortOnly(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    const onAbort = () => {
      if (signal?.reason instanceof DOMException && signal.reason.name === "AbortError") {
        reject(new BlobRequestAbortedError());
      }
    };
    if (signal?.aborted) { onAbort(); }
    else { signal?.addEventListener("abort", onAbort, { once: true }); }
  });
}

/** A failing SDK model must fail the test promptly instead of hanging Vitest. */
async function withinHalfSecond<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("operation did not settle within 500 ms")), 500);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

function mockSdkSuccess(): void {
  vi.mocked(head).mockResolvedValue({ ...result(200, null, 16).blob, size: 16, contentType: "video/mp4" });
  getMock.mockResolvedValue(null);
  vi.mocked(issueSignedToken).mockResolvedValue({ delegationToken: "test-delegation", clientSigningToken: "test-signing-key", validUntil: PUT_OPTIONS.validUntil });
  vi.mocked(presignUrl).mockResolvedValue({ presignedUrl: "https://blob.example.invalid/upload" });
}

describe("SDK abort normalization", () => {
  const sdkSignals: Array<AbortSignal | undefined> = [];
  beforeEach(() => {
    sdkSignals.length = 0;
    const abort = (signal?: AbortSignal) => { sdkSignals.push(signal); return sdkAbortOnly(signal); };
    vi.mocked(head).mockImplementation((_pathname, options) => abort(options?.abortSignal));
    getMock.mockImplementation((_pathname, options) => abort(options.abortSignal as AbortSignal | undefined));
    vi.mocked(issueSignedToken).mockImplementation((options) => abort(options.abortSignal));
  });

  it.each(OPERATIONS)("%s translates a 20 ms timeout to SDK AbortError and restores the caller's reason", async (operation) => {
    const signal = AbortSignal.timeout(20);
    const add = vi.spyOn(signal, "addEventListener");
    const remove = vi.spyOn(signal, "removeEventListener");
    const started = performance.now();
    const pending = withinHalfSecond(callStorage(operation, signal));
    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await expect(pending).rejects.toBe(signal.reason);
    expect(performance.now() - started).toBeLessThan(500);
    expect(sdkSignals).toHaveLength(1);
    expect(sdkSignals[0]).not.toBe(signal);
    expect(sdkSignals[0]?.reason).toBeInstanceOf(DOMException);
    expect(sdkSignals[0]?.reason.name).toBe("AbortError");
    expect(add).toHaveBeenCalledExactlyOnceWith("abort", expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledExactlyOnceWith("abort", add.mock.calls[0]![1]);
  });

  it.each(OPERATIONS)("%s immediately adapts an already-aborted caller", async (operation) => {
    const reason = new DOMException("Already timed out", "TimeoutError");
    const signal = AbortSignal.abort(reason);
    const add = vi.spyOn(signal, "addEventListener");
    await expect(withinHalfSecond(callStorage(operation, signal))).rejects.toBe(reason);
    expect(sdkSignals[0]?.aborted).toBe(true);
    expect(sdkSignals[0]?.reason.name).toBe("AbortError");
    expect(add).not.toHaveBeenCalled();
  });

  it.each(OPERATIONS)("%s adds no SDK signal or controller when the caller provides none", async (operation) => {
    mockSdkSuccess();
    const controller = vi.spyOn(globalThis, "AbortController");
    await callStorage(operation);
    const sdkOptions = operation === "head" ? vi.mocked(head).mock.calls[0]![1]
      : operation === "presignPut" ? vi.mocked(issueSignedToken).mock.calls[0]![0]
        : getMock.mock.calls[0]![1];
    expect(sdkOptions?.abortSignal).toBeUndefined();
    expect(controller).not.toHaveBeenCalled();
  });

  it.each(OPERATIONS)("%s removes its listener after success, so later aborts do not reach the completed SDK call", async (operation) => {
    mockSdkSuccess();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await callStorage(operation, controller.signal);
    expect(add).toHaveBeenCalledExactlyOnceWith("abort", expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledExactlyOnceWith("abort", add.mock.calls[0]![1]);
    const sdkSignal = (operation === "head" ? vi.mocked(head).mock.calls[0]![1]?.abortSignal
      : operation === "presignPut" ? vi.mocked(issueSignedToken).mock.calls[0]![0].abortSignal
        : getMock.mock.calls[0]![1].abortSignal) as AbortSignal;
    controller.abort();
    expect(sdkSignal.aborted).toBe(false);
  });

  it.each(OPERATIONS)("%s preserves a non-abort SDK failure and removes its listener", async (operation) => {
    const error = new Error("storage unavailable");
    vi.mocked(head).mockRejectedValue(error);
    getMock.mockRejectedValue(error);
    vi.mocked(issueSignedToken).mockRejectedValue(error);
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await expect(callStorage(operation, controller.signal)).rejects.toBe(error);
    expect(add).toHaveBeenCalledExactlyOnceWith("abort", expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledExactlyOnceWith("abort", add.mock.calls[0]![1]);
  });

  it.each(OPERATIONS)("%s preserves an unrelated SDK failure racing the caller's timeout", async (operation) => {
    const error = new Error("storage unavailable");
    vi.mocked(head).mockRejectedValueOnce(error);
    getMock.mockRejectedValueOnce(error);
    vi.mocked(issueSignedToken).mockRejectedValueOnce(error);
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    // The SDK rejects first, but the timeout fires before the wrapper's catch runs.
    const pending = callStorage(operation, controller.signal);
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    await expect(pending).rejects.toBe(error);
    expect(remove).toHaveBeenCalledExactlyOnceWith("abort", add.mock.calls[0]![1]);
  });

  it("keeps head's not-found result when BlobNotFoundError races the caller's timeout", async () => {
    vi.mocked(head).mockRejectedValueOnce(new BlobNotFoundError());
    const controller = new AbortController();
    const pending = service.head("k", { signal: controller.signal });
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    await expect(pending).resolves.toBeNull();
  });

  it("does not treat an ordinary Error named AbortError as an SDK abort", async () => {
    const error = Object.assign(new Error("unrelated failure"), { name: "AbortError" });
    vi.mocked(head).mockRejectedValueOnce(error);
    const controller = new AbortController();
    const pending = service.head("k", { signal: controller.signal });
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    await expect(pending).rejects.toBe(error);
  });

  it.each([
    { kind: "DOMException AbortError", error: new DOMException("Aborted", "AbortError") },
    { kind: "BlobRequestAbortedError", error: new BlobRequestAbortedError() },
  ])("preserves $kind if the caller has not aborted", async ({ error }) => {
    vi.mocked(head).mockRejectedValueOnce(error);
    await expect(service.head("k", { signal: new AbortController().signal })).rejects.toBe(error);
  });

  it("keeps readPrefix cancellable until the prefix body has been consumed", async () => {
    getMock.mockImplementationOnce(async (_pathname, options) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          void sdkAbortOnly(options.abortSignal as AbortSignal).catch((error: unknown) => controller.error(error));
        },
      });
      return result(200, stream, 16);
    });
    const signal = AbortSignal.timeout(20);
    const remove = vi.spyOn(signal, "removeEventListener");
    const pending = withinHalfSecond(service.readPrefix("k", 128, { signal }));
    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await expect(pending).rejects.toBe(signal.reason);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("keeps a get body cancellable after headers return and the SDK call listener is removed", async () => {
    const cancel = vi.fn();
    getMock.mockResolvedValueOnce(result(200, new ReadableStream<Uint8Array>({ cancel }), 16));
    const signal = AbortSignal.timeout(20);
    const file = await service.get("k", { signal });
    const pending = withinHalfSecond(file!.stream.getReader().read());
    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await expect(pending).rejects.toBe(signal.reason);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(signal.reason);
  });
});
