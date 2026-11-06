/**
 * GPS from a photo's EXIF, read the same way in the browser and on the server (plan 2026-11-06-photo-gps-places B2).
 *
 * - The browser reads a chosen `File` only to **suggest** places; what it finds is never sent to be stored (D2).
 * - The server reads the stored original's bytes (features/media/extract-photo-gps.ts) and writes `Media.latitude`/
 *   `longitude`. For a JPEG it first parses a prefix, and `jpegMetadataComplete` says whether that prefix result is final.
 *
 * Isomorphic on purpose: no `server-only`, no Node built-ins, nothing from `@/server` or `@/integrations`. A Client
 * Component imports this module dynamically. Coordinates are WGS 84 decimal degrees and are never logged (D14).
 *
 * GPS comes only from the EXIF GPS IFD, so both paths exclude ExifReader's `xmp` group: that skips parsing the
 * untrusted XML entirely (the group is never parsed, not just never returned) and keeps the server off the optional
 * `@xmldom/xmldom` parser. A position recorded only in XMP reads as absent.
 */
import ExifReader, { type ExpandedTags } from "exifreader";

import { coordinatesSchema, type Coordinates } from "@/lib/validations/memory";

export type GpsRead = { status: "found"; coordinates: Coordinates } | { status: "absent" } | { status: "failed"; error: unknown };

const ABSENT: GpsRead = Object.freeze({ status: "absent" });

/**
 * Browser: reads the metadata bytes of `file` through `File.slice` (ExifReader `length: "auto"`: a 128 KiB prefix,
 * then exactly the further bytes the metadata needs). `mpf` is excluded so a phone JPEG's embedded preview, often
 * megabytes in, does not pull the whole file in. Never rejects.
 *
 * Caller contract: pass only files of an accepted photo type, which are at most `MAX_BYTES.PHOTO` (25 MB). When the
 * adaptive read rejects (a metadata-less WebP or HEIC/HEIF, or bytes that are no image), the auto loop has already read
 * the file and the fallback below reads the whole file once more, into memory.
 */
export async function readGpsFromFile(file: File): Promise<GpsRead> {
  try {
    return gpsOf(await ExifReader.load(file, { length: "auto", expanded: true, includeOffsets: true, excludeTags: { mpf: true, xmp: true } }));
  } catch {
    // `length: "auto"` rejects with an untyped Error once it has read a whole file and found no metadata block (a WebP
    // or HEIC/HEIF with no Exif, such as a screenshot), where a bytes parse answers "absent". So parse the same bytes
    // the server would: browser and server then classify a file alike, and only a throw on this path is "failed".
    try {
      return readGpsFromBytes(new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      return { status: "failed", error }; // the file itself could not be read
    }
  }
}

/**
 * Server: parses bytes already in memory (the stored original or a prefix of it). Always bytes, never a string, which
 * ExifReader would treat as a path or URL. Never throws.
 */
export function readGpsFromBytes(bytes: Uint8Array): GpsRead {
  try {
    return gpsOf(ExifReader.load(bytes, { expanded: true, excludeTags: { xmp: true } }));
  } catch (error) {
    return outcomeOfThrow(error);
  }
}

/**
 * The shared rule (D12). A point is found only when:
 * - both raw refs are exactly N/S and E/W. ExifReader signs `gps.Latitude`/`Longitude` only on an exact "S"/"W", so a
 *   blank, missing or lower-case ref would come back positive and could be on the wrong side of the world;
 * - both values pass `coordinatesSchema` (finite and in range, matching the database CHECKs);
 * - the pair is not 0/0, the placeholder some Android cameras write when they have no fix.
 * Anything else is absent.
 */
function gpsOf(tags: ExpandedTags): GpsRead {
  const latitudeRef = refOf(tags.exif?.GPSLatitudeRef?.value);
  const longitudeRef = refOf(tags.exif?.GPSLongitudeRef?.value);
  if ((latitudeRef !== "N" && latitudeRef !== "S") || (longitudeRef !== "E" && longitudeRef !== "W")) {
    return ABSENT;
  }

  const parsed = coordinatesSchema.safeParse({ latitude: tags.gps?.Latitude, longitude: tags.gps?.Longitude });
  if (!parsed.success) {
    return ABSENT;
  }
  if (parsed.data.latitude === 0 && parsed.data.longitude === 0) {
    return ABSENT;
  }
  return { status: "found", coordinates: parsed.data };
}

/** The ref as ExifReader compares it (`value.join("")`), or undefined when the tag is missing. */
function refOf(value: string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join("") : undefined;
}

/**
 * A throw is a failure the caller may retry (unreadable or not an image), never "absent". The one exception is
 * ExifReader's own MetadataMissingError ("Thrown when no Exif metadata was found for the given image"): the bytes were
 * read and hold no metadata at all, so there is nothing to find and a retry would read the same bytes again.
 */
function outcomeOfThrow(error: unknown): GpsRead {
  if (error instanceof ExifReader.errors.MetadataMissingError) {
    return ABSENT;
  }
  return { status: "failed", error };
}

const SOI = 0xd8;
const SOS = 0xda;
const TEM = 0x01;
const RST0 = 0xd0;
const RST7 = 0xd7;

/**
 * True once a walk of the JPEG markers from SOI reaches SOS (FF DA) inside `prefix`. Every metadata segment (APPn:
 * EXIF, XMP, ICC, MPF) comes before the scan, so a prefix that holds SOS holds all of them and a "no GPS" read of it is
 * final. False for anything else: a prefix that ends first, a malformed segment, or bytes that are not a JPEG. The
 * caller then reads the whole original, which is always safe.
 */
export function jpegMetadataComplete(prefix: Uint8Array): boolean {
  if (prefix.length < 2 || prefix[0] !== 0xff || prefix[1] !== SOI) {
    return false;
  }
  let offset = 2;
  while (offset < prefix.length) {
    if (prefix[offset] !== 0xff) {
      return false;
    }
    // Any number of 0xFF fill bytes may precede a marker code.
    let code = offset + 1;
    while (code < prefix.length && prefix[code] === 0xff) {
      code += 1;
    }
    if (code >= prefix.length) {
      return false;
    }

    const marker = prefix[code];
    if (marker === SOS) {
      return true;
    }
    // FF 00 is byte stuffing inside entropy-coded data; EOI (or a second SOI) before any scan means there is none.
    if (marker === 0x00 || marker === 0xd9 || marker === SOI) {
      return false;
    }
    if (marker === TEM || (marker >= RST0 && marker <= RST7)) {
      offset = code + 1; // standalone markers carry no length
      continue;
    }
    if (code + 2 >= prefix.length) {
      return false;
    }
    const length = (prefix[code + 1] << 8) | prefix[code + 2]; // big-endian, counts its own two bytes
    if (length < 2) {
      return false;
    }
    offset = code + 1 + length;
  }
  return false;
}
