/**
 * Hand-made file prefixes, one per allowed MIME type, for the byte check that
 * runs before a Media row becomes READY (issue #45). Only headers: no real
 * media, no personal data. Shared by the media-types and ingest tests.
 */

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));
type Bytes = Uint8Array<ArrayBuffer>;
const bytes = (...parts: Array<number[] | string>): Bytes => Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? ascii(p) : p)));

/** An ISO BMFF `ftyp` box: size, type, major brand, minor version, compatible brands. */
export function ftyp(major: string, compatible: string[] = []): Bytes {
  const size = 16 + compatible.length * 4;
  return bytes([0, 0, 0, size], "ftyp", major, [0, 0, 0, 0], ...compatible);
}

/** A `ftyp` box with a 64-bit `largesize` (size field 1): brands start at offset 24. */
export function ftypLarge(major: string, compatible: string[] = []): Bytes {
  const size = 24 + compatible.length * 4;
  return bytes([0, 0, 0, 1], "ftyp", [0, 0, 0, 0, 0, 0, 0, size], major, [0, 0, 0, 0], ...compatible);
}

/** Any top-level QuickTime / ISO BMFF atom as the first thing in the file; `size` 0 means "to end of file", 1 means 64-bit. */
export function atom(type: string, size = 8, payload: number[] = [0, 0, 0, 0, 0, 0, 0, 0]): Bytes {
  return bytes([(size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff], type, payload);
}

export const SIGNATURE_SAMPLES: Record<string, Bytes> = {
  "image/jpeg": bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], "JFIF", [0x00]),
  "image/png": bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d], "IHDR"),
  "image/gif": bytes("GIF89a", [0x20, 0x00, 0x20, 0x00, 0xf7]),
  "image/webp": bytes("RIFF", [0x24, 0x00, 0x00, 0x00], "WEBP", "VP8 "),
  "image/heic": ftyp("heic", ["mif1", "heic"]),
  "image/heif": ftyp("mif1", ["mif1", "heif"]),
  "video/mp4": ftyp("isom", ["isom", "iso2", "avc1", "mp41"]),
  "video/quicktime": ftyp("qt  ", ["qt  "]),
  "audio/mp4": ftyp("iso5", ["iso5", "mp42"]),
  "audio/x-m4a": ftyp("M4A ", ["M4A ", "mp42", "isom"]),
  "audio/mpeg": bytes("ID3", [0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
  "audio/webm": bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]),
  "audio/ogg": bytes("OggS", [0x00, 0x02, 0x00, 0x00]),
  "audio/wav": bytes("RIFF", [0x24, 0x08, 0x00, 0x00], "WAVE", "fmt "),
  "video/webm": bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]),
};

/** An MP3 without an ID3 tag: the first frame's sync word. */
export const MP3_FRAME_SYNC: Bytes = Uint8Array.from([0xff, 0xfb, 0x90, 0x64, 0x00]);
/** Real-world MP3 and WAV layouts that are still the declared type (issue #45 review cycle 2). */
export const ALSO_VALID: Record<string, Bytes> = {
  mp3_zero_padded: bytes(new Array(24).fill(0), [0xff, 0xfb, 0x90, 0x64]),
  mp3_ape_tag: bytes("APETAGEX", [0xd0, 0x07, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00]),
  mp3_mpeg2_layer3: bytes([0xff, 0xf3, 0x82, 0x44]),
  wav_rf64: bytes("RF64", [0xff, 0xff, 0xff, 0xff], "WAVE", "ds64"),
  wav_bw64: bytes("BW64", [0xff, 0xff, 0xff, 0xff], "WAVE", "ds64"),
};
/** Real formats the allowlist does not carry: never READY, but never deleted on the byte check alone. */
export const REAL_BUT_NOT_ALLOWED: Record<string, Bytes> = {
  aiff: bytes("FORM", [0x00, 0x00, 0x10, 0x00], "AIFF", "COMM"),
  tiff: bytes("II", [0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]),
  bmp: bytes("BM", [0x36, 0x00, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x36, 0x00]),
};

export const NOT_MEDIA: Record<string, Bytes> = {
  empty: new Uint8Array(0),
  zeros: new Uint8Array(64),
  text: bytes("hello, this is not a media file at all"),
  html: bytes("<!doctype html><html><body>x</body></html>"),
  svg: bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'),
  pdf: bytes("%PDF-1.7\n%"),
  zip: bytes("PK", [0x03, 0x04, 0x14, 0x00]),
};
