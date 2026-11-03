import "server-only";

import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

import { ImageDeriveError } from "@/lib/image-derive-error";

export interface DecodedRgba {
  width: number;
  height: number;
  /** RGBA, row-major, 4 channels. */
  data: Uint8ClampedArray;
}

export interface RunWorkerOptions {
  deadlineMs: number;
  workerData: Record<string, unknown>;
  transferList?: ArrayBuffer[];
  maxOldGenerationSizeMb: number;
}

/**
 * Run an inline script in a worker thread with a hard deadline and a heap cap.
 * The script must `parentPort.postMessage()` exactly one result. On the
 * deadline the worker is terminated (the only way to interrupt synchronous
 * WASM work) and the promise rejects with `timeout`; a heap-limit kill maps to
 * `too_many_pixels`, any other failure to `decode_failed`.
 */
export function runWorker<T>(script: string, options: RunWorkerOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(script, {
      eval: true,
      workerData: options.workerData,
      transferList: options.transferList ?? [],
      resourceLimits: { maxOldGenerationSizeMb: options.maxOldGenerationSizeMb },
    });
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    };
    const timer = setTimeout(() => {
      settle(() => reject(new ImageDeriveError("timeout")));
      void worker.terminate();
    }, options.deadlineMs);
    worker.once("message", (value: T) => {
      settle(() => resolve(value));
      void worker.terminate();
    });
    worker.once("error", (error: Error & { code?: string }) => {
      settle(() =>
        reject(
          error.code === "ERR_WORKER_OUT_OF_MEMORY"
            ? new ImageDeriveError("too_many_pixels", { limit: Number(options.workerData.maxPixels) || undefined, cause: error })
            : new ImageDeriveError("decode_failed", { cause: error })
        )
      );
    });
    worker.once("exit", () => {
      settle(() => reject(new ImageDeriveError("decode_failed", { cause: new Error("worker exited without a result") })));
    });
  });
}

// The worker `require`s heic-decode by absolute path resolved here, so bundling
// and the function's working directory never matter.
const heicDecodePath = createRequire(import.meta.url).resolve("heic-decode");

const DECODE_SCRIPT = `
const { parentPort, workerData } = require("node:worker_threads");
const decode = require(workerData.modulePath);
(async () => {
  const buffer = Buffer.from(workerData.buffer);
  const images = await decode.all({ buffer });
  try {
    const first = images[0];
    if (!first) { throw new Error("HEIF image not found"); }
    if (first.width * first.height > workerData.maxPixels) {
      parentPort.postMessage({ tooManyPixels: true, width: first.width, height: first.height });
      return;
    }
    const { width, height, data } = await first.decode();
    const out = new Uint8ClampedArray(data);
    parentPort.postMessage({ width, height, data: out }, [out.buffer]);
  } finally {
    if (typeof images.dispose === "function") { images.dispose(); }
  }
})().catch((error) => {
  parentPort.postMessage({ error: error && error.message ? String(error.message) : String(error) });
});
`;

type DecodeMessage = { tooManyPixels: true; width: number; height: number } | { error: string } | DecodedRgba;

/**
 * Decode a HEIC/HEIF file to RGBA in a worker thread. Dimensions are read
 * before any pixel is decoded, so an oversized file costs only a header parse.
 */
export async function decodeHeicInWorker(
  input: Buffer,
  { deadlineMs, maxPixels, maxOldGenerationSizeMb = 512 }: { deadlineMs: number; maxPixels: number; maxOldGenerationSizeMb?: number }
): Promise<DecodedRgba> {
  // Copy into a standalone ArrayBuffer so it can be transferred (Buffers may share a pool).
  const bytes = new ArrayBuffer(input.byteLength);
  new Uint8Array(bytes).set(input);
  const message = await runWorker<DecodeMessage>(DECODE_SCRIPT, {
    deadlineMs,
    workerData: { modulePath: heicDecodePath, buffer: bytes, maxPixels },
    transferList: [bytes],
    maxOldGenerationSizeMb,
  });
  if ("error" in message) {
    throw new ImageDeriveError("decode_failed", { cause: new Error(message.error) });
  }
  if ("tooManyPixels" in message) {
    throw new ImageDeriveError("too_many_pixels", { limit: maxPixels });
  }
  return { width: message.width, height: message.height, data: new Uint8ClampedArray(message.data) };
}
