/**
 * Pure ISO-BMFF (MP4) and QuickTime (MOV) box reading shared by the readers that look inside a movie box:
 * `lib/video-gps.ts` (location) and `lib/video-track.ts` (dimensions and transfer). The caller owns I/O, deadlines and
 * logging. Every deterministic format or budget decision throws `BoxFormatError`; read errors propagate as thrown.
 */

/** A box inside a byte buffer: its four-character type, where its payload starts and where it ends. */
export type Box = { type: number; payload: number; end: number };

/** A deterministic decision about the bytes or the budget (malformed, truncated, over a limit), never an I/O error. */
export class BoxFormatError extends Error {}

/** Budgets for the top-level walk that finds and reads the movie box. */
export interface MoovReadLimits {
  maxTopLevelBoxes: number;
  /** Includes extended headers and the whole moov read. */
  maxReadCalls: number;
  /** Includes moov's header. */
  maxMoovBytes: number;
  /** Repeated header bytes also count. */
  maxTotalBytes: number;
}

/** A ranged read of the file: exactly `length` bytes starting at `offset`. */
export type RangeRead = (offset: number, length: number) => Promise<Uint8Array>;

const MOOV = fourcc("moov");
const UDTA = fourcc("udta");

/** The 32-bit box type for a four-character code, e.g. `fourcc("moov")`. */
export function fourcc(code: string): number {
  if (code.length !== 4) {
    throw new RangeError(`A four-character code has four characters: ${code}`);
  }
  let value = 0;
  for (let index = 0; index < 4; index += 1) {
    value = value * 256 + (code.charCodeAt(index) & 0xff);
  }
  return value;
}

/** The four-character code of a box type, one Latin-1 character per byte. */
export function fourccName(type: number): string {
  return String.fromCharCode((type >>> 24) & 0xff, (type >>> 16) & 0xff, (type >>> 8) & 0xff, type & 0xff);
}

export function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** A bounded header; parentEnd may exceed view length for a ranged top-level header. */
export function headerAt(view: DataView, start: number, parentEnd: number): Box {
  if (parentEnd - start < 8 || view.byteLength - start < 8) {
    throw new BoxFormatError("Malformed video: truncated box header");
  }
  const shortSize = view.getUint32(start);
  let size = shortSize;
  let headerSize = 8;
  if (shortSize === 1) {
    headerSize = 16;
    if (parentEnd - start < 16 || view.byteLength - start < 16) {
      throw new BoxFormatError("Malformed video: truncated extended box header");
    }
    size = view.getUint32(start + 8) * 2 ** 32 + view.getUint32(start + 12);
    if (!Number.isSafeInteger(size)) {
      throw new BoxFormatError("Malformed video: box size exceeds safe integer range");
    }
  } else if (shortSize === 0) {
    size = parentEnd - start;
  }
  if (size < headerSize || size > parentEnd - start) {
    throw new BoxFormatError("Malformed video: box size is outside its enclosing bounds");
  }
  return { type: view.getUint32(start + 4), payload: start + headerSize, end: start + size };
}

/** The child boxes of `parent` from `start` (its payload by default), each header bounds-checked. */
export function* children(bytes: Uint8Array, parent: Box, start = parent.payload): Generator<Box> {
  const view = viewOf(bytes);
  const firstChildStart = start;
  while (start < parent.end) {
    const remaining = parent.end - start;
    // Padding follows child boxes; QTFF also allows an otherwise empty udta
    // to end with a four-byte zero terminator. A truncated first header fails.
    if (remaining < 8
      && (start > firstChildStart || (parent.type === UDTA && remaining === 4))
      && bytes.subarray(start, parent.end).every((byte) => byte === 0)) {
      return;
    }
    const child = headerAt(view, start, parent.end);
    yield child;
    start = child.end;
  }
}

/** The first child of `parent` with this type, or undefined. Headers before it are bounds-checked. */
export function child(bytes: Uint8Array, parent: Box, type: number, start = parent.payload): Box | undefined {
  for (const box of children(bytes, parent, start)) {
    if (box.type === type) {
      return box;
    }
  }
}

/** Requires `length` payload bytes before a fixed-layout field is read. */
export function requirePayload(box: Box, length: number, name: string): void {
  if (box.end - box.payload < length) {
    throw new BoxFormatError(`Malformed video: truncated ${name} payload`);
  }
}

/** The movie box at the start of `bytes` (as `readMoov` returns them), checked to span them exactly. */
export function moovRoot(bytes: Uint8Array): Box {
  const root = headerAt(viewOf(bytes), 0, bytes.length);
  if (root.type !== MOOV || root.end !== bytes.length) {
    throw new BoxFormatError("Malformed video: inconsistent moov header");
  }
  return root;
}

/**
 * Walks the top-level boxes by their headers, skipping every other body (mdat included), and reads the first moov
 * whole in one call. Returns undefined when every top-level box was walked and none was a movie box.
 *
 * Before the first read it checks every entry of `limits` (callers pass their whole budget, including limits for their
 * own walk, in one object) as a nonnegative safe integer, then `size`. `subject` names the caller's purpose in the
 * short-read error, e.g. "video location".
 */
export async function readMoov(
  read: RangeRead,
  size: number,
  limits: MoovReadLimits,
  subject: string,
): Promise<Uint8Array | undefined> {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new BoxFormatError(`Invalid ${name} limit`);
    }
  }
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new BoxFormatError("Invalid video file size");
  }

  let calls = 0;
  let bytesRead = 0;
  const range = async (offset: number, length: number): Promise<Uint8Array> => {
    if (calls >= limits.maxReadCalls) {
      throw new BoxFormatError("Read call limit (maxReadCalls) reached");
    }
    if (length > limits.maxTotalBytes - bytesRead) {
      throw new BoxFormatError("Total byte limit (maxTotalBytes) exceeded");
    }
    calls += 1;
    bytesRead += length;
    const bytes = await read(offset, length);
    if (bytes.byteLength < length) {
      throw new Error(`Short read while reading ${subject}`);
    }
    if (bytes.byteLength > length) {
      throw new Error("Video range read returned more bytes than requested");
    }
    return bytes;
  };

  let offset = 0;
  let boxes = 0;
  while (offset < size) {
    if (boxes >= limits.maxTopLevelBoxes) {
      throw new BoxFormatError("Top-level box limit (maxTopLevelBoxes) reached");
    }
    if (size - offset < 8) {
      throw new BoxFormatError("Malformed video: truncated top-level box header");
    }
    boxes += 1;
    let header = await range(offset, 8);
    if (viewOf(header).getUint32(0) === 1) {
      if (size - offset < 16) {
        throw new BoxFormatError("Malformed video: truncated extended box header");
      }
      const extended = new Uint8Array(16);
      extended.set(header);
      extended.set(await range(offset + 8, 8), 8);
      header = extended;
    }
    const box = headerAt(viewOf(header), 0, size - offset);
    if (box.type === MOOV) {
      if (box.end > limits.maxMoovBytes) {
        throw new BoxFormatError("moov byte limit (maxMoovBytes) exceeded");
      }
      return range(offset, box.end);
    }
    offset += box.end; // Skip every non-moov body, including mdat.
  }
  return undefined;
}
