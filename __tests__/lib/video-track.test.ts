import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { BoxFormatError } from "@/lib/mp4-boxes";
import { readVideoTrackInfo, type VideoTrackLimits, type VideoTrackResult } from "@/lib/video-track";

const MIB = 1024 * 1024;

function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function uint16(...values: number[]): Buffer {
  const bytes = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => bytes.writeUInt16BE(value, index * 2));
  return bytes;
}

function text(value: string): Buffer {
  return Buffer.from(value, "latin1");
}

function box(type: string, ...parts: Uint8Array[]): Buffer {
  const payload = Buffer.concat(parts);
  return Buffer.concat([uint32(payload.length + 8), text(type), payload]);
}

function extendedBox(type: string, ...parts: Uint8Array[]): Buffer {
  const payload = Buffer.concat(parts);
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(payload.length + 16));
  return Buffer.concat([uint32(1), text(type), length, payload]);
}

/** ISO/IEC 14496-12 hdlr: version/flags, pre_defined, handler_type, three reserved words, an empty name. */
function hdlr(handler: string): Buffer {
  return box("hdlr", uint32(0), uint32(0), text(handler), Buffer.alloc(13));
}

/** The 78 fixed bytes of a VisualSampleEntry (QTFF video sample description), then its extension boxes. */
function visualEntry(codec: string, options: {
  width?: number;
  height?: number;
  depth?: number;
  colorTableId?: number;
  extensions?: Uint8Array[];
} = {}): Buffer {
  const fixed = Buffer.alloc(78);
  fixed.writeUInt16BE(1, 6); // data_reference_index
  fixed.writeUInt16BE(options.width ?? 1920, 24);
  fixed.writeUInt16BE(options.height ?? 1080, 26);
  fixed.writeUInt32BE(0x00480000, 28); // 72 dpi
  fixed.writeUInt32BE(0x00480000, 32);
  fixed.writeUInt16BE(1, 40); // frame_count
  fixed.writeUInt16BE(options.depth ?? 0x18, 74);
  fixed.writeInt16BE(options.colorTableId ?? -1, 76);
  return box(codec, fixed, ...(options.extensions ?? []));
}

function nclx(transfer: number, primaries = 9, matrix = 9): Buffer {
  return box("colr", text("nclx"), uint16(primaries, transfer, matrix), Buffer.from([0]));
}

function nclc(transfer: number, primaries = 1, matrix = 1): Buffer {
  return box("colr", text("nclc"), uint16(primaries, transfer, matrix));
}

function stsd(...entries: Uint8Array[]): Buffer {
  return box("stsd", uint32(0), uint32(entries.length), ...entries);
}

/** trak → mdia (hdlr) → minf → stbl → the given stsd, with the sibling boxes real files carry. */
function track(handler: string, description: Uint8Array): Buffer {
  return box("trak",
    box("tkhd", Buffer.alloc(84)),
    box("mdia",
      box("mdhd", Buffer.alloc(24)),
      hdlr(handler),
      box("minf",
        box("vmhd", Buffer.alloc(12)),
        box("dinf", box("dref", uint32(0), uint32(0))),
        box("stbl", description, box("stts", uint32(0), uint32(0))),
      ),
    ),
  );
}

function videoTrack(entry: Uint8Array = visualEntry("hvc1")): Buffer {
  return track("vide", stsd(entry));
}

function movie(...tracks: Uint8Array[]): Buffer {
  return box("moov", box("mvhd", Buffer.alloc(100)), ...tracks);
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

async function parse(bytes: Uint8Array, limits?: Partial<VideoTrackLimits>): Promise<VideoTrackResult> {
  return readVideoTrackInfo(reader(bytes).read, bytes.length, limits);
}

async function fixture(name: string): Promise<Buffer> {
  return readFile(new URL(`../fixtures/${name}`, import.meta.url));
}

/** The colr payload ffmpeg actually wrote, read from the file's bytes rather than trusted from the recipe. */
function colrPayload(bytes: Buffer): string | undefined {
  const at = bytes.indexOf(text("colr"));
  if (at < 0) {
    return undefined;
  }
  return bytes.subarray(at + 4, at - 4 + bytes.readUInt32BE(at - 4)).toString("hex");
}

/** Every failure keeps what was thrown (R3a), and its reason is that error's message. */
function expectFailed(result: VideoTrackResult, reason: RegExp) {
  expect(result).toEqual({ status: "failed", reason: expect.stringMatching(reason), error: expect.any(Error) });
  if (result.status === "failed") {
    expect(result.error.message).toBe(result.reason);
  }
}

describe("readVideoTrackInfo fixtures", () => {
  it.each([
    {
      file: "track-sdr-nclc.mov",
      colr: "6e636c63" + "0001" + "0001" + "0001", // 'nclc', BT.709 primaries, transfer and matrix
      track: { codec: "avc1", width: 48, height: 32, transferKind: "sdr" },
    },
    {
      file: "track-hlg-nclx.mp4",
      colr: "6e636c78" + "0009" + "0012" + "0009" + "00", // 'nclx', BT.2020, transfer 18 (HLG), BT.2020nc, limited range
      track: { codec: "hvc1", width: 64, height: 36, transferKind: "hlg" },
    },
    {
      file: "track-hlg-nclc.mov",
      colr: "6e636c63" + "0009" + "0012" + "0009", // 'nclc', BT.2020, transfer 18 (HLG), BT.2020nc
      track: { codec: "hvc1", width: 64, height: 36, transferKind: "hlg" },
    },
    {
      file: "no-location.mov",
      colr: undefined,
      track: { codec: "avc1", width: 16, height: 16, transferKind: "unknown" },
    },
  ])("reads $file ($track.transferKind) within the default budgets", async ({ file, colr, track }) => {
    const bytes = await fixture(file);
    expect(colrPayload(bytes)).toBe(colr);
    const source = reader(bytes);
    expect(await readVideoTrackInfo(source.read, bytes.length)).toEqual({ status: "found", track });
    expect(source.ranges.length).toBeLessThanOrEqual(16);
    // These fixtures use 32-bit top-level sizes. The media body is never requested.
    let mediaBoxes = 0;
    for (let offset = 0; offset < bytes.length;) {
      const size = bytes.readUInt32BE(offset);
      if (bytes.toString("latin1", offset + 4, offset + 8) === "mdat") {
        mediaBoxes += 1;
        for (const range of source.ranges) {
          expect(range.offset + range.length <= offset + 8 || range.offset >= offset + size).toBe(true);
        }
      }
      offset += size;
    }
    expect(mediaBoxes).toBe(1);
  });

  it("reports an audio-only file as having no video track", async () => {
    const bytes = await fixture("audio-only.m4a");
    expect(bytes.includes(text("soun"))).toBe(true);
    expect(await parse(bytes)).toEqual({ status: "absent", reason: "No video track" });
  });

  it("fails when the sample entry is cut off inside a real stsd", async () => {
    const bytes = Buffer.from(await fixture("track-hlg-nclx.mp4"));
    const entry = bytes.indexOf(text("hvc1")) - 4;
    bytes.writeUInt32BE(bytes.readUInt32BE(entry) + 64, entry); // claims 64 bytes the stsd does not hold
    expectFailed(await parse(bytes), /malformed.*enclosing bounds/i);
  });
});

describe("transfer characteristics", () => {
  it.each([
    { transfer: 16, kind: "pq" },
    { transfer: 18, kind: "hlg" },
    ...[1, 4, 5, 6, 7, 11, 12, 13, 14, 15].map((transfer) => ({ transfer, kind: "sdr" })),
    ...[0, 2, 3, 8, 9, 10, 17, 19, 255, 65535].map((transfer) => ({ transfer, kind: "unknown" })),
  ])("maps transfer $transfer to $kind in nclx and nclc", async ({ transfer, kind }) => {
    for (const colr of [nclx(transfer), nclc(transfer)]) {
      const result = await parse(movie(videoTrack(visualEntry("hvc1", { extensions: [colr] }))));
      expect(result).toEqual({ status: "found", track: { codec: "hvc1", width: 1920, height: 1080, transferKind: kind } });
    }
  });

  it("reads colr wherever it sits among the extension boxes", async () => {
    const entry = visualEntry("hev1", { extensions: [box("hvcC", Buffer.alloc(23)), box("pasp", uint32(1), uint32(1)), nclx(16)] });
    expect(await parse(movie(videoTrack(entry)))).toEqual({
      status: "found", track: { codec: "hev1", width: 1920, height: 1080, transferKind: "pq" },
    });
  });

  it("skips ICC colr boxes and uses a later nclx", async () => {
    const icc = box("colr", text("prof"), Buffer.alloc(32));
    const restricted = box("colr", text("rICC"), Buffer.alloc(32));
    expect(await parse(movie(videoTrack(visualEntry("hvc1", { extensions: [icc, restricted, nclx(18)] }))))).toEqual({
      status: "found", track: { codec: "hvc1", width: 1920, height: 1080, transferKind: "hlg" },
    });
  });

  it("reports unknown when the only colr is an ICC profile", async () => {
    const icc = box("colr", text("prof"), Buffer.alloc(32));
    expect(await parse(movie(videoTrack(visualEntry("avc1", { extensions: [icc] }))))).toEqual({
      status: "found", track: { codec: "avc1", width: 1920, height: 1080, transferKind: "unknown" },
    });
  });

  it("uses the first nclx or nclc colr", async () => {
    const result = await parse(movie(videoTrack(visualEntry("hvc1", { extensions: [nclc(1), nclx(18)] }))));
    expect(result).toEqual({ status: "found", track: expect.objectContaining({ transferKind: "sdr" }) });
  });

  it("accepts a QuickTime four-byte zero terminator after the fixed fields", async () => {
    const result = await parse(movie(videoTrack(visualEntry("avc1", { extensions: [uint32(0)] }))));
    expect(result).toEqual({ status: "found", track: { codec: "avc1", width: 1920, height: 1080, transferKind: "unknown" } });
  });

  it("accepts zero padding after the extension boxes", async () => {
    const result = await parse(movie(videoTrack(visualEntry("avc1", { extensions: [nclc(1), Buffer.alloc(4)] }))));
    expect(result).toEqual({ status: "found", track: expect.objectContaining({ transferKind: "sdr" }) });
  });

  it("skips a QuickTime color table embedded in an 8-bit palettized entry", async () => {
    // seed 0, flags 0x8000, size 1 (zero-relative: two colors), then two eight-byte entries.
    const colorTable = Buffer.concat([uint32(0), uint16(0x8000, 1), Buffer.alloc(16, 0xff)]);
    const entry = visualEntry("rle ", { depth: 8, colorTableId: 0, extensions: [colorTable, nclc(1)] });
    expect(await parse(movie(videoTrack(entry)))).toEqual({
      status: "found", track: { codec: "rle ", width: 1920, height: 1080, transferKind: "sdr" },
    });
  });

  it("does not look for a color table when the depth has none", async () => {
    const entry = visualEntry("avc1", { depth: 24, colorTableId: 0, extensions: [nclc(1)] });
    expect(await parse(movie(videoTrack(entry)))).toEqual({ status: "found", track: expect.objectContaining({ transferKind: "sdr" }) });
  });
});

describe("track selection", () => {
  it("uses the first video track, the stream -map 0:v:0 selects, after sound and timecode tracks", async () => {
    const sound = track("soun", stsd(box("mp4a", Buffer.alloc(28))));
    const timecode = track("tmcd", stsd(box("tmcd", Buffer.alloc(26))));
    const first = videoTrack(visualEntry("hvc1", { width: 3840, height: 2160, extensions: [nclc(18, 9, 9)] }));
    const second = videoTrack(visualEntry("avc1", { width: 7680, height: 4320 }));
    expect(await parse(movie(sound, timecode, first, second))).toEqual({
      status: "found", track: { codec: "hvc1", width: 3840, height: 2160, transferKind: "hlg" },
    });
  });

  it("uses the first sample entry of the video track", async () => {
    const description = stsd(visualEntry("avc1", { width: 1280, height: 720 }), visualEntry("hvc1", { width: 7680, height: 4320 }));
    expect(await parse(movie(track("vide", description)))).toEqual({
      status: "found", track: { codec: "avc1", width: 1280, height: 720, transferKind: "unknown" },
    });
  });

  it("skips tracks without a media box or media handler", async () => {
    const noMedia = box("trak", box("tkhd", Buffer.alloc(84)));
    const noHandler = box("trak", box("mdia", box("mdhd", Buffer.alloc(24))));
    expect(await parse(movie(noMedia, noHandler, videoTrack()))).toEqual({
      status: "found", track: { codec: "hvc1", width: 1920, height: 1080, transferKind: "unknown" },
    });
  });

  it("reports no video track for a movie with only other tracks", async () => {
    expect(await parse(movie(track("soun", stsd(box("mp4a", Buffer.alloc(28))))))).toEqual({ status: "absent", reason: "No video track" });
    expect(await parse(movie())).toEqual({ status: "absent", reason: "No video track" });
  });

  it("reads 64-bit box sizes on the path to the sample entry", async () => {
    const entry = visualEntry("hvc1", { width: 640, height: 480, extensions: [nclx(16)] });
    const bytes = Buffer.concat([
      extendedBox("mdat", Buffer.alloc(32)),
      extendedBox("moov", extendedBox("trak", extendedBox("mdia", hdlr("vide"), extendedBox("minf", extendedBox("stbl", stsd(entry)))))),
    ]);
    expect(await parse(bytes)).toEqual({ status: "found", track: { codec: "hvc1", width: 640, height: 480, transferKind: "pq" } });
  });
});

describe("truncated or malformed sample descriptions fail", () => {
  it.each([
    {
      name: "stsd shorter than its version and entry count",
      description: box("stsd", uint32(0)),
      reason: /malformed.*truncated stsd payload/i,
    },
    {
      name: "stsd with no sample entry",
      description: stsd(),
      reason: /malformed.*no sample entry/i,
    },
    {
      name: "stsd whose entry count promises a missing entry",
      description: box("stsd", uint32(0), uint32(1)),
      reason: /malformed.*truncated box header/i,
    },
    {
      name: "sample entry shorter than the visual fields",
      description: stsd(box("hvc1", Buffer.alloc(40))),
      reason: /malformed.*truncated visual sample entry payload/i,
    },
    {
      name: "sample entry larger than its stsd",
      description: box("stsd", uint32(0), uint32(1), uint32(200), text("hvc1"), Buffer.alloc(78)),
      reason: /malformed.*enclosing bounds/i,
    },
    {
      name: "colr shorter than its three indexes",
      description: stsd(visualEntry("hvc1", { extensions: [box("colr", text("nclx"), uint16(9, 18))] })),
      reason: /malformed.*truncated colr payload/i,
    },
    {
      name: "colr shorter than its colour type",
      description: stsd(visualEntry("hvc1", { extensions: [box("colr", uint16(1))] })),
      reason: /malformed.*truncated colr payload/i,
    },
    {
      name: "extension box outside its sample entry",
      description: stsd(visualEntry("hvc1", { extensions: [uint32(99), text("colr")] })),
      reason: /malformed.*enclosing bounds/i,
    },
    {
      name: "color table longer than its sample entry",
      description: stsd(visualEntry("rle ", { depth: 8, colorTableId: 0, extensions: [uint32(0), uint16(0x8000, 255)] })),
      reason: /malformed.*truncated color table/i,
    },
  ])("$name", async ({ description, reason }) => {
    expectFailed(await parse(movie(track("vide", description))), reason);
  });

  it("fails a video track with no sample table", async () => {
    const trak = box("trak", box("mdia", hdlr("vide"), box("minf", box("vmhd", Buffer.alloc(12)))));
    expectFailed(await parse(movie(trak)), /malformed.*video track has no stsd/i);
  });

  it("fails a video track whose handler is cut short", async () => {
    const trak = box("trak", box("mdia", box("hdlr", uint32(0), uint32(0))));
    expectFailed(await parse(movie(trak)), /malformed.*truncated hdlr payload/i);
  });

  it("fails on a malformed track child header", async () => {
    expectFailed(await parse(movie(box("trak", uint32(99), text("mdia")))), /malformed.*enclosing bounds/i);
  });
});

describe("movie box walk and budgets", () => {
  it("reports no moov box as absent", async () => {
    expect(await parse(box("free", Buffer.alloc(16)))).toEqual({ status: "absent", reason: "No moov box" });
  });

  it("reports an empty file as absent without reading", async () => {
    const source = reader(Buffer.alloc(0));
    expect(await readVideoTrackInfo(source.read, 0)).toEqual({ status: "absent", reason: "No moov box" });
    expect(source.ranges).toHaveLength(0);
  });

  it("skips a large mdat and reads moov in one call", async () => {
    const media = box("mdat", Buffer.alloc(4 * MIB));
    const moov = movie(videoTrack());
    const source = reader(Buffer.concat([media, moov]));
    expect((await readVideoTrackInfo(source.read, media.length + moov.length)).status).toBe("found");
    expect(source.ranges).toEqual([
      { offset: 0, length: 8 },
      { offset: media.length, length: 8 },
      { offset: media.length, length: moov.length },
    ]);
  });

  it("fails without fetching an oversized moov body", async () => {
    const bytes = box("moov", Buffer.alloc(16 * MIB));
    const source = reader(bytes);
    expectFailed(await readVideoTrackInfo(source.read, bytes.length), /maxMoovBytes/);
    expect(source.ranges).toEqual([{ offset: 0, length: 8 }]);
  });

  it("fails before a 17th read with default limits", async () => {
    const bytes = Buffer.concat([...Array.from({ length: 16 }, () => box("free")), movie(videoTrack())]);
    const source = reader(bytes);
    expectFailed(await readVideoTrackInfo(source.read, bytes.length), /maxReadCalls/);
    expect(source.ranges).toHaveLength(16);
  });

  it("fails after the top-level box limit", async () => {
    const bytes = Buffer.concat([box("free"), box("free"), movie(videoTrack())]);
    expectFailed(await parse(bytes, { maxTopLevelBoxes: 2 }), /maxTopLevelBoxes/);
  });

  it("counts header bytes against the total byte limit", async () => {
    const bytes = movie(videoTrack());
    expectFailed(await parse(bytes, { maxTotalBytes: bytes.length + 7 }), /maxTotalBytes/);
    expect((await parse(bytes, { maxTotalBytes: bytes.length + 8 })).status).toBe("found");
  });

  it.each([{ maxReadCalls: -1 }, { maxMoovBytes: NaN }, { maxTotalBytes: Infinity }, { maxTopLevelBoxes: 0.5 }])("fails invalid limits before reading: %j", async (limits) => {
    const bytes = movie(videoTrack());
    const source = reader(bytes);
    expectFailed(await readVideoTrackInfo(source.read, bytes.length, limits), /invalid.*limit/i);
    expect(source.ranges).toHaveLength(0);
  });

  it.each([-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1])("fails an invalid file size %s before reading", async (size) => {
    const source = reader(Buffer.alloc(0));
    expectFailed(await readVideoTrackInfo(source.read, size), /invalid video file size/i);
    expect(source.ranges).toHaveLength(0);
  });

  it("fails a moov that runs past the end of the file", async () => {
    const bytes = movie(videoTrack());
    expectFailed(await readVideoTrackInfo(reader(bytes).read, bytes.length - 1), /malformed.*enclosing bounds/i);
  });
});

describe("read failures resolve as failed", () => {
  it("keeps the original Error instance when a read rejects", async () => {
    const error = new Error("network down");
    const result = await readVideoTrackInfo(async () => { throw error; }, 100);
    expect(result).toEqual({ status: "failed", reason: "network down", error });
    if (result.status === "failed") {
      expect(result.error).toBe(error);
    }
  });

  it("wraps a non-Error throw in an Error and keeps the value as its cause", async () => {
    const thrown = { code: "ECONNRESET" };
    const result = await readVideoTrackInfo(async () => { throw thrown; }, 100);
    expect(result).toEqual({ status: "failed", reason: "Video track read failed", error: expect.any(Error) });
    if (result.status === "failed") {
      expect(result.error.message).toBe("Video track read failed");
      expect(result.error.cause).toBe(thrown);
    }
  });

  it("carries the format error itself, whose message is the reason", async () => {
    const result = await parse(movie(track("vide", box("stsd", uint32(0)))));
    expect(result).toEqual({ status: "failed", reason: "Malformed video: truncated stsd payload", error: expect.any(BoxFormatError) });
    if (result.status === "failed") {
      expect(result.error).toBeInstanceOf(BoxFormatError);
      expect(result.error.message).toBe(result.reason);
    }
  });

  it("resolves a short read as failed", async () => {
    const bytes = movie(videoTrack());
    const result = await readVideoTrackInfo(async (offset, length) => bytes.subarray(offset, offset + length - 1), bytes.length);
    expectFailed(result, /short read/i);
  });

  it("resolves an overlong read as failed", async () => {
    const bytes = movie(videoTrack());
    expectFailed(await readVideoTrackInfo(async () => bytes, bytes.length), /more bytes than requested/i);
  });
});
