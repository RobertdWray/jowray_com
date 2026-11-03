/**
 * The single MIME allowlist and normalizer for uploads. The form, the upload
 * ticket, the upload route and the media route all go through here so that
 * `audio/webm;codecs=opus` from a recorder and an empty `File.type` for an
 * iPhone HEIC photo end up as the same canonical values everywhere.
 * No SVG, no text/HTML: nothing that a browser would execute.
 */

export type MediaKind = "PHOTO" | "VOICE" | "VIDEO";

interface MediaTypeSpec {
  kind: MediaKind;
  extension: string;
}

const MB = 1024 * 1024;

export const MAX_BYTES: Record<MediaKind, number> = {
  PHOTO: 25 * MB,
  VOICE: 100 * MB,
  VIDEO: 500 * MB,
};

const ALLOWED: Record<string, MediaTypeSpec> = {
  "image/jpeg": { kind: "PHOTO", extension: "jpg" },
  "image/png": { kind: "PHOTO", extension: "png" },
  "image/webp": { kind: "PHOTO", extension: "webp" },
  "image/heic": { kind: "PHOTO", extension: "heic" },
  "image/heif": { kind: "PHOTO", extension: "heif" },
  "image/gif": { kind: "PHOTO", extension: "gif" },
  "audio/mp4": { kind: "VOICE", extension: "m4a" },
  "audio/x-m4a": { kind: "VOICE", extension: "m4a" },
  "audio/mpeg": { kind: "VOICE", extension: "mp3" },
  "audio/webm": { kind: "VOICE", extension: "webm" },
  "audio/ogg": { kind: "VOICE", extension: "ogg" },
  "audio/wav": { kind: "VOICE", extension: "wav" },
  "video/mp4": { kind: "VIDEO", extension: "mp4" },
  "video/quicktime": { kind: "VIDEO", extension: "mov" },
  "video/webm": { kind: "VIDEO", extension: "webm" },
};

/** Extension → MIME when the browser reports no type (iPhone HEIC, .mov, .m4a). */
const BY_EXTENSION: Record<string, string> = {
  heic: "image/heic",
  heif: "image/heif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  m4a: "audio/x-m4a",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mov: "video/quicktime",
  mp4: "video/mp4",
  // `.webm` is ambiguous (audio or video); a recorder always reports its type,
  // so an untyped .webm file is treated as video.
  webm: "video/webm",
};

export const ALLOWED_MIME_TYPES: readonly string[] = Object.keys(ALLOWED);

/** Value for the file input's `accept` attribute: MIME types plus extensions. */
export const ACCEPT_ATTRIBUTE: string = [
  ...ALLOWED_MIME_TYPES,
  ...Object.keys(BY_EXTENSION).map((ext) => `.${ext}`),
].join(",");

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/**
 * Canonical MIME type for a file, or null when it cannot be determined or is
 * not on the allowlist. Parameters are stripped; an empty or generic browser
 * type falls back to the filename extension.
 */
export function normalizeMime(reported: string, filename: string): string | null {
  const bare = reported.split(";")[0]?.trim().toLowerCase() ?? "";
  if (bare && bare !== "application/octet-stream") {
    return isAllowedMime(bare) ? bare : null;
  }
  const extension = extensionOf(filename);
  // Own-property lookups only: "x.constructor" must not resolve a function.
  if (!Object.hasOwn(BY_EXTENSION, extension)) {
    return null;
  }
  const fromExtension = BY_EXTENSION[extension];
  return fromExtension && isAllowedMime(fromExtension) ? fromExtension : null;
}

export function isAllowedMime(mime: string): boolean {
  return Object.hasOwn(ALLOWED, mime);
}

function spec(mime: string): MediaTypeSpec {
  if (!Object.hasOwn(ALLOWED, mime)) {
    throw new Error(`Unsupported media type: ${mime}`);
  }
  return ALLOWED[mime] as MediaTypeSpec;
}

export function memoryTypeFor(mime: string): MediaKind {
  return spec(mime).kind;
}

export function maxBytesFor(mime: string): number {
  return MAX_BYTES[spec(mime).kind];
}

export function extensionFor(mime: string): string {
  return spec(mime).extension;
}

/**
 * Whether the browser identified by `userAgent` can render this type inline.
 * HEIC/HEIF render only in Safari (iOS and macOS); everything else on the
 * allowlist renders everywhere. Callers show a download link when false.
 */
export function isRenderableIn(mime: string, userAgent: string | null): boolean {
  if (mime !== "image/heic" && mime !== "image/heif") {
    return true;
  }
  if (!userAgent) {
    return false;
  }
  const isSafariEngine = /AppleWebKit/.test(userAgent) && /Safari/.test(userAgent);
  const isAnotherBrowser = /Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|OPR/.test(userAgent);
  return isSafariEngine && !isAnotherBrowser;
}

/** RFC 8187 attr-char excludes these even though encodeURIComponent keeps them. */
function encodeRfc8187(value: string): string {
  return encodeURIComponent(value).replaceAll(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * `attachment; filename="<ascii>"; filename*=UTF-8''<encoded>` with control
 * characters stripped. The ASCII fallback keeps `[A-Za-z0-9._-]` only and
 * becomes `memory.<extension>` when nothing usable is left (non-Latin names).
 */
export function attachmentDisposition(filename: string, extension: string): string {
  const clean = filename.replaceAll(/\p{Cc}/gu, "").trim();
  const stem = clean.replace(/\.[^.]*$/, "");
  const asciiStem = stem
    .replaceAll(/[^A-Za-z0-9._-]/g, "_")
    .replaceAll(/_+/g, "_")
    .replaceAll(/^[._-]+|[._-]+$/g, "");
  const asciiName = `${asciiStem.length > 0 ? asciiStem : "memory"}.${extension}`;
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeRfc8187(clean || asciiName)}`;
}
