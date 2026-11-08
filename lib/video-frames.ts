/**
 * Shared constants and codes for video poster frames (video-posters plan, Task 4). Pure: the Sentry init
 * (`instrumentation.ts`), the frame service and the poster feature all read them, and only the service and its
 * integrations touch ffmpeg.
 */

/** Path prefix of the loopback frame server; every request path is `/__frames/<nonce>`. */
export const FRAME_SERVER_PREFIX = "/__frames/";

/** What a frame-server URL reads as once redacted: the shape stays recognisable, the port and nonce are gone. */
export const REDACTED_FRAME_URL = `http://127.0.0.1${FRAME_SERVER_PREFIX}[nonce]`;

/** `http://127.0.0.1:<port>/__frames/<nonce>`, the input ffmpeg names in its errors (the nonce is a `randomUUID()`). */
const FRAME_URL = new RegExp(`http://127\\.0\\.0\\.1(?::\\d+)?${FRAME_SERVER_PREFIX}[0-9A-Za-z-]+`, "g");

/**
 * `text` with every frame-server URL replaced by REDACTED_FRAME_URL. ffmpeg names its input in open and read errors
 * (6.0: `<url>: Invalid data found when processing input`; 7.0: `Error opening input file <url>.`), so its stderr is
 * redacted before any of it is kept for a log line.
 */
export function redactFrameUrls(text: string): string {
  return text.replace(FRAME_URL, REDACTED_FRAME_URL);
}

/** 8K UHD (7680 × 4320). ffmpeg's decoder refuses larger frames (`-max_pixels`), and the poster feature refuses larger declared tracks. */
export const MAX_VIDEO_PIXELS = 33_177_600;

/** The most bytes one extraction may ask of the original, across every request ffmpeg makes (D2). */
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

/** The frame server reads the original lazily, one window of this size at a time (D2). */
export const WINDOW_BYTES = 1024 * 1024;

/** The demuxer forced on ffmpeg, chosen by the caller from sniffed bytes (never probed from the upload). */
export type PosterContainer = "mov" | "matroska";

/**
 * Why no frame came out.
 * - `decode_failed`: ffmpeg exited non-zero for any other reason, the PNG overflowed its buffer, or a source read failed.
 * - `timeout`: the deadline passed or the caller's signal fired; the child was killed.
 * - `no_video_stream`: the input has no video stream.
 * - `no_frame`: ffmpeg exited 0 with no frame at 1 s and again at 0 s.
 * - `source_limit`: the run asked for more than `MAX_SOURCE_BYTES` of the original.
 * - `unsupported_type`: the caller's sniff found neither `mov` nor `matroska` (built by the poster feature).
 * - `too_many_pixels:<limit>`: the frame is larger than `limit` pixels (as `derive-media.ts` writes its ceiling).
 */
export type VideoFrameErrorCode =
  | "decode_failed"
  | "timeout"
  | "no_video_stream"
  | "no_frame"
  | "source_limit"
  | "unsupported_type"
  | `too_many_pixels:${number}`;

/** The code for a frame over `limit` pixels, in the form `derive-media.ts` records for photos. */
export function tooManyPixelsCode(limit: number): `too_many_pixels:${number}` {
  return `too_many_pixels:${limit}`;
}
