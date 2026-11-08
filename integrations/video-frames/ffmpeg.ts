import "server-only";

import { execFile, type ExecFileException } from "node:child_process";

import type { PosterContainer } from "@/lib/video-frames";

/**
 * The ffmpeg runner for poster frames (video-posters plan, Task 4). It spawns the binary directly (no shell) with an
 * empty environment, a hard timeout that SIGKILLs, an optional abort signal and a bounded stdout, and classifies how
 * the run ended. It never rejects and never logs: the poster feature logs the outcome with the media id.
 */

/** The poster's long edge before sharp's final encode (D4: the THUMBNAIL spec is ≤ 1000 px). */
export const POSTER_MAX_EDGE = 1000;

/** The most PNG bytes ffmpeg may write; a 1000 × 1000 RGB48 frame is under 6 MiB even uncompressed. */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/** ffmpeg's socket receive buffer on the loopback connection (see `buildFrameArgs`). */
export const RECV_BUFFER_BYTES = 65_536;

/** How much of stderr comes back for the log. */
export const STDERR_TAIL_CHARS = 2000;

/**
 * Bound the long edge, never enlarge, and keep both sides even.
 * - `min(…)` keeps a small clip at its own size: a plain `w=1000:h=1000` with `force_original_aspect_ratio=decrease`
 *   blows a 64 × 36 frame up to 1000 × 563.
 * - `force_divisible_by=2`: zscale refuses 4:2:0 frames with an odd side ("image dimensions must be divisible by
 *   subsampling factor"), and 1920 × 1080 bounded to 1000 wide is 562.5 high. It gives 1000 × 562.
 * The commas inside `min()` are escaped for the filtergraph parser; execFile hands the string to ffmpeg untouched.
 */
export const POSTER_SCALE_FILTER =
  `scale=w=min(${POSTER_MAX_EDGE}\\,iw):h=min(${POSTER_MAX_EDGE}\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2`;

/**
 * HLG or PQ to SDR BT.709 (D5). It starts from the documented `zscale=transfer=linear,tonemap=…,zscale=transfer=
 * bt709,format=yuv420p` and completes it; the choices were measured on the darwin 6.0 binary (Task 4 report):
 * - `npl=203`: linear 1.0 is 203 cd/m², the HDR reference white of ITU-R BT.2408, so HDR diffuse white lands near
 *   SDR white and only real highlights are compressed. With `npl=100` diffuse white is already a highlight.
 * - `format=gbrpf32le` right after linearising: `tonemap` needs float RGB, and asking zscale for it keeps the
 *   conversion in zimg instead of an auto-inserted swscale step.
 * - `zscale=p=bt709` converts the BT.2020 primaries in linear light. The docs' bare example skips it and leaves the
 *   BT.2020 matrix in place: on a coloured HLG round trip its error was 69 levels against 18 for this chain.
 * - `mobius` with `param=0.7` and `desat=0`: linear up to 0.7, then a smooth roll-off to the peak. On an HLG signal
 *   ramp it maps 38 % (18 % grey) to 110 of 255, 75 % (reference white) to 225 and 85/90/100 % to 243/246/250, which
 *   is BT.2408's HLG-to-SDR intent with no hard clip. `hable` (npl 100) put reference white at 178 and grey at 97,
 *   `clip` flattens everything above about 80 %. The mid-grey HLG fixtures come out at 141 (BT.2408 predicts 143),
 *   the untouched decode at 128.
 * - `zscale=t=bt709:m=bt709:r=tv,format=yuv420p` back to 8-bit limited-range BT.709 for the PNG encoder. Both the
 *   6.0 and 7.0.2 binaries accept `bt709` and `709`; `bt709` is the docs' spelling.
 * It runs after the scale filter, so the float frames are at most 1000 px on the long edge: on a 4K HLG clip that
 * halves ffmpeg's peak memory (about 280 MB against 596 MB) and cuts its CPU time to about a third, for a
 * near-identical frame.
 */
export const HDR_TONEMAP_CHAIN = [
  "zscale=t=linear:npl=203",
  "format=gbrpf32le",
  "zscale=p=bt709",
  "tonemap=tonemap=mobius:param=0.7:desat=0",
  "zscale=t=bt709:m=bt709:r=tv",
  "format=yuv420p",
].join(",");

export interface FrameArgsInput {
  /** The loopback frame-server URL. */
  url: string;
  container: PosterContainer;
  seekSeconds: 1 | 0;
  toneMap: boolean;
  /** Decoder refusal above this many pixels (`-max_pixels`). */
  maxPixels: number;
}

/**
 * The argument vector, input options before `-i` and output options after it:
 * - `-threads 2 -max_pixels N` are decoder options; `-max_pixels` makes the decoder refuse a frame larger than the
 *   track declared (Lavf 60/61 print "exceeds specified max pixel count").
 * - `-protocol_whitelist http,tcp` and `-seekable 1` are protocol options of the http input.
 * - `-recv_buffer_size 65536` (a tcp option, passed down through http) caps how much the kernel buffers on ffmpeg's
 *   side of the loopback socket. Without it macOS autotunes that buffer towards 4 MiB, a whole 1 MiB window drains
 *   into it, and the frame server reads one or two windows ahead before ffmpeg hangs up to seek (measured: 2 to 4
 *   extra windows per extraction of the padded iPhone-shape file). With it, 80 of 80 runs read exactly
 *   moov + 2 windows. It also lowers ffmpeg's read-through threshold for short forward seeks to about 96 KiB.
 * - `-f <mov|matroska>` forces the demuxer chosen from our own sniff, so an upload is never probed as a playlist.
 * - `-ss <s> -noaccurate_seek` seeks to the keyframe at or before `s` and keeps it (D3).
 * - Output: the first video stream only, one frame, scaled (and tone-mapped), as PNG on stdout. Autorotation stays on.
 */
export function buildFrameArgs(input: FrameArgsInput): string[] {
  const filters = input.toneMap ? `${POSTER_SCALE_FILTER},${HDR_TONEMAP_CHAIN}` : POSTER_SCALE_FILTER;
  return [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-threads",
    "2",
    "-max_pixels",
    String(input.maxPixels),
    "-recv_buffer_size",
    String(RECV_BUFFER_BYTES),
    "-protocol_whitelist",
    "http,tcp",
    "-f",
    input.container,
    "-seekable",
    "1",
    "-ss",
    String(input.seekSeconds),
    "-noaccurate_seek",
    "-i",
    input.url,
    "-map",
    "0:v:0",
    "-an",
    "-sn",
    "-dn",
    "-frames:v",
    "1",
    "-vf",
    filters,
    "-f",
    "image2pipe",
    "-c:v",
    "png",
    "pipe:1",
  ];
}

/** Why a run that started and exited on its own produced no frame. */
export type FfmpegExitReason = "no_video_stream" | "pixel_limit" | "output_limit" | "not_png" | "error";

export type FfmpegRunOutcome =
  | { kind: "frame"; png: Buffer; stderrTail: string }
  /** Exit 0 with nothing on stdout: the seek landed past every frame. */
  | { kind: "empty"; stderrTail: string }
  /** ffmpeg never ran: `code` is the errno name (ENOENT, EACCES, EAGAIN, ENOMEM, …). */
  | { kind: "spawn_failed"; code: string; message: string }
  | { kind: "timed_out"; stderrTail: string }
  /** The abort signal fired; the child was killed. `reason` is the signal's reason. */
  | { kind: "aborted"; reason: unknown; stderrTail: string }
  | { kind: "exited"; reason: FfmpegExitReason; exitCode: number | null; signal: string | null; stderrTail: string };

export interface RunOptions {
  /** Hard limit; the child is SIGKILLed when it passes. Must be ≥ 1. */
  timeoutMs: number;
  signal?: AbortSignal;
  maxBuffer?: number;
}

/**
 * The child's whole environment: empty, so nothing from `process.env` (secrets included) reaches ffmpeg [C16]. Next.js
 * declares a required `NODE_ENV` on `NodeJS.ProcessEnv` for this process; a child's environment has no such need.
 */
const CHILD_ENV = {} as NodeJS.ProcessEnv;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** `-map 0:v:0` found nothing: 6.0 and 7.0 quote the map ("Stream map '0:v:0' …"), ffmpeg 9 quotes '' instead. */
const NO_VIDEO_STREAM = [/Stream map '[^']*' matches no streams/, /does not contain any stream/];
const PIXEL_LIMIT = /exceeds specified max pixel count/;

function tail(text: string): string {
  return text.length > STDERR_TAIL_CHARS ? text.slice(-STDERR_TAIL_CHARS) : text;
}

function toText(value: Buffer | string | undefined): string {
  if (value === undefined) {
    return "";
  }
  return typeof value === "string" ? value : value.toString("utf8");
}

/** Errors from `spawn` itself carry a `spawn…` syscall, whether execFile threw them or passed them to its callback. */
function spawnErrorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "syscall" in error && typeof error.syscall === "string" && error.syscall.startsWith("spawn")) {
    const code = "code" in error ? error.code : undefined;
    return typeof code === "string" ? code : "UNKNOWN";
  }
  return null;
}

/**
 * execFile throws synchronously when spawn fails with an errno outside libuv's deferred set (ENOMEM, E2BIG, …): that is
 * a spawn failure. Anything else it throws is an invalid call, reported as a failed run with the message as stderr.
 */
function thrownByExecFile(error: unknown): Extract<FfmpegRunOutcome, { kind: "spawn_failed" | "exited" }> {
  const message = error instanceof Error ? error.message : String(error);
  const spawnCode = spawnErrorCode(error);
  if (spawnCode !== null) {
    return { kind: "spawn_failed", code: spawnCode, message };
  }
  return { kind: "exited", reason: "error", exitCode: null, signal: null, stderrTail: tail(`execFile threw: ${message}`) };
}

function classifyExit(error: ExecFileException, stderr: string): FfmpegExitReason {
  if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return "output_limit";
  }
  if (PIXEL_LIMIT.test(stderr)) {
    return "pixel_limit";
  }
  if (NO_VIDEO_STREAM.some((pattern) => pattern.test(stderr))) {
    return "no_video_stream";
  }
  return "error";
}

/** Runs the binary once with buffered stdout. Never rejects. */
export function runFfmpeg(binaryPath: string, args: readonly string[], options: RunOptions): Promise<FfmpegRunOutcome> {
  const { signal } = options;
  if (signal?.aborted) {
    return Promise.resolve({ kind: "aborted", reason: signal.reason, stderrTail: "" });
  }
  return new Promise((resolve) => {
    try {
      execFile(
        binaryPath,
        args,
        {
          env: CHILD_ENV,
          timeout: Math.max(1, Math.floor(options.timeoutMs)),
          killSignal: "SIGKILL",
          maxBuffer: options.maxBuffer ?? MAX_FRAME_BYTES,
          encoding: "buffer",
          windowsHide: true,
          signal,
        },
        (error, stdout, stderr) => {
          const stderrText = toText(stderr);
          const stderrTail = tail(stderrText);
          if (!error) {
            if (stdout.length === 0) {
              resolve({ kind: "empty", stderrTail });
            } else if (!stdout.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
              resolve({ kind: "exited", reason: "not_png", exitCode: 0, signal: null, stderrTail });
            } else {
              resolve({ kind: "frame", png: stdout, stderrTail });
            }
            return;
          }
          const spawnCode = spawnErrorCode(error);
          if (spawnCode !== null) {
            resolve({ kind: "spawn_failed", code: spawnCode, message: error.message });
          } else if (error.name === "AbortError") {
            resolve({ kind: "aborted", reason: signal?.reason, stderrTail });
          } else if (error.killed && error.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            // Only execFile's own timeout kills without an AbortError or a maxBuffer error.
            resolve({ kind: "timed_out", stderrTail });
          } else {
            const exitCode = typeof error.code === "number" ? error.code : null;
            resolve({ kind: "exited", reason: classifyExit(error, stderrText), exitCode, signal: error.signal ?? null, stderrTail });
          }
        },
      );
    } catch (error) {
      resolve(thrownByExecFile(error));
    }
  });
}

export type FilterCheck = { kind: "known"; zscale: boolean } | Exclude<FfmpegRunOutcome, { kind: "frame" | "empty" }>;

const zscaleByBinary = new Map<string, Promise<FilterCheck>>();

/**
 * Whether the binary lists the `zscale` filter (`-hide_banner -filters`), asked once per binary and process. Only a
 * definite answer is cached; a spawn failure, timeout or abort is returned and the next call asks again.
 */
export function detectZscale(binaryPath: string, options: RunOptions): Promise<FilterCheck> {
  const cached = zscaleByBinary.get(binaryPath);
  if (cached) {
    return cached;
  }
  const check = runFilterList(binaryPath, options);
  zscaleByBinary.set(binaryPath, check);
  void check.then((result) => {
    if (result.kind !== "known") {
      zscaleByBinary.delete(binaryPath);
    }
  });
  return check;
}

function runFilterList(binaryPath: string, options: RunOptions): Promise<FilterCheck> {
  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve({ kind: "aborted", reason: options.signal.reason, stderrTail: "" });
      return;
    }
    try {
      execFile(
        binaryPath,
        ["-hide_banner", "-filters"],
        { env: CHILD_ENV, timeout: Math.max(1, Math.floor(options.timeoutMs)), killSignal: "SIGKILL", maxBuffer: 1024 * 1024, encoding: "utf8", windowsHide: true, signal: options.signal },
        (error, stdout, stderr) => {
          const stderrTail = tail(stderr);
          if (!error) {
            // Rows look like " .SC zscale            V->V       Apply resizing, …".
            resolve({ kind: "known", zscale: /^\s*\S+\s+zscale\s/m.test(stdout) });
            return;
          }
          const spawnCode = spawnErrorCode(error);
          if (spawnCode !== null) {
            resolve({ kind: "spawn_failed", code: spawnCode, message: error.message });
          } else if (error.name === "AbortError") {
            resolve({ kind: "aborted", reason: options.signal?.reason, stderrTail });
          } else if (error.killed) {
            resolve({ kind: "timed_out", stderrTail });
          } else {
            resolve({ kind: "exited", reason: "error", exitCode: typeof error.code === "number" ? error.code : null, signal: error.signal ?? null, stderrTail });
          }
        },
      );
    } catch (error) {
      resolve(thrownByExecFile(error));
    }
  });
}
