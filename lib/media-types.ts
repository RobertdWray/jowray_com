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

/** Live (READY or PENDING, not removed) files one memory may hold. Lives here so `lib/validations` can import it. */
export const MAX_FILES_PER_MEMORY = 10;

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

/**
 * Bytes `recordMedia` reads from the start of a blob before it becomes READY
 * (issue #45). Enough for every signature below, including an ISO BMFF `ftyp`
 * box with a long list of compatible brands.
 */
export const SIGNATURE_PREFIX_BYTES = 128;

/** HEIF container brands (ISO/IEC 23008-12); what iPhones write as HEIC/HEIF. */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "miaf"]);

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function bytesAt(bytes: Uint8Array, at: number, expected: number[]): boolean {
  if (bytes.length < at + expected.length) {
    return false;
  }
  return expected.every((b, i) => bytes[at + i] === b);
}

function asciiAt(bytes: Uint8Array, at: number, text: string): boolean {
  return bytesAt(bytes, at, Array.from(text, (c) => c.charCodeAt(0)));
}

/**
 * The brands of an ISO BMFF file (size + `ftyp` + major brand + minor version
 * + compatible brands), or null when the prefix is not an `ftyp` box at all.
 * Only the brands inside the prefix are read; a truncated list is fine.
 */
function isoBmffBrands(bytes: Uint8Array): Set<string> | null {
  if (bytes.length < 12 || !asciiAt(bytes, 4, "ftyp")) {
    return null;
  }
  const boxSize = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  if (boxSize < 12) {
    return null;
  }
  const end = Math.min(boxSize, bytes.length);
  const brands = new Set<string>();
  const brandAt = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  brands.add(brandAt(8));
  for (let at = 16; at + 4 <= end; at += 4) {
    brands.add(brandAt(at));
  }
  return brands;
}

/**
 * Whether the first bytes of a file are consistent with `mime`. This is the
 * byte check behind READY: the Blob token and `head()` only ever see the type
 * the uploading client declared. Checks are per container, not per codec,
 * and the ISO BMFF families (mp4, mov, m4a) accept any `ftyp` brand on
 * purpose: real device files carry brands no list could enumerate, and a
 * false rejection costs the family a memory. The egress allowance, not this
 * check, is what bounds abuse by someone who forges a header.
 */
export function matchesSignature(mime: string, bytes: Uint8Array): boolean {
  switch (mime) {
    case "image/jpeg":
      return bytesAt(bytes, 0, [0xff, 0xd8, 0xff]);
    case "image/png":
      return bytesAt(bytes, 0, PNG_MAGIC);
    case "image/gif":
      return asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a");
    case "image/webp":
      return asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP");
    case "image/heic":
    case "image/heif": {
      const brands = isoBmffBrands(bytes);
      return brands !== null && [...brands].some((b) => HEIF_BRANDS.has(b));
    }
    case "video/mp4":
    case "video/quicktime":
    case "audio/mp4":
    case "audio/x-m4a":
      return isoBmffBrands(bytes) !== null;
    case "audio/mpeg":
      // An ID3v2 tag, or straight into the first frame (sync word: 11 set bits).
      return asciiAt(bytes, 0, "ID3") || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
    case "audio/webm":
    case "video/webm":
      return bytesAt(bytes, 0, EBML_MAGIC);
    case "audio/ogg":
      return asciiAt(bytes, 0, "OggS");
    case "audio/wav":
      return asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WAVE");
    default:
      return false;
  }
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

/**
 * The memory's summary type from its live media: VIDEO wins over VOICE over
 * PHOTO; with no live media the memory is TEXT when it has words and otherwise
 * has no honest type (null: callers keep the provisional value and treat the
 * memory as not confirmable). Unknown MIME types are ignored.
 */
export function summarizeMemoryType(media: ReadonlyArray<{ mimeType: string }>, hasWords: boolean): MediaKind | "TEXT" | null {
  const kinds = new Set<MediaKind>();
  for (const { mimeType } of media) {
    if (isAllowedMime(mimeType)) {
      kinds.add(memoryTypeFor(mimeType));
    }
  }
  if (kinds.has("VIDEO")) {
    return "VIDEO";
  }
  if (kinds.has("VOICE")) {
    return "VOICE";
  }
  if (kinds.has("PHOTO")) {
    return "PHOTO";
  }
  return hasWords ? "TEXT" : null;
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
