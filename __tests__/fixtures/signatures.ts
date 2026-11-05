/**
 * Hand-made file prefixes, one per allowed MIME type, for the byte check that
 * runs before a Media row becomes READY (issue #45). Only headers: no real
 * media, no personal data. Shared by the media-types and ingest tests.
 */

const ascii = (text: string): number[] => Array.from(text, (c) => c.charCodeAt(0));
const bytes = (...parts: Array<number[] | string>): Uint8Array => Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? ascii(p) : p)));

/** An ISO BMFF `ftyp` box: size, type, major brand, minor version, compatible brands. */
export function ftyp(major: string, compatible: string[] = []): Uint8Array {
  const size = 16 + compatible.length * 4;
  return bytes([0, 0, 0, size], "ftyp", major, [0, 0, 0, 0], ...compatible);
}

export const SIGNATURE_SAMPLES: Record<string, Uint8Array> = {
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
export const MP3_FRAME_SYNC = Uint8Array.from([0xff, 0xfb, 0x90, 0x64, 0x00]);

export const NOT_MEDIA: Record<string, Uint8Array> = {
  empty: new Uint8Array(0),
  zeros: new Uint8Array(64),
  text: bytes("hello, this is not a media file at all"),
  html: bytes("<!doctype html><html><body>x</body></html>"),
  svg: bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'),
  pdf: bytes("%PDF-1.7\n%"),
  zip: bytes("PK", [0x03, 0x04, 0x14, 0x00]),
};
