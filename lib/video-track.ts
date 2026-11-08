/**
 * Pure MOV/MP4 video track reader: the codec, size and transfer characteristics of the first video track, from its
 * first sample description. The poster pipeline uses it to refuse oversized videos and to decide whether ffmpeg must
 * tone-map HDR (HLG or PQ) to SDR. The caller owns I/O, deadlines and logging; only headers and the bounded moov box
 * are requested (`lib/mp4-boxes.ts`).
 */
import {
  BoxFormatError, child, children, fourcc, fourccName, headerAt, moovRoot, readMoov, requirePayload, viewOf,
  type Box, type RangeRead,
} from "@/lib/mp4-boxes";

/** Budgets for the walk to the movie box; the track walk inside it is bounded by moov's size. */
export interface VideoTrackLimits {
  /** Defaults to 64. */
  maxTopLevelBoxes: number;
  /** Defaults to 16, including extended headers and the whole moov read. */
  maxReadCalls: number;
  /** Defaults to 16 MiB, including moov's header. */
  maxMoovBytes: number;
  /** Defaults to 16.5 MiB; repeated header bytes also count. */
  maxTotalBytes: number;
}

/** `unknown`: no `nclx`/`nclc` colr, or a code that is neither HDR nor a standard SDR curve. Callers treat it as SDR. */
export type TransferKind = "sdr" | "hlg" | "pq" | "unknown";

export interface VideoTrack {
  /** The sample entry's four-character code, e.g. `hvc1`, `hev1`, `avc1`. */
  codec: string;
  /** The sample entry's width and height in pixels, before any track rotation. */
  width: number;
  height: number;
  transferKind: TransferKind;
}

/** `absent`: no movie box, or no video track. `failed`: a malformed box, a budget overrun or a read error. */
export type VideoTrackResult =
  | { status: "found"; track: VideoTrack }
  | { status: "absent"; reason: string }
  | { status: "failed"; reason: string };

const DEFAULT_LIMITS: VideoTrackLimits = {
  maxTopLevelBoxes: 64,
  maxReadCalls: 16,
  maxMoovBytes: 16 * 1024 * 1024,
  maxTotalBytes: 16.5 * 1024 * 1024,
};

const TRAK = fourcc("trak");
const MDIA = fourcc("mdia");
const HDLR = fourcc("hdlr");
const MINF = fourcc("minf");
const STBL = fourcc("stbl");
const STSD = fourcc("stsd");
const COLR = fourcc("colr");
const NCLX = fourcc("nclx");
const NCLC = fourcc("nclc");
const VIDE = fourcc("vide");

/** VisualSampleEntry (ISO/IEC 14496-12) = QTFF video sample description: payload offsets after the 8-byte header. */
const WIDTH = 24;
const HEIGHT = 26;
const DEPTH = 74;
const COLOR_TABLE_ID = 76;
const EXTENSIONS = 78;

/** QTFF: these depths (the low five bits; +32 marks greyscale) are palettized. */
const PALETTE_DEPTHS = new Set([1, 2, 4, 8]);

/**
 * ITU-T H.273 TransferCharacteristics, the code points `nclx` (ISO/IEC 14496-12) and `nclc` (QTFF) share: 16 is
 * SMPTE ST 2084 (PQ) and 18 is ARIB STD-B67 (HLG). SDR is the display curves that need no tone mapping: BT.709 (1) and
 * its equivalents BT.601 (6) and BT.2020 (14, 15), the BT.470 gammas 2.2 and 2.8 (4, 5), SMPTE 240M (7), the
 * extended-gamut BT.709 curves xvYCC and BT.1361 (11, 12), and sRGB (13). Unspecified (2), linear (8), log (9, 10),
 * SMPTE ST 428 (17) and reserved codes are unknown.
 */
const SDR_TRANSFERS = new Set([1, 4, 5, 6, 7, 11, 12, 13, 14, 15]);

/**
 * Never rejects. Limits are overridable nonnegative safe integers; unspecified limits retain defaults. A read error's
 * message becomes the failed reason.
 */
export async function readVideoTrackInfo(
  read: RangeRead,
  size: number,
  limits?: Partial<VideoTrackLimits>,
): Promise<VideoTrackResult> {
  try {
    const bytes = await readMoov(read, size, { ...DEFAULT_LIMITS, ...limits }, "video track");
    if (bytes === undefined) {
      return { status: "absent", reason: "No moov box" };
    }
    const track = firstVideoTrack(bytes);
    return track === undefined ? { status: "absent", reason: "No video track" } : { status: "found", track };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "Video range read failed" };
  }
}

/**
 * The first track whose media handler is `vide`, which is the stream ffmpeg's `-map 0:v:0` selects. A track with no
 * media box or media handler has no type, so it is skipped, as ffmpeg does not count it as video either.
 */
function firstVideoTrack(bytes: Uint8Array): VideoTrack | undefined {
  const view = viewOf(bytes);
  for (const trak of children(bytes, moovRoot(bytes))) {
    if (trak.type !== TRAK) {
      continue;
    }
    const mdia = child(bytes, trak, MDIA);
    const handler = mdia && child(bytes, mdia, HDLR);
    if (mdia === undefined || handler === undefined) {
      continue;
    }
    // FullBox version/flags, pre_defined (QTFF: component type), then handler_type (QTFF: component subtype).
    requirePayload(handler, 12, "hdlr");
    if (view.getUint32(handler.payload + 8) === VIDE) {
      return firstSampleEntry(bytes, view, mdia);
    }
  }
  return undefined;
}

function firstSampleEntry(bytes: Uint8Array, view: DataView, mdia: Box): VideoTrack {
  const minf = child(bytes, mdia, MINF);
  const stbl = minf && child(bytes, minf, STBL);
  const stsd = stbl && child(bytes, stbl, STSD);
  if (stsd === undefined) {
    throw new BoxFormatError("Malformed video: video track has no stsd");
  }
  // FullBox version/flags, entry_count, then the sample entries.
  requirePayload(stsd, 8, "stsd");
  if (view.getUint32(stsd.payload + 4) === 0) {
    throw new BoxFormatError("Malformed video: stsd has no sample entry");
  }
  const entry = headerAt(view, stsd.payload + 8, stsd.end);
  requirePayload(entry, EXTENSIONS, "visual sample entry");
  return {
    codec: fourccName(entry.type),
    width: view.getUint16(entry.payload + WIDTH),
    height: view.getUint16(entry.payload + HEIGHT),
    transferKind: transferKindOf(bytes, view, entry),
  };
}

/** From the first `nclx` or `nclc` colr among the entry's extension boxes; ICC profiles (`prof`, `rICC`) carry no code. */
function transferKindOf(bytes: Uint8Array, view: DataView, entry: Box): TransferKind {
  let start = entry.payload + EXTENSIONS;
  // QTFF: a palettized depth with color table ID 0 embeds its color table before the extensions: seed (4 bytes),
  // flags (2), a zero-based color count (2), then that count + 1 colors of 8 bytes each.
  if (PALETTE_DEPTHS.has(view.getUint16(entry.payload + DEPTH) & 0x1f) && view.getInt16(entry.payload + COLOR_TABLE_ID) === 0) {
    if (entry.end - start < 8) {
      throw new BoxFormatError("Malformed video: truncated color table");
    }
    start += 8 + (view.getUint16(start + 6) + 1) * 8;
    if (start > entry.end) {
      throw new BoxFormatError("Malformed video: truncated color table");
    }
  }
  // QuickTime writers may end the extensions with a zero terminator, even when there are none.
  if (entry.end - start < 8 && bytes.subarray(start, entry.end).every((byte) => byte === 0)) {
    return "unknown";
  }
  for (const box of children(bytes, entry, start)) {
    if (box.type !== COLR) {
      continue;
    }
    requirePayload(box, 4, "colr");
    const colourType = view.getUint32(box.payload);
    if (colourType !== NCLX && colourType !== NCLC) {
      continue;
    }
    // colour_type, then u16 primaries, transfer characteristics and matrix; nclx adds a full-range byte.
    requirePayload(box, 10, "colr");
    return transferKind(view.getUint16(box.payload + 6));
  }
  return "unknown";
}

function transferKind(code: number): TransferKind {
  if (code === 16) {
    return "pq";
  }
  if (code === 18) {
    return "hlg";
  }
  return SDR_TRANSFERS.has(code) ? "sdr" : "unknown";
}
