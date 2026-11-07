/**
 * Pure MOV/MP4 location reader. The caller owns I/O, range-response validation,
 * deadlines and logging. Only headers and the bounded moov box are requested.
 */
export interface VideoLocationLimits {
  /** Defaults to 64. */
  maxTopLevelBoxes: number;
  /** Defaults to 6; moov is depth 1, including leaf boxes in the count. */
  maxDepth: number;
  /** Defaults to 16, including extended headers and the whole moov read. */
  maxReadCalls: number;
  /** Defaults to 16 MiB, including moov's header. */
  maxMoovBytes: number;
  /** Defaults to 16.5 MiB; repeated header bytes also count. */
  maxTotalBytes: number;
}

export type VideoLocationResult =
  | { status: "found"; coordinates: { latitude: number; longitude: number } }
  | { status: "absent"; reason: string }
  | { status: "failed"; error: Error };

const DEFAULT_LIMITS: VideoLocationLimits = {
  maxTopLevelBoxes: 64,
  maxDepth: 6,
  maxReadCalls: 16,
  maxMoovBytes: 16 * 1024 * 1024,
  maxTotalBytes: 16.5 * 1024 * 1024,
};

const MOOV = 0x6d6f6f76;
const META = 0x6d657461;
const HDLR = 0x68646c72;
const MDTA = 0x6d647461;
const KEYS = 0x6b657973;
const ILST = 0x696c7374;
const DATA = 0x64617461;
const UDTA = 0x75647461;
const XYZ = 0xa978797a;
const LOCATION_KEY = "com.apple.quicktime.location.ISO6709";

// Only known plain containers are walked. Sample descriptions, compressed data
// and other opaque payloads must never be mistaken for child box headers.
const CONTAINERS = new Set([
  MOOV,
  UDTA,
  ILST,
  0x7472616b, // trak
  0x6d646961, // mdia
  0x6d696e66, // minf
  0x7374626c, // stbl
  0x65647473, // edts
  0x64696e66, // dinf
]);

/** Only deterministic parser decisions use this private error class. */
class AbsentLocation extends Error {}

type Box = { type: number; payload: number; end: number };

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** A bounded header; parentEnd may exceed view length for a ranged top-level header. */
function headerAt(view: DataView, start: number, parentEnd: number): Box {
  if (parentEnd - start < 8 || view.byteLength - start < 8) {
    throw new AbsentLocation("Malformed video: truncated box header");
  }
  const shortSize = view.getUint32(start);
  let size = shortSize;
  let headerSize = 8;
  if (shortSize === 1) {
    headerSize = 16;
    if (parentEnd - start < 16 || view.byteLength - start < 16) {
      throw new AbsentLocation("Malformed video: truncated extended box header");
    }
    size = view.getUint32(start + 8) * 2 ** 32 + view.getUint32(start + 12);
    if (!Number.isSafeInteger(size)) {
      throw new AbsentLocation("Malformed video: box size exceeds safe integer range");
    }
  } else if (shortSize === 0) {
    size = parentEnd - start;
  }
  if (size < headerSize || size > parentEnd - start) {
    throw new AbsentLocation("Malformed video: box size is outside its enclosing bounds");
  }
  return { type: view.getUint32(start + 4), payload: start + headerSize, end: start + size };
}

/**
 * Never rejects. Deterministic format/limit decisions are absent; read exceptions
 * and incorrect byte counts are failed so callers can retry rather than stamp absence.
 * Limits are overridable nonnegative safe integers; unspecified limits retain defaults.
 */
export async function readVideoLocation(
  read: (offset: number, length: number) => Promise<Uint8Array>,
  size: number,
  limits?: Partial<VideoLocationLimits>,
): Promise<VideoLocationResult> {
  try {
    const budget = { ...DEFAULT_LIMITS, ...limits };
    for (const [name, value] of Object.entries(budget)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new AbsentLocation(`Invalid ${name} limit`);
      }
    }
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new AbsentLocation("Invalid video file size");
    }

    let calls = 0;
    let bytesRead = 0;
    const range = async (offset: number, length: number): Promise<Uint8Array> => {
      if (calls >= budget.maxReadCalls) {
        throw new AbsentLocation("Read call limit (maxReadCalls) reached");
      }
      if (length > budget.maxTotalBytes - bytesRead) {
        throw new AbsentLocation("Total byte limit (maxTotalBytes) exceeded");
      }
      calls += 1;
      bytesRead += length;
      const bytes = await read(offset, length);
      if (bytes.byteLength < length) {
        throw new Error("Short read while reading video location");
      }
      if (bytes.byteLength > length) {
        throw new Error("Video range read returned more bytes than requested");
      }
      return bytes;
    };

    let offset = 0;
    let boxes = 0;
    while (offset < size) {
      if (boxes >= budget.maxTopLevelBoxes) {
        throw new AbsentLocation("Top-level box limit (maxTopLevelBoxes) reached");
      }
      if (size - offset < 8) {
        throw new AbsentLocation("Malformed video: truncated top-level box header");
      }
      boxes += 1;
      let header = await range(offset, 8);
      if (viewOf(header).getUint32(0) === 1) {
        if (size - offset < 16) {
          throw new AbsentLocation("Malformed video: truncated extended box header");
        }
        const extended = new Uint8Array(16);
        extended.set(header);
        extended.set(await range(offset + 8, 8), 8);
        header = extended;
      }
      const box = headerAt(viewOf(header), 0, size - offset);
      if (box.type === MOOV) {
        if (box.end > budget.maxMoovBytes) {
          throw new AbsentLocation("moov byte limit (maxMoovBytes) exceeded");
        }
        const bytes = await range(offset, box.end);
        return parseMovie(bytes, budget.maxDepth);
      }
      offset += box.end; // Skip every non-moov body, including mdat.
    }
    return { status: "absent", reason: "No moov box" };
  } catch (error) {
    if (error instanceof AbsentLocation) {
      return { status: "absent", reason: error.message };
    }
    return {
      status: "failed",
      error: error instanceof Error ? error : new Error("Video location read failed", { cause: error }),
    };
  }
}

class Movie {
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array, private readonly maxDepth: number) {
    this.view = viewOf(bytes);
  }

  root(): Box {
    const root = headerAt(this.view, 0, this.bytes.length);
    if (root.type !== MOOV || root.end !== this.bytes.length) {
      throw new AbsentLocation("Malformed video: inconsistent moov header");
    }
    return root;
  }

  *children(parent: Box, start = parent.payload): Generator<Box> {
    while (start < parent.end) {
      const child = headerAt(this.view, start, parent.end);
      yield child;
      start = child.end;
    }
  }

  child(parent: Box, type: number, start = parent.payload): Box | undefined {
    for (const child of this.children(parent, start)) {
      if (child.type === type) {
        return child;
      }
    }
  }

  /** QuickTime meta is plain; ISO meta has a four-byte version/flags prefix. */
  metaStart(meta: Box): number {
    for (const start of [meta.payload, meta.payload + 4]) {
      if (meta.end - start < 8 || this.view.getUint32(start + 4) !== HDLR) {
        continue;
      }
      const handler = headerAt(this.view, start, meta.end);
      this.requireBytes(handler, 12, "hdlr");
      return start;
    }
    throw new AbsentLocation("Malformed video: meta has no valid hdlr header");
  }

  /** Validate the walked structure before choosing a value, including later siblings. */
  validate(box: Box, depth = 1, item = false): void {
    if (depth > this.maxDepth) {
      throw new AbsentLocation("Nesting depth limit (maxDepth) exceeded");
    }
    let start: number;
    if (box.type === META) {
      start = this.metaStart(box);
    } else if (item || CONTAINERS.has(box.type)) {
      start = box.payload;
    } else if (box.type === XYZ && this.isNestedData(box)) {
      start = box.payload;
    } else {
      return;
    }
    for (const child of this.children(box, start)) {
      this.validate(child, depth + 1, box.type === ILST);
    }
  }

  mdtaValue(meta: Box): string | undefined {
    const start = this.metaStart(meta);
    const handler = this.child(meta, HDLR, start);
    if (!handler || this.view.getUint32(handler.payload + 8) !== MDTA) {
      return;
    }
    const keys = this.child(meta, KEYS, start);
    const list = this.child(meta, ILST, start);
    if (!keys || !list) {
      return;
    }
    this.requireBytes(keys, 8, "keys");
    const count = this.view.getUint32(keys.payload + 4);
    let cursor = keys.payload + 8;
    let locationIndex: number | undefined;
    // A key entry is not a box: key_size is always uint32, with no 0/1 escape.
    if (count > Math.floor((keys.end - cursor) / 8)) {
      throw new AbsentLocation("Malformed video: truncated keys entries");
    }
    for (let index = 1; index <= count; index += 1) {
      if (keys.end - cursor < 8) {
        throw new AbsentLocation("Malformed video: truncated key header");
      }
      const length = this.view.getUint32(cursor);
      if (length < 8 || length > keys.end - cursor) {
        throw new AbsentLocation("Malformed video: key size outside keys box");
      }
      if (this.view.getUint32(cursor + 4) === MDTA && this.utf8(cursor + 8, cursor + length) === LOCATION_KEY) {
        locationIndex ??= index;
      }
      cursor += length;
    }
    if (cursor !== keys.end) {
      throw new AbsentLocation("Malformed video: keys count does not match entries");
    }
    if (locationIndex === undefined) {
      return;
    }
    const item = this.child(list, locationIndex);
    const data = item && this.child(item, DATA);
    return data ? this.dataValue(data) : undefined;
  }

  xyzValue(xyz: Box): string | undefined {
    if (this.isNestedData(xyz)) {
      const data = this.child(xyz, DATA);
      return data ? this.dataValue(data, true) : undefined;
    }
    return this.internationalText(xyz.payload, xyz.end);
  }

  private isNestedData(box: Box): boolean {
    return box.end - box.payload >= 8 && this.view.getUint32(box.payload + 4) === DATA;
  }

  private dataValue(data: Box, allowInternationalText = false): string {
    this.requireBytes(data, 8, "data");
    if (this.view.getUint32(data.payload) !== 1) {
      throw new AbsentLocation("Unsupported location data encoding: expected UTF-8 type 1");
    }
    const start = data.payload + 8;
    // ©xyz writers use either UTF-8 directly or wrap its length/language text.
    if (allowInternationalText && start < data.end && this.bytes[start] !== 0x2b && this.bytes[start] !== 0x2d) {
      return this.internationalText(start, data.end);
    }
    return this.utf8(start, data.end);
  }

  private internationalText(start: number, end: number): string {
    if (end - start < 4) {
      throw new AbsentLocation("Malformed video: truncated international text header");
    }
    const length = this.view.getUint16(start);
    if (length > end - start - 4) {
      throw new AbsentLocation("Malformed video: truncated international text");
    }
    return this.utf8(start + 4, start + 4 + length);
  }

  private requireBytes(box: Box, length: number, name: string): void {
    if (box.end - box.payload < length) {
      throw new AbsentLocation(`Malformed video: truncated ${name} payload`);
    }
  }

  private utf8(start: number, end: number): string {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(this.bytes.subarray(start, end));
    } catch {
      throw new AbsentLocation("Malformed video: invalid UTF-8 metadata");
    }
  }
}

function parseMovie(bytes: Uint8Array, maxDepth: number): VideoLocationResult {
  const movie = new Movie(bytes, maxDepth);
  const root = movie.root();
  movie.validate(root);
  for (const child of movie.children(root)) {
    if (child.type !== META) {
      continue;
    }
    const value = movie.mdtaValue(child);
    if (value !== undefined) {
      return parseIso6709(value);
    }
  }
  // ffmpeg's use_metadata_tags MOV fixture places the same mdta metadata inside
  // udta. Prefer direct moov/meta, then this layout, then the legacy ©xyz tag.
  for (const child of movie.children(root)) {
    if (child.type !== UDTA) {
      continue;
    }
    for (const metadata of movie.children(child)) {
      if (metadata.type !== META) {
        continue;
      }
      const value = movie.mdtaValue(metadata);
      if (value !== undefined) {
        return parseIso6709(value);
      }
    }
  }
  for (const child of movie.children(root)) {
    if (child.type !== UDTA) {
      continue;
    }
    const xyz = movie.child(child, XYZ);
    if (!xyz) {
      continue;
    }
    const value = movie.xyzValue(xyz);
    if (value !== undefined) {
      return parseIso6709(value);
    }
  }
  return { status: "absent", reason: "No supported location metadata" };
}

function parseIso6709(value: string): VideoLocationResult {
  // (?![\s\S]) is an absolute end assertion: `$` also permits a final newline.
  const match = /^([+-]\d{1,2}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?\/?(?![\s\S])/.exec(value);
  if (!match) {
    return { status: "absent", reason: "Invalid ISO 6709 location coordinates" };
  }
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return { status: "absent", reason: "Location coordinates out of range" };
  }
  return { status: "found", coordinates: { latitude, longitude } };
}
