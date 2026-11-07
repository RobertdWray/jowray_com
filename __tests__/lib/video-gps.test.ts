import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { readVideoLocation, type VideoLocationLimits, type VideoLocationResult } from "@/lib/video-gps";

const LOCATION_KEY = "com.apple.quicktime.location.ISO6709";
const LOCATION = "+40.689247-074.044502/";
const LIBERTY = { latitude: 40.689247, longitude: -74.044502 };
const MIB = 1024 * 1024;

function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function box(type: string | number, ...parts: Uint8Array[]): Buffer {
  const payload = Buffer.concat(parts);
  return Buffer.concat([uint32(payload.length + 8), typeof type === "number" ? uint32(type) : Buffer.from(type, "latin1"), payload]);
}

function extendedBox(type: string, payload: Uint8Array): Buffer {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(payload.length + 16));
  return Buffer.concat([uint32(1), Buffer.from(type, "latin1"), length, payload]);
}

function text(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

function internationalText(value: string): Buffer {
  const bytes = text(value);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(bytes.length);
  return Buffer.concat([header, bytes]);
}

function data(value: Uint8Array, indicator = 1): Buffer {
  return box("data", uint32(indicator), uint32(0), value);
}

function xyz(value = LOCATION): Buffer {
  return box("udta", box("©xyz", internationalText(value)));
}

function mdta(value = LOCATION, options: {
  fullBox?: boolean;
  handler?: string;
  keys?: Array<{ name: string; namespace?: string }>;
  itemIndex?: number;
  indicator?: number;
} = {}): Buffer {
  const entries = (options.keys ?? [{ name: LOCATION_KEY }]).map(({ name, namespace = "mdta" }) => box(namespace, text(name)));
  return box("meta",
    ...(options.fullBox ? [uint32(0)] : []),
    box("hdlr", uint32(0), uint32(0), text(options.handler ?? "mdta"), Buffer.alloc(12)),
    box("keys", uint32(0), uint32(entries.length), ...entries),
    box("ilst", box(options.itemIndex ?? 1, data(text(value), options.indicator))),
  );
}

/** Real byte slices with a ledger: accidental media reads and exceeded budgets are observable. */
function reader(bytes: Uint8Array) {
  const ranges: Array<{ offset: number; length: number }> = [];
  return {
    ranges,
    bytesRead: () => ranges.reduce((total, range) => total + range.length, 0),
    read: async (offset: number, length: number) => {
      ranges.push({ offset, length });
      if (offset < 0 || length <= 0 || offset + length > bytes.length) {
        throw new Error("Parser requested a range outside the file");
      }
      return bytes.subarray(offset, offset + length);
    },
  };
}

async function parse(bytes: Uint8Array, limits?: Partial<VideoLocationLimits>) {
  return readVideoLocation(reader(bytes).read, bytes.length, limits);
}

function expectFound(result: VideoLocationResult, coordinates = LIBERTY) {
  expect(result.status).toBe("found");
  if (result.status === "found") {
    expect(result.coordinates.latitude).toBeCloseTo(coordinates.latitude, 8);
    expect(result.coordinates.longitude).toBeCloseTo(coordinates.longitude, 8);
    expect(Object.keys(result.coordinates).sort()).toEqual(["latitude", "longitude"]);
  }
}

function expectAbsent(result: VideoLocationResult, reason: RegExp) {
  expect(result).toEqual({ status: "absent", reason: expect.stringMatching(reason) });
}

describe("readVideoLocation fixtures", () => {
  it.each([
    { file: "location-mdta.mov", coordinates: { latitude: 40.6892, longitude: -74.0445 } },
    { file: "location-xyz.mp4", coordinates: LIBERTY },
  ])("reads $file within the default budgets", async ({ file, coordinates }) => {
    const bytes = await readFile(new URL(`../fixtures/${file}`, import.meta.url));
    const source = reader(bytes);
    expectFound(await readVideoLocation(source.read, bytes.length), coordinates);
    expect(source.ranges.length).toBeLessThanOrEqual(16);
    expect(source.bytesRead()).toBeLessThanOrEqual(16.5 * MIB);

    // These fixtures use 32-bit top-level sizes. Derive mdat bodies from their
    // headers so a new fixture cannot silently move media under a read range.
    let mediaBoxes = 0;
    for (let offset = 0; offset < bytes.length;) {
      const size = bytes.readUInt32BE(offset);
      expect(size).toBeGreaterThanOrEqual(8);
      expect(offset + size).toBeLessThanOrEqual(bytes.length);
      if (bytes.toString("latin1", offset + 4, offset + 8) === "mdat") {
        mediaBoxes += 1;
        expect(size).toBeGreaterThan(8);
        for (const range of source.ranges) {
          expect(range.offset + range.length <= offset + 8 || range.offset >= offset + size).toBe(true);
        }
      }
      offset += size;
    }
    expect(mediaBoxes).toBeGreaterThan(0);
  });

  it("decides absent for the fixture with no location", async () => {
    const bytes = await readFile(new URL("../fixtures/no-location.mov", import.meta.url));
    expectAbsent(await parse(bytes), /location/i);
  });
});

describe("box walk", () => {
  it("skips a large mdat and unrelated bodies, then reads moov in one call", async () => {
    const first = box("free", Buffer.alloc(512));
    const media = box("mdat", Buffer.alloc(4 * MIB));
    const movie = box("moov", mdta());
    const source = reader(Buffer.concat([first, media, movie]));
    const movieOffset = first.length + media.length;
    expectFound(await readVideoLocation(source.read, movieOffset + movie.length));
    expect(source.ranges).toEqual([
      { offset: 0, length: 8 },
      { offset: first.length, length: 8 },
      { offset: movieOffset, length: 8 },
      { offset: movieOffset, length: movie.length },
    ]);
    expect(source.bytesRead()).toBe(movie.length + 24);
  });

  it("does not read mdat when moov comes first", async () => {
    const movie = box("moov", xyz());
    const bytes = Buffer.concat([movie, box("mdat", Buffer.alloc(100))]);
    const source = reader(bytes);
    expectFound(await readVideoLocation(source.read, bytes.length));
    expect(source.ranges.every(({ offset, length }) => offset + length <= movie.length)).toBe(true);
  });

  it("reads 64-bit sizes for skipped boxes, moov and metadata children", async () => {
    const bytes = Buffer.concat([
      extendedBox("mdat", Buffer.alloc(30)),
      extendedBox("moov", extendedBox("udta", extendedBox("©xyz", internationalText(LOCATION)))),
    ]);
    expectFound(await parse(bytes));
  });

  it("skips an mdat larger than uint32 without reading its body", async () => {
    const mediaSize = 2 ** 32 + 32;
    const header = extendedBox("mdat", Buffer.alloc(0));
    header.writeBigUInt64BE(BigInt(mediaSize), 8);
    const movie = box("moov", xyz());
    const ranges: Array<[number, number]> = [];
    const read = async (offset: number, length: number) => {
      ranges.push([offset, length]);
      if (offset < 16 && offset + length <= 16) {
        return header.subarray(offset, offset + length);
      }
      if (offset === mediaSize) {
        return movie.subarray(0, length);
      }
      throw new Error("Read inside mdat");
    };
    expectFound(await readVideoLocation(read, mediaSize + movie.length));
    expect(ranges.filter(([offset]) => offset >= 16)).toEqual([[mediaSize, 8], [mediaSize, movie.length]]);
  });

  it("accepts size zero for moov and its final child through their enclosing end", async () => {
    const bytes = box("moov", xyz());
    bytes.writeUInt32BE(0, 0);
    bytes.writeUInt32BE(0, 8);
    expectFound(await parse(bytes));
  });

  it("accepts a QuickTime udta null terminator alongside a valid mdta location", async () => {
    expectFound(await parse(box("moov", mdta(), box("udta", box("©nam", internationalText("Title")), uint32(0)))));
  });

  it("accepts a QuickTime udta containing only its four-byte null terminator", async () => {
    expectFound(await parse(box("moov", mdta(), box("udta", uint32(0)))));
  });

  it.each([1, 2, 3, 4, 5, 6, 7])("accepts %s zero padding bytes after child boxes", async (length) => {
    const padding = Buffer.alloc(length);
    expectFound(await parse(box("moov", mdta(), padding)));
    expectFound(await parse(box("moov", box("udta", mdta(), padding))));
    const metadata = mdta();
    expectFound(await parse(box("moov", box("meta", metadata.subarray(8), padding))));
  });

  it.each([1, 2, 3, 4, 5, 6, 7])("rejects a nonzero %s-byte tail after child boxes", async (length) => {
    const padding = Buffer.alloc(length);
    padding[length - 1] = 1;
    expectAbsent(await parse(box("moov", mdta(), box("udta", box("©nam", internationalText("Title")), padding))), /malformed.*truncated box header/i);
  });

  it("does not interpret bytes inside a size-zero mdat as another top-level box", async () => {
    const bytes = box("mdat", box("moov", xyz()));
    bytes.writeUInt32BE(0);
    const source = reader(bytes);
    expectAbsent(await readVideoLocation(source.read, bytes.length), /moov/i);
    expect(source.ranges).toEqual([{ offset: 0, length: 8 }]);
  });

  it("reports no moov after skipping all top-level boxes", async () => {
    expectAbsent(await parse(box("free", Buffer.alloc(42))), /moov/i);
  });

  it.each([
    { name: "undersized header", bytes: Buffer.concat([uint32(4), text("moov")]) },
    { name: "truncated header", bytes: Buffer.from([0, 0, 0, 8]) },
    { name: "truncated extended header", bytes: Buffer.concat([uint32(1), text("moov")]) },
    { name: "undersized extended box", bytes: (() => { const b = extendedBox("moov", Buffer.alloc(0)); b.writeBigUInt64BE(BigInt(8), 8); return b; })() },
    { name: "box outside file", bytes: Buffer.concat([uint32(100), text("moov")]) },
    { name: "unsafe 64-bit size", bytes: (() => { const b = extendedBox("moov", Buffer.alloc(0)); b.writeBigUInt64BE(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1), 8); return b; })() },
    { name: "child outside parent", bytes: box("moov", uint32(99), text("udta")) },
    { name: "truncated child header", bytes: box("moov", Buffer.alloc(3)) },
  ])("treats $name as deterministic malformed data", async ({ bytes }) => {
    expectAbsent(await parse(bytes), /malformed|truncated|size/i);
  });

  it("reads Buffer subarrays with a nonzero backing offset", async () => {
    const movie = box("moov", mdta());
    const backing = Buffer.concat([Buffer.alloc(17), movie, Buffer.alloc(31)]);
    expectFound(await parse(backing.subarray(17, 17 + movie.length)));
  });
});

describe("metadata lookup", () => {
  it.each([false, true])("reads mdta in a meta container (FullBox=%s)", async (fullBox) => {
    expectFound(await parse(box("moov", mdta(LOCATION, { fullBox }))));
  });

  it("uses the 1-based key index among multiple keys", async () => {
    expectFound(await parse(box("moov", mdta(LOCATION, {
      keys: [{ name: "title" }, { name: LOCATION_KEY }, { name: "description" }], itemIndex: 2,
    }))));
  });

  it("does not treat a missing key as the location key", async () => {
    expectAbsent(await parse(box("moov", mdta(LOCATION, { itemIndex: 2 }))), /location|key/i);
  });

  it("requires the mdta namespace on the matching key", async () => {
    expectAbsent(await parse(box("moov", mdta(LOCATION, { keys: [{ name: LOCATION_KEY, namespace: "abcd" }] }))), /location|key/i);
  });

  it("prefers mdta over ©xyz regardless of child order", async () => {
    expectFound(await parse(box("moov", xyz("+10+020/"), mdta())));
  });

  it("reads the fixture's actual moov/udta/meta FullBox layout before ©xyz", async () => {
    expectFound(await parse(box("moov", xyz("+10+020/"), box("udta", mdta(LOCATION, { fullBox: true })))));
  });

  it("prefers direct moov/meta over udta/meta regardless of their order", async () => {
    expectFound(await parse(box("moov", box("udta", mdta("+10+020/")), mdta())));
  });

  it.each([
    mdta(LOCATION, { handler: "mdir" }),
    mdta(LOCATION, { keys: [{ name: "title" }] }),
    mdta(LOCATION, { itemIndex: 2 }),
  ])("falls back to ©xyz when mdta has no location value", async (metadata) => {
    expectFound(await parse(box("moov", metadata, xyz())));
  });

  it("does not replace an invalid preferred location with conflicting ©xyz", async () => {
    expectAbsent(await parse(box("moov", mdta("+91-074/"), xyz())), /range/i);
  });

  it.each([text(LOCATION), internationalText(LOCATION)])("reads ©xyz carried in a nested data box", async (value) => {
    expectFound(await parse(box("moov", box("udta", box("©xyz", data(value))))));
  });

  it("does not search unrelated containers for location metadata", async () => {
    expectAbsent(await parse(box("moov", box("trak", mdta(), xyz()))), /location/i);
  });

  it.each([false, true])("ignores malformed track descendants (metadata first=%s)", async (metadataFirst) => {
    const track = box("trak", box("edts", uint32(99), text("elst")));
    const children = metadataFirst ? [mdta(), track] : [track, mdta()];
    expectFound(await parse(box("moov", ...children)));
  });

  it("still validates direct moov child headers after a valid location", async () => {
    expectAbsent(await parse(box("moov", mdta(), uint32(99), text("trak"))), /malformed.*enclosing bounds/i);
  });

  it.each([false, true])("rejects malformed meta children alongside a valid location (inside udta=%s)", async (insideUdta) => {
    const metadata = mdta();
    const malformed = box("meta", metadata.subarray(8), uint32(99), text("free"));
    expectAbsent(await parse(box("moov", mdta(), insideUdta ? box("udta", malformed) : malformed)), /malformed.*enclosing bounds/i);
  });

  it("does not decode non-UTF8 mdta data as a coordinate string", async () => {
    expectAbsent(await parse(box("moov", mdta(LOCATION, { indicator: 21 }))), /encoding|type|UTF/i);
  });

  it.each([
    { name: "key size below its header", change: (b: Buffer) => b.writeUInt32BE(4, b.indexOf("keys") + 12) },
    { name: "key count above available entries", change: (b: Buffer) => b.writeUInt32BE(100, b.indexOf("keys") + 8) },
    { name: "key extends outside keys box", change: (b: Buffer) => b.writeUInt32BE(1000, b.indexOf("keys") + 12) },
    { name: "short handler", change: (b: Buffer) => b.writeUInt32BE(12, b.indexOf("hdlr") - 4) },
  ])("rejects malformed metadata: $name", async ({ change }) => {
    const bytes = box("moov", mdta());
    change(bytes);
    expectAbsent(await parse(bytes), /malformed|truncated/i);
  });

  it("rejects international text whose declared length exceeds its box", async () => {
    const bytes = box("moov", xyz());
    bytes.writeUInt16BE(1000, bytes.indexOf(Buffer.from("©xyz", "latin1")) + 4);
    expectAbsent(await parse(bytes), /malformed|truncated/i);
  });

  it("rejects a data box shorter than its type and locale", async () => {
    expectAbsent(await parse(box("moov", box("udta", box("©xyz", box("data", uint32(1)))))), /malformed|truncated/i);
  });
});

describe("ISO 6709 decimal degrees", () => {
  it.each([
    "+27.5916+086.5640+8850CRSWGS_84/",
    "+27.5916+086.5640+8850CRSWGS_84",
    "+27.5916+086.5640CRSWGS_84/",
    "+27.5916+086.5640CRSwgs_84",
  ])("parses an optional CRS suffix in %s", async (value) => {
    expectFound(await parse(box("moov", mdta(value))), { latitude: 27.5916, longitude: 86.564 });
    expectFound(await parse(box("moov", xyz(value))), { latitude: 27.5916, longitude: 86.564 });
  });

  it.each([
    "+27.5916+086.5640CRS/",
    "+27.5916+086.5640CRSWGS-84/",
    "+27.5916+086.5640CRSWGS 84/",
    "+27.5916+086.5640crsWGS_84/",
    "+27.5916+086.5640/CRSWGS_84",
    "+27.5916+086.5640CRSWGS_84/extra",
    "+27.5916+086.5640CRSWGS_84/\n",
  ])("rejects a malformed CRS suffix in %j", async (value) => {
    expectAbsent(await parse(box("moov", mdta(value))), /invalid ISO 6709/i);
  });

  it("still checks coordinate bounds when a CRS suffix is present", async () => {
    expectAbsent(await parse(box("moov", mdta("+91+086.5640CRSWGS_84/"))), /range/i);
  });

  it.each([
    { value: "+40.689247-074.044502+010.000/", expected: LIBERTY },
    { value: "+40.689247-074.044502-10", expected: LIBERTY },
    { value: "+40.689247-074.044502", expected: LIBERTY },
    { value: "+48.8388+2.3786/", expected: { latitude: 48.8388, longitude: 2.3786 } },
    { value: "-1.5+2.25/", expected: { latitude: -1.5, longitude: 2.25 } },
    { value: "+90+180/", expected: { latitude: 90, longitude: 180 } },
    { value: "-90-180/", expected: { latitude: -90, longitude: -180 } },
    { value: "+0+0/", expected: { latitude: 0, longitude: 0 } },
  ])("parses $value", async ({ value, expected }) => {
    expectFound(await parse(box("moov", mdta(value))), expected);
  });

  it.each(["+90.0001+000/", "-90.1+000/", "+10+180.0001/", "+10-180.1/"])("reports out-of-range %s", async (value) => {
    expectAbsent(await parse(box("moov", xyz(value))), /range/i);
  });

  it.each(["", "40.6892,-74.0445", "+4012-07401/", "+1e1+020/", "+NaN+020/", "+40-074/extra", "+40-074+bad/", "+40-074//", "+40-074/\n"])("rejects invalid decimal-degree text %j", async (value) => {
    expectAbsent(await parse(box("moov", mdta(value))), /ISO|location|coordinate/i);
  });
});

describe("structural budgets", () => {
  it("stops before a 17th read with default limits", async () => {
    const bytes = Buffer.concat([...Array.from({ length: 16 }, () => box("free")), box("moov", xyz())]);
    const source = reader(bytes);
    expectAbsent(await readVideoLocation(source.read, bytes.length), /read.*limit|maxReadCalls/i);
    expect(source.ranges).toHaveLength(16);
  });

  it("stops after 64 top-level boxes when the read budget is raised", async () => {
    const bytes = Buffer.concat([...Array.from({ length: 64 }, () => box("free")), box("moov", xyz())]);
    const source = reader(bytes);
    expectAbsent(await readVideoLocation(source.read, bytes.length, { maxReadCalls: 70 }), /top.level.*limit|maxTopLevelBoxes/i);
    expect(source.ranges).toHaveLength(64);
  });

  it("can read moov as the 64th top-level box within configured budgets", async () => {
    const bytes = Buffer.concat([...Array.from({ length: 63 }, () => box("free")), box("moov", xyz())]);
    expectFound(await parse(bytes, { maxReadCalls: 65 }));
  });

  it("accepts depth six, but rejects depth seven even alongside a location", async () => {
    let nested = box("free");
    for (let i = 0; i < 4; i += 1) {
      nested = box("udta", nested);
    }
    expectFound(await parse(box("moov", mdta(), nested)));
    expectAbsent(await parse(box("moov", mdta(), box("udta", nested))), /depth.*limit|maxDepth/i);
  });

  it("enforces a caller's smaller nesting limit on metadata data boxes", async () => {
    expectAbsent(await parse(box("moov", mdta()), { maxDepth: 4 }), /depth.*limit|maxDepth/i);
  });

  it("does not spend the depth budget on an unrelated track subtree", async () => {
    let nested = box("free");
    for (let i = 0; i < 6; i += 1) {
      nested = box("trak", nested);
    }
    expectFound(await parse(box("moov", mdta(), nested)));
  });

  it("does not fetch an oversized moov body", async () => {
    const bytes = box("moov", Buffer.alloc(16 * MIB));
    const source = reader(bytes);
    expectAbsent(await readVideoLocation(source.read, bytes.length), /moov.*limit|maxMoovBytes/i);
    expect(source.ranges).toEqual([{ offset: 0, length: 8 }]);
  });

  it("accepts moov exactly at 16 MiB", async () => {
    const metadata = mdta();
    const bytes = box("moov", metadata, box("free", Buffer.alloc(16 * MIB - 16 - metadata.length)));
    expectFound(await parse(bytes));
  });

  it("counts repeated header bytes against the total byte limit", async () => {
    const bytes = box("moov", xyz());
    const source = reader(bytes);
    expectAbsent(await readVideoLocation(source.read, bytes.length, { maxTotalBytes: bytes.length + 7 }), /total.*byte.*limit|maxTotalBytes/i);
    expect(source.ranges).toEqual([{ offset: 0, length: 8 }]);
    expectFound(await parse(bytes, { maxTotalBytes: bytes.length + 8 }));
  });

  it("enforces the default 16.5 MiB total even when the moov limit is raised", async () => {
    const bytes = box("moov", Buffer.alloc(16.5 * MIB));
    const source = reader(bytes);
    expectAbsent(await readVideoLocation(source.read, bytes.length, { maxMoovBytes: 17 * MIB }), /total.*byte.*limit|maxTotalBytes/i);
    expect(source.bytesRead()).toBe(8);
  });

  it.each([
    { maxTopLevelBoxes: 0 }, { maxDepth: 0 }, { maxReadCalls: 0 }, { maxMoovBytes: 0 }, { maxTotalBytes: 0 },
  ])("honours zero limits: %j", async (limits) => {
    expectAbsent(await parse(box("moov", xyz()), limits), /limit/i);
  });

  it.each([{ maxDepth: -1 }, { maxReadCalls: NaN }, { maxTotalBytes: Infinity }, { maxTopLevelBoxes: 0.5 }])("rejects invalid limits before reading: %j", async (limits) => {
    const bytes = box("moov", xyz());
    const source = reader(bytes);
    expectAbsent(await readVideoLocation(source.read, bytes.length, limits), /invalid.*limit|limit.*invalid/i);
    expect(source.ranges).toHaveLength(0);
  });
});

describe("read failures remain retryable", () => {
  it.each(["timeout", "abort", "range not honoured", "missing object", "network"])("preserves a thrown %s Error", async (message) => {
    const error = new Error(message);
    const result = await readVideoLocation(async () => { throw error; }, 100);
    expect(result).toEqual({ status: "failed", error });
    if (result.status === "failed") {
      expect(result.error).toBe(error);
    }
  });

  it("normalizes non-Error throws to Error without turning them into absence", async () => {
    const result = await readVideoLocation(async () => { throw "network failed"; }, 100);
    expect(result).toEqual({ status: "failed", error: expect.any(Error) });
  });

  it.each([1, 2])("treats a short read at call %s as failed", async (shortCall) => {
    const bytes = box("moov", xyz());
    let calls = 0;
    const result = await readVideoLocation(async (offset, length) => {
      calls += 1;
      return bytes.subarray(offset, offset + length - (calls === shortCall ? 1 : 0));
    }, bytes.length);
    expect(result).toEqual({ status: "failed", error: expect.objectContaining({ message: expect.stringMatching(/short read/i) }) });
  });

  it("treats an overlong read as a failed range contract", async () => {
    const bytes = box("moov", xyz());
    expect(await readVideoLocation(async () => bytes, bytes.length)).toEqual({ status: "failed", error: expect.any(Error) });
  });

  it("returns absent for an empty file without a read", async () => {
    const source = reader(Buffer.alloc(0));
    expectAbsent(await readVideoLocation(source.read, 0), /moov/i);
    expect(source.ranges).toHaveLength(0);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid file size %s before a read", async (size) => {
    const source = reader(Buffer.alloc(0));
    expectAbsent(await readVideoLocation(source.read, size), /size/i);
    expect(source.ranges).toHaveLength(0);
  });
});
