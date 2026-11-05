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

/** An MPEG audio frame header: 11 sync bits, a version that is not reserved (01), a layer that is not reserved (00). */
function isMpegAudioFrameHeader(b1: number, b2: number): boolean {
  return b1 === 0xff && (b2 & 0xe0) === 0xe0 && (b2 & 0x18) !== 0x08 && (b2 & 0x06) !== 0x00;
}
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
 * Atom types a QuickTime or ISO BMFF file may start with. `ftyp` is optional
 * in QTFF: camcorder imports and old QuickTime exports begin with `moov`,
 * `wide` + `mdat`, or padding atoms.
 */
const TOP_LEVEL_ATOMS = new Set(["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot"]);

function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
}

/**
 * The first atom of a QuickTime / ISO BMFF file: its type, where its payload
 * starts and ends within the prefix, or null when the prefix is not an atom
 * at all. A size field of 0 means "to the end of the file", 1 means a 64-bit
 * `largesize` follows the type; anything else must cover at least the header.
 */
function firstAtom(bytes: Uint8Array): { type: string; payloadAt: number; end: number } | null {
  if (bytes.length < 8) {
    return null;
  }
  const size = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  const type = fourcc(bytes, 4);
  if (!TOP_LEVEL_ATOMS.has(type)) {
    return null;
  }
  if (size === 0) {
    return { type, payloadAt: 8, end: bytes.length };
  }
  if (size === 1) {
    // 64-bit size: only the low 32 bits can matter inside a 128-byte prefix.
    if (bytes.length < 16) {
      return null;
    }
    const low = ((bytes[12]! << 24) | (bytes[13]! << 16) | (bytes[14]! << 8) | bytes[15]!) >>> 0;
    const high = ((bytes[8]! << 24) | (bytes[9]! << 16) | (bytes[10]! << 8) | bytes[11]!) >>> 0;
    return { type, payloadAt: 16, end: high > 0 ? bytes.length : Math.min(low, bytes.length) };
  }
  if (size < 8) {
    return null;
  }
  return { type, payloadAt: 8, end: Math.min(size, bytes.length) };
}

/** The brands of a leading `ftyp` atom (major, then compatible), or null when the file does not start with one. */
function isoBmffBrands(bytes: Uint8Array): Set<string> | null {
  const atom = firstAtom(bytes);
  if (atom === null || atom.type !== "ftyp" || atom.payloadAt + 4 > bytes.length) {
    return null;
  }
  const brands = new Set<string>([fourcc(bytes, atom.payloadAt)]);
  for (let at = atom.payloadAt + 8; at + 4 <= atom.end; at += 4) {
    brands.add(fourcc(bytes, at));
  }
  return brands;
}

/**
 * Whether the first bytes of a file are consistent with `mime`. This is the
 * byte check behind READY: the Blob token and `head()` only ever see the type
 * the uploading client declared. Checks are per container, not per codec,
 * and the ISO BMFF families (mp4, mov, m4a) accept any leading top-level
 * atom and any `ftyp` brand on purpose: real device files carry brands and
 * layouts no list could enumerate, and a false rejection costs the family a
 * memory. The egress allowance, not this check, is what bounds abuse by
 * someone who forges a header.
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
      return firstAtom(bytes) !== null;
    case "audio/mpeg": {
      // Some encoders pad the start with zeros; then an ID3v2 tag, an APEv2 tag, or straight into the first frame.
      let at = 0;
      while (at < bytes.length && bytes[at] === 0) {
        at += 1;
      }
      return asciiAt(bytes, at, "ID3") || asciiAt(bytes, at, "APETAGEX") || (at + 1 < bytes.length && isMpegAudioFrameHeader(bytes[at]!, bytes[at + 1]!));
    }
    case "audio/webm":
    case "video/webm":
      return bytesAt(bytes, 0, EBML_MAGIC);
    case "audio/ogg":
      return asciiAt(bytes, 0, "OggS");
    case "audio/wav":
      // RIFF, and the 64-bit forms (RF64, BW64) long recordings and broadcast tools write.
      return (asciiAt(bytes, 0, "RIFF") || asciiAt(bytes, 0, "RF64") || asciiAt(bytes, 0, "BW64")) && asciiAt(bytes, 8, "WAVE");
    default:
      return false;
  }
}

/**
 * Order in which a kind's types are tried when the declared type does not
 * match: specific signatures first, the container-only ISO BMFF types last,
 * so a HEIC named `.jpg` is recognised as HEIC and never mistaken for an mp4.
 */
const DETECTION_ORDER: Record<MediaKind, readonly string[]> = {
  PHOTO: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"],
  VOICE: ["audio/mpeg", "audio/webm", "audio/ogg", "audio/wav", "audio/mp4", "audio/x-m4a"],
  VIDEO: ["video/webm", "video/mp4", "video/quicktime"],
};

/**
 * What a file is, given what the client said it was and its first bytes:
 * the declared type when the bytes agree; otherwise the allowed type of the
 * same kind the bytes do match (a JPEG saved as `.heic`, a WebP named `.jpg`,
 * a Voice Memo named `.mp3`), so the file is relabelled rather than lost; or
 * null when the bytes are another kind or no allowed type at all. Browsers
 * report `File.type` from the extension, so mislabels are ordinary.
 */
export function detectMediaType(declared: string, bytes: Uint8Array): string | null {
  if (!isAllowedMime(declared)) {
    return null;
  }
  if (matchesSignature(declared, bytes)) {
    return declared;
  }
  return DETECTION_ORDER[spec(declared).kind].find((candidate) => matchesSignature(candidate, bytes)) ?? null;
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
