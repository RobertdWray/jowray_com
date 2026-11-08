import "server-only";

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { pipeline } from "node:stream/promises";

import { FRAME_SERVER_PREFIX, MAX_SOURCE_BYTES, WINDOW_BYTES } from "@/lib/video-frames";
import type { FrameSourceRead } from "@/services/video-frames/types";

/**
 * A one-shot HTTP server on 127.0.0.1 that hands one private original to ffmpeg (video-posters plan D2).
 *
 * The static Linux ffmpeg cannot resolve DNS, so it never sees a Blob URL. It reads
 * `http://127.0.0.1:<port>/__frames/<nonce>` instead, and every Range request it makes is answered from the
 * injected `read(offset, length, signal)`. Across all requests the server never asks `read` for more than
 * `maxSourceBytes`; past that it stops serving and `failure` fires with `source_limit`.
 *
 * **One window per response.** A range answer carries at most `windowBytes`: `bytes=a-` (ffmpeg's only form) gets
 * `206` with `Content-Range: bytes a-(a+windowBytes-1)/size`, which RFC 9110 §15.3.7 allows ("describing what range of
 * the selected representation is enclosed"). ffmpeg run with `-reconnect 1` asks for `bytes=(a+windowBytes)-` on a new
 * connection when it needs more (`integrations/video-frames/ffmpeg.ts`). So each response costs exactly one `read`,
 * started only when ffmpeg asked for that offset, and a connection can hold at most one window ffmpeg did not use,
 * whatever the kernel's socket buffers absorb. (Streaming a whole remainder relied on backpressure, and Linux's
 * loopback send buffer, about 2.6 MB at the handshake, takes a 1 MiB write at once, so the next windows were read
 * before ffmpeg hung up to seek.) A client that hangs up aborts the read in flight.
 *
 * Request handling:
 * - Only `GET` and `HEAD` on the exact nonce path; any other path is 404, any other method 405.
 * - `Range: bytes=a-`, `bytes=a-b` (b clamped to the end and to one window) and `bytes=-n` get a single-part 206
 *   with `Content-Range`. A range starting at or past the size, b < a, an empty suffix or malformed numbers get
 *   416 with `Content-Range: bytes *\/size`. Several ranges also get 416, deliberately: they are satisfiable, but
 *   ffmpeg never sends them and a multipart answer has no place in a one-window server.
 * - No Range, or a unit other than `bytes` (which RFC 9110 says to ignore): 200 with the whole body, streamed
 *   window by window, and `Accept-Ranges: bytes`. RFC 9110 forbids a 206 without a Range, so this one path can read
 *   ahead; ffmpeg never takes it (it sends `Range: bytes=<offset>-` on every request with `-seekable 1`).
 * - Every response says `Connection: close`: ffmpeg opens a new connection for each window and each seek anyway.
 *
 * The server never throws from a client's behaviour: every socket, request and response carries an `error` handler,
 * and malformed HTTP destroys only that socket. A server-level error (an `accept` failure such as EMFILE) fires
 * `failure` with `server_error`, and an exception while answering with `handler_error`, each keeping the cause.
 */

/** What the server answered, for diagnostics and tests. `body` is the inclusive byte span a 200 or 206 carries. */
export interface FrameRequestInfo {
  method: string;
  range: string | undefined;
  status: number;
  body?: { start: number; end: number };
}

export interface FrameServerOptions {
  /** The original's exact size in bytes. */
  size: number;
  /** Reads exactly `length` bytes at `offset`; `signal` fires when the response that asked no longer wants them. */
  read: FrameSourceRead;
  /** Aborting it aborts every read in flight; `close()` is still the caller's job. */
  signal?: AbortSignal;
  /** Defaults to `MAX_SOURCE_BYTES`. */
  maxSourceBytes?: number;
  /** Defaults to `WINDOW_BYTES`. */
  windowBytes?: number;
  onRequest?: (info: FrameRequestInfo) => void;
}

/**
 * - `source_limit`: the next window would pass `maxSourceBytes`.
 * - `read_failed`: `read` threw, or returned another length than asked.
 * - `server_error`: the server itself emitted an error after listening (an `accept` failure such as EMFILE): the
 *   environment's doing, not the original's.
 * - `handler_error`: answering a request threw: a defect here, never a client's behaviour.
 * `cause` keeps what was thrown or emitted.
 */
export type FrameSourceFailure = "source_limit" | "read_failed" | "server_error" | "handler_error";

/** Why the server stopped serving: the reason of `FrameServer.failure`. `cause` holds what was thrown. */
export class FrameSourceError extends Error {
  readonly kind: FrameSourceFailure;

  constructor(kind: FrameSourceFailure, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "FrameSourceError";
    this.kind = kind;
  }
}

export interface FrameServer {
  /** `http://127.0.0.1:<port>/__frames/<nonce>`; numeric, so no DNS is needed. */
  readonly url: string;
  readonly listening: boolean;
  /** Every byte asked of `read` so far, across all requests; a read that was then aborted counts in full. */
  readonly bytesRead: number;
  readonly maxSourceBytes: number;
  readonly windowBytes: number;
  /** Fires once, with a `FrameSourceError`, when the source limit is hit, a read fails or answering throws. */
  readonly failure: AbortSignal;
  /** Stops listening, destroys every connection and aborts every read in flight. Idempotent; never waits on `read`. */
  close(): Promise<void>;
}

type ByteRange = { start: number; end: number };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
type RangeAnswer = { kind: "whole" } | { kind: "partial"; range: ByteRange } | { kind: "unsatisfiable" };

const SINGLE_BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;

/** RFC 9110 §14.1.2 for one `bytes` range; `whole` when there is no Range or its unit is not `bytes`. */
function parseRange(header: string | undefined, size: number): RangeAnswer {
  if (header === undefined || !/^bytes=/i.test(header.trim())) {
    return { kind: "whole" };
  }
  const match = SINGLE_BYTE_RANGE.exec(header.trim().replace(/^bytes=/i, "bytes="));
  if (!match) {
    return { kind: "unsatisfiable" };
  }
  const [, first, last] = match;
  if (first === "") {
    // Suffix: the last n bytes.
    const length = Number(last);
    if (last === "" || !Number.isSafeInteger(length) || length === 0 || size === 0) {
      return { kind: "unsatisfiable" };
    }
    return { kind: "partial", range: { start: Math.max(0, size - length), end: size - 1 } };
  }
  const start = Number(first);
  if (!Number.isSafeInteger(start) || start >= size) {
    return { kind: "unsatisfiable" };
  }
  if (last === "") {
    return { kind: "partial", range: { start, end: size - 1 } };
  }
  const end = Number(last);
  if (!Number.isSafeInteger(end) || end < start) {
    return { kind: "unsatisfiable" };
  }
  return { kind: "partial", range: { start, end: Math.min(end, size - 1) } };
}

export async function startFrameServer(options: FrameServerOptions): Promise<FrameServer> {
  const { size, read } = options;
  const maxSourceBytes = options.maxSourceBytes ?? MAX_SOURCE_BYTES;
  const windowBytes = options.windowBytes ?? WINDOW_BYTES;
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new RangeError(`Frame source size must be a non-negative integer, got ${size}`);
  }
  if (!Number.isSafeInteger(windowBytes) || windowBytes <= 0 || !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 0) {
    throw new RangeError("Frame server windowBytes must be positive and maxSourceBytes non-negative");
  }

  const path = `${FRAME_SERVER_PREFIX}${randomUUID()}`;
  // Fires on close() and on the caller's signal: every response's reads hang off it.
  const lifetime = new AbortController();
  const failure = new AbortController();
  const sockets = new Set<Socket>();
  let bytesRead = 0;
  let closing: Promise<void> | undefined;

  const stopReads = () => lifetime.abort(options.signal?.reason ?? new Error("Frame server closed"));

  function fail(error: FrameSourceError): void {
    if (!failure.signal.aborted) {
      failure.abort(error);
    }
  }

  /** The windows of one response, read one at a time as the response drains. */
  async function* windows(range: ByteRange, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    for (let offset = range.start; offset <= range.end; ) {
      const length = Math.min(windowBytes, range.end - offset + 1);
      if (failure.signal.aborted) {
        throw failure.signal.reason;
      }
      if (bytesRead + length > maxSourceBytes) {
        const error = new FrameSourceError("source_limit", `the run asked for more than ${maxSourceBytes} bytes of the original`);
        fail(error);
        throw error;
      }
      bytesRead += length;
      let chunk: Uint8Array;
      try {
        chunk = await read(offset, length, signal);
      } catch (error) {
        if (!signal.aborted) {
          fail(new FrameSourceError("read_failed", `reading ${length} bytes at ${offset} failed: ${messageOf(error)}`, { cause: error }));
        }
        throw error;
      }
      if (chunk.byteLength !== length) {
        const error = new FrameSourceError("read_failed", `read returned ${chunk.byteLength} bytes at ${offset}; asked for ${length}`);
        fail(error);
        throw error;
      }
      yield chunk;
      offset += length;
    }
  }

  function answer(res: ServerResponse, status: number, headers: Record<string, string | number>, method: string, range: string | undefined, body?: ByteRange): void {
    options.onRequest?.(body ? { method, range, status, body } : { method, range, status });
    res.writeHead(status, { Connection: "close", ...headers });
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? "";
    const rangeHeader = req.headers.range;
    if (failure.signal.aborted || lifetime.signal.aborted) {
      // Stop serving: the run has already failed or ended.
      res.destroy();
      return;
    }
    if (req.url !== path) {
      answer(res, 404, { "Content-Length": 0 }, method, rangeHeader);
      res.end();
      return;
    }
    if (method !== "GET" && method !== "HEAD") {
      answer(res, 405, { Allow: "GET, HEAD", "Content-Length": 0 }, method, rangeHeader);
      res.end();
      return;
    }
    const parsed = parseRange(rangeHeader, size);
    if (parsed.kind === "unsatisfiable") {
      answer(res, 416, { "Content-Range": `bytes */${size}`, "Content-Length": 0 }, method, rangeHeader);
      res.end();
      return;
    }
    // A range answer carries one window at most; the whole-body answer (no Range) cannot be cut short.
    const range =
      parsed.kind === "partial"
        ? { start: parsed.range.start, end: Math.min(parsed.range.end, parsed.range.start + windowBytes - 1) }
        : { start: 0, end: size - 1 };
    const headers: Record<string, string | number> = {
      "Accept-Ranges": "bytes",
      "Content-Length": range.end - range.start + 1,
      "Content-Type": "application/octet-stream",
    };
    if (parsed.kind === "partial") {
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
    }
    answer(res, parsed.kind === "partial" ? 206 : 200, headers, method, rangeHeader, range);
    if (method === "HEAD") {
      res.end();
      return;
    }
    // This response's reads stop when the client hangs up, the server closes or the run fails.
    const gone = new AbortController();
    const markGone = () => {
      if (!res.writableFinished) {
        gone.abort(new Error("Frame client closed the connection"));
      }
    };
    res.once("close", markGone);
    const signal = AbortSignal.any([gone.signal, lifetime.signal, failure.signal]);
    try {
      await pipeline(windows(range, signal), res, { signal });
    } catch {
      // A client hanging up, the server closing, the cap or a read failure all end here; the last two already
      // fired `failure` with their cause. Cutting the response is the signal to ffmpeg.
      res.destroy();
    } finally {
      res.off("close", markGone);
    }
  }

  const server = createServer((req, res) => {
    req.on("error", () => res.destroy());
    res.on("error", () => res.destroy());
    handle(req, res).catch((error: unknown) => {
      // Not a client's doing: surface it through `failure` (the caller reports it) rather than crash the process.
      fail(new FrameSourceError("handler_error", `the frame server failed to answer a request: ${messageOf(error)}`, { cause: error }));
      res.destroy();
    });
  });
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => sockets.delete(socket));
  });
  // Malformed HTTP or a reset before the request was parsed: drop only that socket.
  server.on("clientError", (_error, socket) => socket.destroy());

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  // After listen, a server error (an accept failure such as EMFILE) means ffmpeg's next connection may never be
  // answered: fail the run with the cause instead of letting ffmpeg's error stand in for it.
  server.on("error", (error: Error) => {
    fail(new FrameSourceError("server_error", `the frame server failed: ${error.message}`, { cause: error }));
  });
  const { port } = server.address() as AddressInfo;
  if (options.signal?.aborted) {
    stopReads();
  } else {
    options.signal?.addEventListener("abort", stopReads, { once: true });
  }

  return {
    url: `http://127.0.0.1:${port}${path}`,
    get listening() {
      return server.listening;
    },
    get bytesRead() {
      return bytesRead;
    },
    maxSourceBytes,
    windowBytes,
    failure: failure.signal,
    close() {
      closing ??= new Promise<void>((resolve) => {
        options.signal?.removeEventListener("abort", stopReads);
        lifetime.abort(new Error("Frame server closed"));
        server.close(() => resolve());
        server.closeAllConnections();
        for (const socket of sockets) {
          socket.destroy();
        }
      });
      return closing;
    },
  };
}
