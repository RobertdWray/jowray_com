/**
 * Pure MOV/MP4 location reader. The caller owns I/O, range-response validation,
 * deadlines and logging. Only headers and the bounded moov box are requested.
 */
import { BoxFormatError, child, children, headerAt, moovRoot, readMoov, requirePayload, viewOf, type Box } from "@/lib/mp4-boxes";

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

/**
 * `absent` says whether the reader can vouch for it (TCR round 1, B1-1): `complete: true` only when the whole movie box
 * was parsed and no location key was met; `complete: false` when it stopped early (a structural limit, a malformed or
 * unsupported box, no movie box) or met a location value it could not use. Only a complete absence may let an original
 * play publicly (plan 2026-11-08 D16).
 */
export type VideoLocationResult =
  | { status: "found"; coordinates: { latitude: number; longitude: number } }
  | { status: "absent"; reason: string; complete: boolean }
  | { status: "failed"; error: Error };

/** An absence the reader cannot vouch for (`complete: false`). */
function unvouched(reason: string): VideoLocationResult {
  return { status: "absent", reason, complete: false };
}

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

// Walk only the movie root and location metadata containers. Track contents,
// sample descriptions and other unrelated payloads are opaque to this reader.
const CONTAINERS = new Set([MOOV, UDTA, ILST]);

/**
 * Deterministic parser decisions about location metadata use this private error class; box-structure and budget
 * decisions arrive as `BoxFormatError` from `lib/mp4-boxes.ts`. Both are absences the reader cannot vouch for.
 */
class AbsentLocation extends Error {}

/**
 * Never rejects. Deterministic format/limit decisions are absent (complete only
 * for a whole parse with no location key); read exceptions and incorrect byte
 * counts are failed so callers can retry rather than stamp absence.
 * Limits are overridable nonnegative safe integers; unspecified limits retain defaults.
 */
export async function readVideoLocation(
  read: (offset: number, length: number) => Promise<Uint8Array>,
  size: number,
  limits?: Partial<VideoLocationLimits>,
): Promise<VideoLocationResult> {
  try {
    // readMoov checks every limit here, maxDepth included, before its first read.
    const budget = { ...DEFAULT_LIMITS, ...limits };
    const bytes = await readMoov(read, size, budget, "video location");
    if (bytes === undefined) {
      // Every top-level box was walked and none was a movie box: nothing was parsed, so nothing is vouched for.
      return unvouched("No moov box");
    }
    return parseMovie(bytes, budget.maxDepth);
  } catch (error) {
    if (error instanceof AbsentLocation || error instanceof BoxFormatError) {
      return unvouched(error.message);
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
    return moovRoot(this.bytes);
  }

  children(parent: Box, start = parent.payload): Generator<Box> {
    return children(this.bytes, parent, start);
  }

  child(parent: Box, type: number, start = parent.payload): Box | undefined {
    return child(this.bytes, parent, type, start);
  }

  /** QuickTime meta is plain; ISO meta has a four-byte version/flags prefix. */
  metaStart(meta: Box): number {
    for (const start of [meta.payload, meta.payload + 4]) {
      if (meta.end - start < 8 || this.view.getUint32(start + 4) !== HDLR) {
        continue;
      }
      const handler = headerAt(this.view, start, meta.end);
      requirePayload(handler, 12, "hdlr");
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
    requirePayload(keys, 8, "keys");
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
    return item ? this.locationValue(item) : undefined;
  }

  xyzValue(xyz: Box): string | undefined {
    if (this.isNestedData(xyz)) {
      return this.locationValue(xyz, true);
    }
    return this.internationalText(xyz.payload, xyz.end);
  }

  private isNestedData(box: Box): boolean {
    return box.end - box.payload >= 8 && this.view.getUint32(box.payload + 4) === DATA;
  }

  private locationValue(item: Box, allowInternationalText = false): string | undefined {
    let hasData = false;
    for (const data of this.children(item)) {
      if (data.type !== DATA) {
        continue;
      }
      hasData = true;
      requirePayload(data, 8, "data");
      if (this.view.getUint32(data.payload) !== 1) {
        continue;
      }
      const start = data.payload + 8;
      // ©xyz writers use either UTF-8 directly or wrap its length/language text.
      if (allowInternationalText && start < data.end && this.bytes[start] !== 0x2b && this.bytes[start] !== 0x2d) {
        return this.internationalText(start, data.end);
      }
      return this.utf8(start, data.end);
    }
    if (hasData) {
      throw new AbsentLocation("Unsupported location data encoding: expected UTF-8 type 1");
    }
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
  // The one complete absence: the whole movie box was validated and walked, and no location key was met.
  return { status: "absent", reason: "No supported location metadata", complete: true };
}

function parseIso6709(value: string): VideoLocationResult {
  const match = /^([+-]\d{1,2}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?(?:CRS[A-Za-z0-9_]+)?\/?$/.exec(value);
  if (!match) {
    return unvouched("Invalid ISO 6709 location coordinates");
  }
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return unvouched("Location coordinates out of range");
  }
  if (latitude === 0 && longitude === 0) {
    return unvouched("Zero location coordinates");
  }
  return { status: "found", coordinates: { latitude, longitude } };
}
