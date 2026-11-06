/**
 * GPS photo fixtures built in memory (plan 2026-11-06-photo-gps-places B2/B3), shared by the lib and feature suites.
 *
 * JPEGs come from sharp `withExif` (IFD3 = GPS) at the plan's point, the Statue of Liberty (40.689247 N, 74.044502 W =
 * 40° 41′ 21.2892″ N, 74° 2′ 40.2072″ W), so no family photo enters the repo. The HEIC fixtures are files in
 * __tests__/fixtures (provenance in its README).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "node:zlib";

import sharp from "sharp";

export const FIXTURES_DIR = join(__dirname, "..", "fixtures");
export const LIBERTY = { latitude: 40.689247, longitude: -74.044502 };
export const LAT_DMS = "40/1 41/1 212892/10000";
export const LON_DMS = "74/1 2/1 402072/10000";
/** ExifReader's first adaptive read (README: "an initial 128 KiB prefix"), and the server's JPEG prefix (B3). */
export const PREFIX_BYTES = 128 * 1024;

export type Ifd3 = Record<string, string>;

export async function jpegWithGps(ifd3: Ifd3 | null, size = 16): Promise<Buffer> {
  const image = sharp({ create: { width: size, height: size, channels: 3, background: "#336699" } }).jpeg();
  return (ifd3 ? image.withExif({ IFD3: ifd3 }) : image).toBuffer();
}

/** The Liberty point with the given refs; an omitted ref is left out of the IFD. */
export const liberty = (refs: { lat?: string; lon?: string } = { lat: "N", lon: "W" }): Ifd3 => ({
  ...(refs.lat === undefined ? {} : { GPSLatitudeRef: refs.lat }),
  GPSLatitude: LAT_DMS,
  ...(refs.lon === undefined ? {} : { GPSLongitudeRef: refs.lon }),
  GPSLongitude: LON_DMS,
});

/** One APP2 segment whose identifier ExifReader does not know (not ICC_PROFILE, not MPF), so it is skipped as padding. */
function app2Filler(payloadBytes: number): Buffer {
  const id = Buffer.from("FILLER\0", "latin1");
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xffe2, 0);
  header.writeUInt16BE(payloadBytes + 2, 2);
  return Buffer.concat([header, id, Buffer.alloc(payloadBytes - id.length)]);
}

/** SOI, then 200 KiB of APP2 filler (four 51,200-byte segments; one segment holds at most 65,533), then the rest of `jpeg` from its EXIF APP1 on. */
export function withLateExif(jpeg: Buffer): Buffer {
  return Buffer.concat([jpeg.subarray(0, 2), ...Array.from({ length: 4 }, () => app2Filler(51_200)), jpeg.subarray(2)]);
}

/** A 16 × 16 PNG, with the Liberty point in its eXIf chunk when `gps` is true. */
export async function pngTile(gps: boolean): Promise<Buffer> {
  const image = sharp({ create: { width: 16, height: 16, channels: 3, background: "#336699" } }).png();
  return (gps ? image.withExif({ IFD3: liberty() }) : image).toBuffer();
}

/** One PNG chunk: length, type, data and its CRC-32 over type and data. */
function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "latin1");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

/**
 * `png` with `count` tEXt chunks (distinct keywords k0, k1, …, each with the value "v") inserted right after IHDR,
 * so they come before sharp's eXIf chunk. Distinct keywords matter: ExifReader keys text tags by keyword, so repeats
 * would collapse into one tag.
 */
export function withTextChunks(png: Buffer, count: number): Buffer {
  const ihdrEnd = 8 + 12 + png.readUInt32BE(8); // signature, then IHDR's length, type, data and CRC
  const text = Array.from({ length: count }, (_, i) => pngChunk("tEXt", Buffer.from(`k${i}\0v`, "latin1")));
  return Buffer.concat([png.subarray(0, ihdrEnd), ...text, png.subarray(ihdrEnd)]);
}

export function readFixture(name: "gps.heic" | "tiny.heic" | "rotated.heic"): Buffer {
  return readFileSync(join(FIXTURES_DIR, name));
}
