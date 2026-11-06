/**
 * lib/photo-gps.ts (plan 2026-11-06-photo-gps-places B2): GPS from a photo's EXIF, read the same way from a browser
 * `File` (adaptive `length: "auto"` reads through `File.slice`) and from the stored original's bytes on the server.
 *
 * Fixtures come from __tests__/helpers/photo-gps-fixtures.ts (sharp `withExif` JPEGs at the Statue of Liberty, and the
 * HEIC files). `File` here is Node's global (the vitest environment is node), the class ExifReader's `instanceof File`
 * check sees.
 */
import ExifReader from "exifreader";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jpegMetadataComplete, readGpsFromBytes, readGpsFromFile, type GpsRead } from "@/lib/photo-gps";

import { jpegWithGps, LAT_DMS, liberty, LIBERTY, LON_DMS, pngTile, PREFIX_BYTES, readFixture, withLateExif, withTextChunks } from "../helpers/photo-gps-fixtures";

/** An XMP packet whose exif:GPS* claims a different point (10 N, 20 E) than the EXIF IFD: only EXIF may decide. */
const XMP_OTHER_POINT =
  '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  '<rdf:Description rdf:about="" xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="10,0.0N" exif:GPSLongitude="20,0.0E"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
/** Untrusted XML that is not well-formed. */
const XMP_MALFORMED = '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description <<< not xml &&& </x:xmpmeta>';
const xmpTile = () => sharp({ create: { width: 16, height: 16, channels: 3, background: "#336699" } }).jpeg();

type Recorded = { file: File; slices: Array<[number | undefined, number | undefined]>; wholeReads: () => number };

/**
 * A `File` that records each `slice(start, end)` ExifReader asks for and each whole-file `arrayBuffer()` read (the
 * fallback; ExifReader reads the Blob its `slice` returns, never the File itself). `failWholeRead` makes that read reject.
 */
function recordingFile(bytes: Uint8Array, name: string, type: string, failWholeRead?: Error): Recorded {
  const slices: Array<[number | undefined, number | undefined]> = [];
  let wholeReads = 0;
  class RecordingFile extends File {
    override slice(start?: number, end?: number, contentType?: string): Blob {
      slices.push([start, end]);
      return super.slice(start, end, contentType);
    }
    override async arrayBuffer(): Promise<ArrayBuffer> {
      wholeReads += 1;
      if (failWholeRead) {
        throw failWholeRead;
      }
      return super.arrayBuffer();
    }
  }
  return { file: new RecordingFile([new Uint8Array(bytes)], name, { type }), slices, wholeReads: () => wholeReads };
}

function expectFound(read: GpsRead, expected: { latitude: number; longitude: number }) {
  expect(read.status).toBe("found");
  if (read.status !== "found") {
    return;
  }
  // ExifReader sums degrees + minutes/60 + seconds/3600, so the double can differ in the 15th digit.
  expect(read.coordinates.latitude).toBeCloseTo(expected.latitude, 9);
  expect(read.coordinates.longitude).toBeCloseTo(expected.longitude, 9);
  expect(Object.keys(read.coordinates).sort()).toEqual(["latitude", "longitude"]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readGpsFromBytes", () => {
  it.each([
    { refs: { lat: "N", lon: "W" }, expected: { latitude: 40.689247, longitude: -74.044502 } },
    { refs: { lat: "N", lon: "E" }, expected: { latitude: 40.689247, longitude: 74.044502 } },
    { refs: { lat: "S", lon: "W" }, expected: { latitude: -40.689247, longitude: -74.044502 } },
    { refs: { lat: "S", lon: "E" }, expected: { latitude: -40.689247, longitude: 74.044502 } },
  ])("finds signed degrees for refs $refs.lat/$refs.lon", async ({ refs, expected }) => {
    expectFound(readGpsFromBytes(await jpegWithGps(liberty(refs))), expected);
  });

  it("reads a Uint8Array view at a non-zero byteOffset (a Buffer slice of a larger allocation)", async () => {
    const jpeg = await jpegWithGps(liberty());
    const backing = new Uint8Array(jpeg.length + 1000);
    backing.set(jpeg, 1000);
    expectFound(readGpsFromBytes(backing.subarray(1000)), LIBERTY);
  });

  it("finds a point on the equator or the prime meridian: only the 0/0 pair counts as absent", async () => {
    expectFound(readGpsFromBytes(await jpegWithGps({ GPSLatitudeRef: "N", GPSLatitude: "0/1 0/1 0/1", GPSLongitudeRef: "W", GPSLongitude: LON_DMS })), {
      latitude: 0,
      longitude: -74.044502,
    });
    expectFound(readGpsFromBytes(await jpegWithGps({ GPSLatitudeRef: "N", GPSLatitude: LAT_DMS, GPSLongitudeRef: "E", GPSLongitude: "0/1 0/1 0/1" })), {
      latitude: 40.689247,
      longitude: 0,
    });
  });

  it.each([
    { name: "no EXIF at all", ifd3: null },
    { name: "0/0 (Android's placeholder)", ifd3: { GPSLatitudeRef: "N", GPSLatitude: "0/1 0/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "0/1 0/1 0/1" } },
    { name: "both refs missing", ifd3: liberty({}) },
    { name: "the latitude ref missing", ifd3: liberty({ lon: "W" }) },
    { name: "the longitude ref missing", ifd3: liberty({ lat: "N" }) },
    // ExifReader negates only on an exact "S"/"W"; any other ref would come back as a positive (possibly wrong) degree.
    { name: "blank refs", ifd3: liberty({ lat: " ", lon: " " }) },
    { name: "lower-case refs", ifd3: liberty({ lat: "s", lon: "w" }) },
    { name: "refs swapped between axes", ifd3: liberty({ lat: "W", lon: "N" }) },
    { name: "a latitude only", ifd3: { GPSLatitudeRef: "N", GPSLatitude: LAT_DMS } },
    { name: "a latitude over 90", ifd3: { GPSLatitudeRef: "N", GPSLatitude: "91/1 0/1 0/1", GPSLongitudeRef: "W", GPSLongitude: LON_DMS } },
    { name: "a longitude over 180", ifd3: { GPSLatitudeRef: "N", GPSLatitude: LAT_DMS, GPSLongitudeRef: "W", GPSLongitude: "181/1 0/1 0/1" } },
    { name: "a zero denominator (not a finite number)", ifd3: { GPSLatitudeRef: "N", GPSLatitude: "40/0 41/1 0/1", GPSLongitudeRef: "W", GPSLongitude: LON_DMS } },
  ])("is absent for $name", async ({ ifd3 }) => {
    expect(readGpsFromBytes(await jpegWithGps(ifd3))).toEqual({ status: "absent" });
  });

  it("is absent for a HEIC with no EXIF (tiny.heic)", () => {
    expect(readGpsFromBytes(readFixture("tiny.heic"))).toEqual({ status: "absent" });
  });

  it("finds the point in gps.heic (exiftool-written GPS IFD in a HEIC Exif item)", () => {
    expectFound(readGpsFromBytes(readFixture("gps.heic")), LIBERTY);
  });

  it.each([
    { name: "bytes that are no image", bytes: new TextEncoder().encode("not an image, just some text") },
    { name: "an empty file", bytes: new Uint8Array(0) },
  ])("is failed, never absent, when the parser throws: $name", ({ bytes }) => {
    const read = readGpsFromBytes(bytes);
    expect(read.status).toBe("failed");
    expect(read.status === "failed" && read.error).toBeInstanceOf(Error);
  });

  it("is absent when ExifReader reports MetadataMissingError ('No Exif data'): nothing to find, not a parse failure", async () => {
    vi.spyOn(ExifReader, "load").mockImplementation(() => {
      throw new ExifReader.errors.MetadataMissingError();
    });
    expect(readGpsFromBytes(await jpegWithGps(liberty()))).toEqual({ status: "absent" });
  });

  it("is absent for a 128 KiB prefix of the late-EXIF JPEG, and found in the whole file", async () => {
    const late = withLateExif(await jpegWithGps(liberty()));
    expect(late.indexOf(Buffer.from("Exif\0\0", "latin1"))).toBeGreaterThan(PREFIX_BYTES);
    expect(readGpsFromBytes(late.subarray(0, PREFIX_BYTES))).toEqual({ status: "absent" });
    expectFound(readGpsFromBytes(late), LIBERTY);
  });
});

describe("readGpsFromFile", () => {
  it("finds the point in a JPEG File", async () => {
    const { file } = recordingFile(await jpegWithGps(liberty()), "photo.jpg", "image/jpeg");
    expectFound(await readGpsFromFile(file), LIBERTY);
  });

  it("reads only the metadata bytes of a large JPEG: one File.slice of the first 128 KiB", async () => {
    const noisy = await sharp({ create: { width: 900, height: 900, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 40 } } })
      .jpeg({ quality: 95 })
      .withExif({ IFD3: liberty() })
      .toBuffer();
    expect(noisy.length).toBeGreaterThan(3 * PREFIX_BYTES);
    const { file, slices } = recordingFile(noisy, "big.jpg", "image/jpeg");
    expectFound(await readGpsFromFile(file), LIBERTY);
    expect(slices).toEqual([[0, PREFIX_BYTES]]);
  });

  it("follows EXIF that starts past the first 128 KiB (late-EXIF JPEG) with a second File.slice", async () => {
    const late = withLateExif(await jpegWithGps(liberty()));
    const { file, slices } = recordingFile(late, "late.jpg", "image/jpeg");
    expectFound(await readGpsFromFile(file), LIBERTY);
    expect(slices).toEqual([
      [0, PREFIX_BYTES],
      [PREFIX_BYTES, late.length],
    ]);
  });

  it("finds the point in gps.heic through the metadata read alone, without a whole-file read", async () => {
    const gps = recordingFile(readFixture("gps.heic"), "gps.heic", "image/heic");
    expectFound(await readGpsFromFile(gps.file), LIBERTY);
    expect(gps.wholeReads()).toBe(0);
  });

  it("is absent for a metadata-less HEIC (tiny.heic): the auto read rejects, the whole-file bytes parse decides", async () => {
    const tiny = recordingFile(readFixture("tiny.heic"), "tiny.heic", "image/heic");
    expect(await readGpsFromFile(tiny.file)).toEqual({ status: "absent" });
    expect(tiny.wholeReads()).toBe(1);
  });

  it("is absent for a JPEG File with no GPS, without a whole-file read", async () => {
    const plain = recordingFile(await jpegWithGps(null), "plain.jpg", "image/jpeg");
    expect(await readGpsFromFile(plain.file)).toEqual({ status: "absent" });
    expect(plain.wholeReads()).toBe(0);
  });

  it("is failed (it resolves, never rejects) when the fallback parse throws: a File that is no image", async () => {
    const text = recordingFile(new TextEncoder().encode("plain text"), "notes.jpg", "image/jpeg");
    const read = await readGpsFromFile(text.file);
    expect(text.wholeReads()).toBe(1);
    expect(read.status).toBe("failed");
    expect(read.status === "failed" && read.error).toBeInstanceOf(Error);
  });

  it("is failed (it resolves, never rejects) when the fallback's whole-file read itself throws", async () => {
    const unreadable = new DOMException("The file could not be read.", "NotReadableError");
    const tiny = recordingFile(readFixture("tiny.heic"), "tiny.heic", "image/heic", unreadable);
    expect(await readGpsFromFile(tiny.file)).toEqual({ status: "failed", error: unreadable });
  });

  it("classifies every probe input exactly as readGpsFromBytes does on the same bytes", async () => {
    const tile = () => sharp({ create: { width: 16, height: 16, channels: 3, background: "#123456" } });
    const gpsExif = { IFD3: liberty() };
    const inputs: Record<string, Uint8Array> = {
      "JPEG with GPS": await tile().jpeg().withExif(gpsExif).toBuffer(),
      "JPEG, no EXIF": await tile().jpeg().toBuffer(),
      "late-EXIF JPEG": withLateExif(await jpegWithGps(liberty())),
      "PNG with GPS": await tile().png().withExif(gpsExif).toBuffer(),
      "PNG, no metadata": await tile().png().toBuffer(),
      "WebP with GPS": await tile().webp().withExif(gpsExif).toBuffer(),
      "WebP, no metadata": await tile().webp().toBuffer(),
      "GIF, no metadata": await tile().gif().toBuffer(),
      "gps.heic": readFixture("gps.heic"),
      "tiny.heic": readFixture("tiny.heic"),
      "rotated.heic": readFixture("rotated.heic"),
      "text": new TextEncoder().encode("plain text"),
      "JPEG with EXIF GPS and an XMP packet": await xmpTile().withExif(gpsExif).withXmp(XMP_OTHER_POINT).toBuffer(),
      "JPEG with EXIF GPS and malformed XMP": await xmpTile().withExif(gpsExif).withXmp(XMP_MALFORMED).toBuffer(),
      "JPEG with GPS only in XMP": await xmpTile().withXmp(XMP_OTHER_POINT).toBuffer(),
    };
    const summary = (read: GpsRead) => (read.status === "found" ? { status: read.status, coordinates: read.coordinates } : { status: read.status });
    const viaFile: Record<string, unknown> = {};
    const viaBytes: Record<string, unknown> = {};
    for (const [name, bytes] of Object.entries(inputs)) {
      viaFile[name] = summary(await readGpsFromFile(new File([new Uint8Array(bytes)], name)));
      viaBytes[name] = summary(readGpsFromBytes(bytes));
    }
    expect(viaFile).toEqual(viaBytes);
    expect(Object.values(viaBytes).map((read) => (read as { status: string }).status)).toEqual([
      "found", "absent", "found", "found", "absent", "found", "absent", "absent", "found", "absent", "absent", "failed", "found", "found", "absent",
    ]);
  });
});

describe("XMP is never parsed: GPS comes only from EXIF (B2 fix round 1)", () => {
  it("reads the EXIF point, not the XMP one, on both paths, and treats GPS that is only in XMP as absent", async () => {
    const both = await xmpTile().withExif({ IFD3: liberty() }).withXmp(XMP_OTHER_POINT).toBuffer();
    expectFound(readGpsFromBytes(both), LIBERTY);
    expectFound(await readGpsFromFile(new File([new Uint8Array(both)], "both.jpg")), LIBERTY);
    const xmpOnly = await xmpTile().withXmp(XMP_OTHER_POINT).toBuffer();
    expect(readGpsFromBytes(xmpOnly)).toEqual({ status: "absent" });
    expect(await readGpsFromFile(new File([new Uint8Array(xmpOnly)], "xmp-only.jpg"))).toEqual({ status: "absent" });
  });

  it("asks ExifReader to skip the XMP group on both paths, so even a malformed packet is never parsed or returned", async () => {
    const load = vi.spyOn(ExifReader, "load"); // calls through to the real parser
    const malformed = await xmpTile().withExif({ IFD3: liberty() }).withXmp(XMP_MALFORMED).toBuffer();
    const wellFormed = await xmpTile().withExif({ IFD3: liberty() }).withXmp(XMP_OTHER_POINT).toBuffer();
    for (const bytes of [malformed, wellFormed]) {
      expectFound(readGpsFromBytes(bytes), LIBERTY);
      expectFound(await readGpsFromFile(new File([new Uint8Array(bytes)], "photo.jpg")), LIBERTY);
    }
    expect(load).toHaveBeenCalledTimes(4);
    for (const [index, call] of load.mock.calls.entries()) {
      expect((call[1] as { excludeTags?: Record<string, unknown> } | undefined)?.excludeTags).toMatchObject({ xmp: true });
      const tags = (await load.mock.results[index]!.value) as { xmp?: unknown; exif?: unknown };
      expect(tags.exif).toBeDefined();
      expect(tags.xmp).toBeUndefined();
    }
  });
});

describe("the same ExifReader groups are skipped on both paths (final review, item 7; Team Code Review #1)", () => {
  /**
   * Every group GPS never needs that ExifReader can skip, except `png`: its text chunks are parsed whenever `exif` is
   * (a PNG may carry its Exif in a text chunk), so excluding it would not skip them; the cap on them comes from the
   * library itself (see "a PNG's text chunks are capped").
   */
  const SKIPPED = { icc: true, iptc: true, makerNotes: true, mpf: true, photoshop: true, thumbnail: true, xmp: true };

  it("passes the same excludeTags from the browser (File) and the server (bytes), and both still find the point", async () => {
    const load = vi.spyOn(ExifReader, "load"); // calls through to the real parser
    const bytes = await jpegWithGps(liberty());
    expectFound(readGpsFromBytes(bytes), LIBERTY);
    expectFound(await readGpsFromFile(new File([new Uint8Array(bytes)], "photo.jpg")), LIBERTY);
    expect(load).toHaveBeenCalledTimes(2);
    for (const call of load.mock.calls) {
      expect((call[1] as { excludeTags?: Record<string, unknown> } | undefined)?.excludeTags).toEqual(SKIPPED);
    }
    load.mockRestore();
  });

  it("never returns an ICC profile it was given, on either path, and still finds the point", async () => {
    const load = vi.spyOn(ExifReader, "load"); // calls through to the real parser
    const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#336699" } }).jpeg().withIccProfile("srgb").withExif({ IFD3: liberty() }).toBuffer();
    expect(ExifReader.load(bytes, { expanded: true }).icc).toBeDefined(); // the fixture does carry one
    load.mockClear();
    expectFound(readGpsFromBytes(bytes), LIBERTY);
    expectFound(await readGpsFromFile(new File([new Uint8Array(bytes)], "photo.jpg")), LIBERTY);
    expect(load).toHaveBeenCalledTimes(2);
    for (const result of load.mock.results) {
      const tags = (await result.value) as { icc?: unknown; exif?: unknown };
      expect(tags.exif).toBeDefined();
      expect(tags.icc).toBeUndefined();
    }
    load.mockRestore();
  });
});

describe("a PNG's text chunks are capped by the parser (Team Code Review #1/#5)", () => {
  // exifreader 4.54.0: "PNG text chunks (tEXt, iTXt, zTXt) are read only up to the first 4,096 … This stops a crafted
  // file with hundreds of thousands of chunks from exhausting memory." 4.51.0 read every one: a 25 MB PNG of 1.46
  // million distinct tEXt chunks grew the heap by about 921 MB. 5,000 chunks tell the two apart without timing.
  const TEXT_CHUNK_CAP = 4_096;
  const OVER_THE_CAP = 5_000;

  it("parses at most 4,096 text chunks on the server path, and still finds the EXIF point that follows them", async () => {
    const load = vi.spyOn(ExifReader, "load"); // calls through to the real parser
    const png = withTextChunks(await pngTile(true), OVER_THE_CAP);
    expectFound(readGpsFromBytes(png), LIBERTY);
    expect(load).toHaveBeenCalledTimes(1);
    const tags = load.mock.results[0]!.value as { pngText?: Record<string, unknown> };
    expect(Object.keys(tags.pngText ?? {}).length).toBeLessThanOrEqual(TEXT_CHUNK_CAP);
  });

  it("is absent for a PNG of text chunks with no GPS", async () => {
    expect(readGpsFromBytes(withTextChunks(await pngTile(false), OVER_THE_CAP))).toEqual({ status: "absent" });
  });
});

describe("jpegMetadataComplete", () => {
  /** Offset of the SOS marker (FF DA) found by a plain scan; sharp writes no FF DA earlier in these small files. */
  function sosOffset(jpeg: Uint8Array): number {
    for (let i = 0; i + 1 < jpeg.length; i += 1) {
      if (jpeg[i] === 0xff && jpeg[i + 1] === 0xda) {
        return i;
      }
    }
    throw new Error("no SOS in fixture");
  }

  it("is true for a whole JPEG and for any prefix that contains the SOS marker, false for one that stops short of it", async () => {
    const jpeg = await jpegWithGps(liberty());
    const sos = sosOffset(jpeg);
    expect(jpegMetadataComplete(jpeg)).toBe(true);
    expect(jpegMetadataComplete(jpeg.subarray(0, sos + 2))).toBe(true);
    expect(jpegMetadataComplete(jpeg.subarray(0, sos + 1))).toBe(false);
    expect(jpegMetadataComplete(jpeg.subarray(0, sos))).toBe(false);
    expect(jpegMetadataComplete(jpeg.subarray(0, 40))).toBe(false);
  });

  it("is false for the late-EXIF JPEG's 128 KiB prefix (it ends inside the filler) and true for the whole file", async () => {
    const late = withLateExif(await jpegWithGps(liberty()));
    expect(jpegMetadataComplete(late.subarray(0, PREFIX_BYTES))).toBe(false);
    expect(jpegMetadataComplete(late)).toBe(true);
  });

  it("skips fill bytes before a marker and standalone markers that carry no length", () => {
    const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
    expect(jpegMetadataComplete(new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0xff, ...app0, 0xff, 0xda]))).toBe(true);
    expect(jpegMetadataComplete(new Uint8Array([0xff, 0xd8, 0xff, 0x01, ...app0, 0xff, 0xd0, 0xff, 0xda]))).toBe(true);
  });

  it.each([
    { name: "an empty prefix", bytes: [] },
    { name: "SOI alone", bytes: [0xff, 0xd8] },
    { name: "SOI then EOI (no scan)", bytes: [0xff, 0xd8, 0xff, 0xd9] },
    { name: "a segment length under 2", bytes: [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xda] },
    { name: "a segment whose length runs past the prefix", bytes: [0xff, 0xd8, 0xff, 0xe1, 0x10, 0x00, 0xff, 0xda] },
    { name: "a length cut off by the prefix", bytes: [0xff, 0xd8, 0xff, 0xe1, 0x10] },
    { name: "a byte other than FF where a marker belongs", bytes: [0xff, 0xd8, 0x00, 0xff, 0xda] },
    { name: "a stuffed FF 00 where a marker belongs", bytes: [0xff, 0xd8, 0xff, 0x00, 0xff, 0xda] },
    { name: "not a JPEG (PNG signature)", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  ])("is false for $name", ({ bytes }) => {
    expect(jpegMetadataComplete(new Uint8Array(bytes))).toBe(false);
  });

  it("is false for a HEIC (not a JPEG)", () => {
    expect(jpegMetadataComplete(readFixture("gps.heic"))).toBe(false);
  });
});
