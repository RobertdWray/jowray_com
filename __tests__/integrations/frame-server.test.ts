import { request, type IncomingHttpHeaders } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { FrameSourceError, startFrameServer, type FrameServer, type FrameServerOptions } from "@/integrations/video-frames/frame-server";
import { FRAME_SERVER_PREFIX, MAX_SOURCE_BYTES, WINDOW_BYTES } from "@/lib/video-frames";

/** A deterministic original: byte i is i mod 251, so any slice is checkable. */
function makeSource(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) {
    bytes[i] = i % 251;
  }
  return bytes;
}

interface ReadCall {
  offset: number;
  length: number;
  signal: AbortSignal;
}

/** An in-memory `read` that records every call and never returns past the end. */
function memoryRead(bytes: Uint8Array) {
  const calls: ReadCall[] = [];
  const read = async (offset: number, length: number, signal: AbortSignal) => {
    calls.push({ offset, length, signal });
    return bytes.slice(offset, offset + length);
  };
  return { calls, read };
}

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

function send(url: string, options: { method?: string; headers?: Record<string, string>; path?: string } = {}): Promise<Reply> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(
      { host: target.hostname, port: target.port, path: options.path ?? target.pathname, method: options.method ?? "GET", headers: options.headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** A GET whose response may end early; resolves with what arrived and whether the body completed. */
function sendExpectingCut(url: string, headers: Record<string, string>): Promise<{ status: number; received: number; complete: boolean }> {
  const target = new URL(url);
  return new Promise((resolve) => {
    let status = 0;
    let received = 0;
    const req = request({ host: target.hostname, port: target.port, path: target.pathname, headers, agent: false }, (res) => {
      status = res.statusCode ?? 0;
      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
      });
      res.on("end", () => resolve({ status, received, complete: true }));
      res.on("error", () => resolve({ status, received, complete: false }));
      res.on("aborted", () => resolve({ status, received, complete: false }));
    });
    req.on("error", () => resolve({ status, received, complete: false }));
    req.end();
  });
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const servers: FrameServer[] = [];
async function start(options: FrameServerOptions): Promise<FrameServer> {
  const server = await startFrameServer(options);
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("startFrameServer", () => {
  it("listens on 127.0.0.1 at a random nonce path under the frame prefix and uses the plan's limits by default", async () => {
    const bytes = makeSource(10);
    const server = await start({ size: bytes.length, read: memoryRead(bytes).read });
    const url = new URL(server.url);
    expect(url.protocol).toBe("http:");
    expect(url.hostname).toBe("127.0.0.1");
    expect(Number(url.port)).toBeGreaterThan(0);
    expect(url.pathname.startsWith(FRAME_SERVER_PREFIX)).toBe(true);
    expect(url.pathname.slice(FRAME_SERVER_PREFIX.length)).toMatch(/^[0-9a-f-]{36}$/);
    expect(server.listening).toBe(true);
    const other = await start({ size: bytes.length, read: memoryRead(bytes).read });
    expect(other.url).not.toBe(server.url);
    expect(server.maxSourceBytes).toBe(MAX_SOURCE_BYTES);
    expect(server.windowBytes).toBe(WINDOW_BYTES);
  });

  it("answers an open range with 206 and the remainder, pulled in windows that never pass the end", async () => {
    const bytes = makeSource(300_123);
    const { calls, read } = memoryRead(bytes);
    const server = await start({ size: bytes.length, read, windowBytes: 65_536 });
    const reply = await send(server.url, { headers: { Range: "bytes=100-" } });
    expect(reply.status).toBe(206);
    expect(reply.headers["accept-ranges"]).toBe("bytes");
    expect(reply.headers["content-range"]).toBe(`bytes 100-300122/300123`);
    expect(reply.headers["content-length"]).toBe(String(300_023));
    expect(reply.headers["connection"]).toBe("close");
    expect(reply.headers["content-type"]).toBe("application/octet-stream");
    expect(Buffer.compare(reply.body, Buffer.from(bytes.subarray(100)))).toBe(0);
    expect(calls.map(({ offset, length }) => [offset, length])).toEqual([
      [100, 65_536],
      [65_636, 65_536],
      [131_172, 65_536],
      [196_708, 65_536],
      [262_244, 37_879],
    ]);
    expect(server.bytesRead).toBe(300_023);
  });

  it("answers a closed range with exactly those bytes, and clamps an end past the size", async () => {
    const bytes = makeSource(5000);
    const { calls, read } = memoryRead(bytes);
    const server = await start({ size: bytes.length, read });
    const closed = await send(server.url, { headers: { Range: "bytes=10-19" } });
    expect(closed.status).toBe(206);
    expect(closed.headers["content-range"]).toBe("bytes 10-19/5000");
    expect(closed.headers["content-length"]).toBe("10");
    expect([...closed.body]).toEqual([...bytes.subarray(10, 20)]);
    const clamped = await send(server.url, { headers: { Range: "bytes=4990-999999" } });
    expect(clamped.status).toBe(206);
    expect(clamped.headers["content-range"]).toBe("bytes 4990-4999/5000");
    expect([...clamped.body]).toEqual([...bytes.subarray(4990)]);
    expect(calls.map(({ offset, length }) => [offset, length])).toEqual([
      [10, 10],
      [4990, 10],
    ]);
    // Bytes are counted across every request.
    expect(server.bytesRead).toBe(20);
  });

  it("answers a suffix range with the last bytes", async () => {
    const bytes = makeSource(5000);
    const server = await start({ size: bytes.length, read: memoryRead(bytes).read });
    const reply = await send(server.url, { headers: { Range: "bytes=-7" } });
    expect(reply.status).toBe(206);
    expect(reply.headers["content-range"]).toBe("bytes 4993-4999/5000");
    expect([...reply.body]).toEqual([...bytes.subarray(4993)]);
  });

  it("answers a request without Range with 200, the whole body and Accept-Ranges", async () => {
    const bytes = makeSource(2048);
    const server = await start({ size: bytes.length, read: memoryRead(bytes).read });
    const reply = await send(server.url);
    expect(reply.status).toBe(200);
    expect(reply.headers["accept-ranges"]).toBe("bytes");
    expect(reply.headers["content-length"]).toBe("2048");
    expect(reply.headers["content-range"]).toBeUndefined();
    expect(Buffer.compare(reply.body, Buffer.from(bytes))).toBe(0);
  });

  it("ignores a Range in a unit it does not understand, as RFC 9110 requires", async () => {
    const bytes = makeSource(64);
    const server = await start({ size: bytes.length, read: memoryRead(bytes).read });
    const reply = await send(server.url, { headers: { Range: "items=0-5" } });
    expect(reply.status).toBe(200);
    expect(reply.body.length).toBe(64);
  });

  it("answers HEAD with the range headers and no body, without reading", async () => {
    const bytes = makeSource(5000);
    const { calls, read } = memoryRead(bytes);
    const server = await start({ size: bytes.length, read });
    const ranged = await send(server.url, { method: "HEAD", headers: { Range: "bytes=0-" } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers["content-range"]).toBe("bytes 0-4999/5000");
    expect(ranged.headers["content-length"]).toBe("5000");
    expect(ranged.body.length).toBe(0);
    const whole = await send(server.url, { method: "HEAD" });
    expect(whole.status).toBe(200);
    expect(whole.headers["accept-ranges"]).toBe("bytes");
    expect(whole.headers["content-length"]).toBe("5000");
    expect(calls).toEqual([]);
    expect(server.bytesRead).toBe(0);
  });

  it.each([
    ["a start at the size", "bytes=5000-"],
    ["a start past the size", "bytes=9000-9001"],
    ["an end before the start", "bytes=20-10"],
    ["several ranges", "bytes=0-1,4-5"],
    ["an empty suffix", "bytes=-0"],
    ["no positions", "bytes=-"],
    ["a non-number", "bytes=a-"],
    ["an unsafe integer", "bytes=99999999999999999999-"],
  ])("answers 416 with bytes */size for %s, without reading", async (_label, range) => {
    const bytes = makeSource(5000);
    const { calls, read } = memoryRead(bytes);
    const server = await start({ size: bytes.length, read });
    const reply = await send(server.url, { headers: { Range: range } });
    expect(reply.status).toBe(416);
    expect(reply.headers["content-range"]).toBe("bytes */5000");
    expect(calls).toEqual([]);
  });

  it.each([
    ["another nonce", () => `${FRAME_SERVER_PREFIX}00000000-0000-4000-8000-000000000000`],
    ["the prefix alone", () => FRAME_SERVER_PREFIX],
    ["a query string", (path: string) => `${path}?x=1`],
    ["a trailing segment", (path: string) => `${path}/more`],
    ["the root", () => "/"],
  ] satisfies [string, (path: string) => string][])("answers 404 for %s, without reading", async (_label, pathFor) => {
    const bytes = makeSource(100);
    const { calls, read } = memoryRead(bytes);
    const server = await start({ size: bytes.length, read });
    const reply = await send(server.url, { path: pathFor(new URL(server.url).pathname), headers: { Range: "bytes=0-" } });
    expect(reply.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("answers 405 with Allow for any method but GET and HEAD", async () => {
    const bytes = makeSource(100);
    const { calls, read } = memoryRead(bytes);
    const server = await start({ size: bytes.length, read });
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
      const reply = await send(server.url, { method });
      expect(reply.status).toBe(405);
      expect(reply.headers["allow"]).toBe("GET, HEAD");
    }
    expect(calls).toEqual([]);
  });

  it("reports each request it answers to onRequest", async () => {
    const bytes = makeSource(100);
    const seen: unknown[] = [];
    const server = await start({ size: bytes.length, read: memoryRead(bytes).read, onRequest: (info) => seen.push(info) });
    await send(server.url, { headers: { Range: "bytes=10-" } });
    await send(server.url, { method: "HEAD" });
    await send(server.url, { headers: { Range: "bytes=500-" } });
    await send(server.url, { path: "/nope" });
    expect(seen).toEqual([
      { method: "GET", range: "bytes=10-", status: 206 },
      { method: "HEAD", range: undefined, status: 200 },
      { method: "GET", range: "bytes=500-", status: 416 },
      { method: "GET", range: undefined, status: 404 },
    ]);
  });

  it("stops reading when the client goes away: the in-flight read is aborted and no further window is asked for", async () => {
    const window = 16_384;
    const bytes = makeSource(window * 20);
    const calls: ReadCall[] = [];
    const read = (offset: number, length: number, signal: AbortSignal): Promise<Uint8Array> => {
      calls.push({ offset, length, signal });
      if (calls.length !== 2) {
        return Promise.resolve(bytes.slice(offset, offset + length));
      }
      // The second window hangs until it is aborted.
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };
    const server = await start({ size: bytes.length, read, windowBytes: window });
    const target = new URL(server.url);
    await new Promise<void>((resolve) => {
      const req = request({ host: target.hostname, port: target.port, path: target.pathname, headers: { Range: "bytes=0-" }, agent: false }, (res) => {
        res.once("data", () => {
          req.destroy();
          resolve();
        });
      });
      req.on("error", () => undefined);
      req.end();
    });
    await expect.poll(() => calls[1]?.signal.aborted, { timeout: 2000 }).toBe(true);
    await tick(50);
    expect(calls).toHaveLength(2);
    expect(server.failure.aborted).toBe(false);
    // The server still answers afterwards.
    const reply = await send(server.url, { headers: { Range: "bytes=0-9" } });
    expect(reply.status).toBe(206);
    expect(calls).toHaveLength(3);
  });

  it("survives a socket reset and malformed HTTP without throwing", async () => {
    const bytes = makeSource(4 * 65_536);
    const server = await start({ size: bytes.length, read: memoryRead(bytes).read, windowBytes: 65_536 });
    const target = new URL(server.url);
    const { connect } = await import("node:net");
    // Malformed HTTP.
    await new Promise<void>((resolve) => {
      const socket = connect(Number(target.port), target.hostname, () => socket.end("NOT HTTP\r\n\r\n"));
      socket.on("error", () => resolve());
      socket.on("close", () => resolve());
      socket.resume();
    });
    // A reset in the middle of a body.
    await new Promise<void>((resolve) => {
      const socket = connect(Number(target.port), target.hostname, () => {
        socket.write(`GET ${target.pathname} HTTP/1.1\r\nHost: 127.0.0.1\r\nRange: bytes=0-\r\n\r\n`);
      });
      socket.once("data", () => {
        socket.resetAndDestroy();
        resolve();
      });
      socket.on("error", () => undefined);
    });
    await tick(50);
    const reply = await send(server.url, { headers: { Range: "bytes=0-99" } });
    expect(reply.status).toBe(206);
    expect(reply.body.length).toBe(100);
    expect(server.failure.aborted).toBe(false);
  });

  it("refuses to ask for more than maxSourceBytes across requests, cuts the response and fails with source_limit", async () => {
    const window = 4096;
    const bytes = makeSource(window * 10);
    const { calls, read } = memoryRead(bytes);
    const server = await start({ size: bytes.length, read, windowBytes: window, maxSourceBytes: window * 3 });
    const first = await send(server.url, { headers: { Range: `bytes=0-${window * 2 - 1}` } });
    expect(first.status).toBe(206);
    expect(first.body.length).toBe(window * 2);
    // The cut may land before the headers leave, so only the truncation is certain.
    const cut = await sendExpectingCut(server.url, { Range: "bytes=0-" });
    expect(cut.complete).toBe(false);
    expect(cut.received).toBeLessThanOrEqual(window);
    expect(server.failure.aborted).toBe(true);
    const reason = server.failure.reason as unknown;
    expect(reason).toBeInstanceOf(FrameSourceError);
    expect((reason as FrameSourceError).kind).toBe("source_limit");
    // Never asked past the cap.
    expect(server.bytesRead).toBe(window * 3);
    expect(calls.reduce((sum, call) => sum + call.length, 0)).toBe(window * 3);
    // After the limit the server stops serving.
    const after = await sendExpectingCut(server.url, { Range: "bytes=0-9" });
    expect(after.complete).toBe(false);
    expect(calls).toHaveLength(3);
  });

  it("fails with read_failed, keeping the error, when a read throws, and cuts the response", async () => {
    const boom = new Error("storage unavailable");
    const server = await start({
      size: 10_000,
      read: async () => {
        throw boom;
      },
    });
    const cut = await sendExpectingCut(server.url, { Range: "bytes=0-" });
    expect(cut.complete).toBe(false);
    expect(server.failure.aborted).toBe(true);
    const reason = server.failure.reason as FrameSourceError;
    expect(reason).toBeInstanceOf(FrameSourceError);
    expect(reason.kind).toBe("read_failed");
    expect(reason.cause).toBe(boom);
  });

  it("fails with read_failed when a read returns a different length than asked", async () => {
    const server = await start({ size: 10_000, read: async (_offset, length) => new Uint8Array(length - 1) });
    const cut = await sendExpectingCut(server.url, { Range: "bytes=0-" });
    expect(cut.complete).toBe(false);
    const reason = server.failure.reason as FrameSourceError;
    expect(reason.kind).toBe("read_failed");
    expect(reason.message).toMatch(/9999 bytes.*10000/);
  });

  it("turns an exception while answering into a server_error failure instead of crashing", async () => {
    const bytes = makeSource(100);
    const thrown = new Error("observer broke");
    const server = await start({
      size: bytes.length,
      read: memoryRead(bytes).read,
      onRequest: () => {
        throw thrown;
      },
    });
    const cut = await sendExpectingCut(server.url, { Range: "bytes=0-" });
    expect(cut.complete).toBe(false);
    const reason = server.failure.reason as FrameSourceError;
    expect(reason).toBeInstanceOf(FrameSourceError);
    expect(reason.kind).toBe("server_error");
    expect(reason.cause).toBe(thrown);
  });

  it("aborts in-flight reads when the caller's signal fires", async () => {
    const controller = new AbortController();
    let readSignal: AbortSignal | undefined;
    const server = await start({
      size: 10_000,
      signal: controller.signal,
      read: (_offset, _length, signal) => {
        readSignal = signal;
        return new Promise(() => undefined);
      },
    });
    const pending = sendExpectingCut(server.url, { Range: "bytes=0-" });
    await expect.poll(() => readSignal).toBeDefined();
    controller.abort(new Error("caller gave up"));
    expect(readSignal?.aborted).toBe(true);
    await server.close();
    expect((await pending).complete).toBe(false);
  });

  it("close() stops listening, destroys open connections and aborts a read that never settles", async () => {
    let readSignal: AbortSignal | undefined;
    const server = await start({
      size: 10_000,
      read: (_offset, _length, signal) => {
        readSignal = signal;
        // Ignores its signal on purpose: close must not wait for it.
        return new Promise(() => undefined);
      },
    });
    const pending = sendExpectingCut(server.url, { Range: "bytes=0-" });
    await expect.poll(() => readSignal).toBeDefined();
    await server.close();
    expect(server.listening).toBe(false);
    expect(readSignal?.aborted).toBe(true);
    expect((await pending).complete).toBe(false);
    // Idempotent.
    await server.close();
    await expect(send(server.url)).rejects.toThrow();
  });
});
