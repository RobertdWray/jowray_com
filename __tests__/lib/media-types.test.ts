import { describe, expect, it } from "vitest";

import {
  ACCEPT_ATTRIBUTE,
  ALLOWED_MIME_TYPES,
  detectMediaType,
  extensionFor,
  isAllowedMime,
  isRenderableIn,
  matchesSignature,
  MAX_FILES_PER_MEMORY,
  maxBytesFor,
  memoryTypeFor,
  normalizeMime,
  SIGNATURE_PREFIX_BYTES,
  summarizeMemoryType,
} from "@/lib/media-types";

import { ALSO_VALID, atom, ftyp, ftypLarge, MP3_FRAME_SYNC, NOT_MEDIA, REAL_BUT_NOT_ALLOWED, SIGNATURE_SAMPLES } from "../fixtures/signatures";

describe("normalizeMime", () => {
  it("strips parameters and lower-cases", () => {
    expect(normalizeMime("audio/webm;codecs=opus", "clip.webm")).toBe("audio/webm");
    expect(normalizeMime("Image/JPEG", "a.jpg")).toBe("image/jpeg");
  });

  it("maps an empty browser type from the extension", () => {
    expect(normalizeMime("", "IMG_0001.HEIC")).toBe("image/heic");
    expect(normalizeMime("", "clip.mov")).toBe("video/quicktime");
    expect(normalizeMime("", "voice.m4a")).toBe("audio/x-m4a");
    expect(normalizeMime("", "x.mp4")).toBe("video/mp4");
  });

  it("returns null when nothing usable is known", () => {
    expect(normalizeMime("", "notes.txt")).toBeNull();
    expect(normalizeMime("application/octet-stream", "blob")).toBeNull();
  });
});

describe("allowlist and limits", () => {
  it("allows the iPhone defaults and rejects svg/html", () => {
    for (const m of ["image/heic", "video/quicktime", "audio/mp4", "image/jpeg", "audio/webm"]) {
      expect(isAllowedMime(m)).toBe(true);
    }
    expect(isAllowedMime("image/svg+xml")).toBe(false);
    expect(isAllowedMime("text/html")).toBe(false);
  });

  it("caps sizes per type", () => {
    expect(maxBytesFor("image/png")).toBe(25 * 1024 * 1024);
    expect(maxBytesFor("audio/mpeg")).toBe(100 * 1024 * 1024);
    expect(maxBytesFor("video/webm")).toBe(500 * 1024 * 1024);
  });

  it("maps MIME to memory type and extension", () => {
    expect(memoryTypeFor("image/heic")).toBe("PHOTO");
    expect(memoryTypeFor("audio/mp4")).toBe("VOICE");
    expect(memoryTypeFor("video/mp4")).toBe("VIDEO");
    expect(extensionFor("audio/webm")).toBe("webm");
    expect(extensionFor("video/quicktime")).toBe("mov");
    expect(extensionFor("image/jpeg")).toBe("jpg");
  });

  it("exposes an accept attribute built from the allowlist", () => {
    expect(ACCEPT_ATTRIBUTE).toContain("image/heic");
    expect(ACCEPT_ATTRIBUTE).toContain(".heic");
    expect(ACCEPT_ATTRIBUTE).not.toContain("svg");
  });
});

describe("isRenderableIn", () => {
  const safari =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1";
  const chrome =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

  it("HEIC renders only in Safari", () => {
    expect(isRenderableIn("image/heic", safari)).toBe(true);
    expect(isRenderableIn("image/heic", chrome)).toBe(false);
    expect(isRenderableIn("image/heic", null)).toBe(false);
  });

  it("common types render everywhere", () => {
    expect(isRenderableIn("image/jpeg", chrome)).toBe(true);
    expect(isRenderableIn("video/mp4", null)).toBe(true);
  });
});

describe("prototype-safe lookups", () => {
  it("never resolves inherited object properties as media types", () => {
    expect(normalizeMime("", "x.__proto__")).toBeNull();
    expect(normalizeMime("", "x.constructor")).toBeNull();
    expect(normalizeMime("constructor", "x")).toBeNull();
    expect(isAllowedMime("__proto__")).toBe(false);
    expect(() => maxBytesFor("constructor")).toThrow(/Unsupported/);
  });
});

describe("summarizeMemoryType", () => {
  it("exports the per-memory file cap for validation to import without reaching into features/", () => {
    expect(MAX_FILES_PER_MEMORY).toBe(10);
  });

  it("ranks live media VIDEO over VOICE over PHOTO", () => {
    expect(summarizeMemoryType([{ mimeType: "image/jpeg" }, { mimeType: "audio/mp4" }], false)).toBe("VOICE");
    expect(summarizeMemoryType([{ mimeType: "audio/mp4" }, { mimeType: "video/quicktime" }, { mimeType: "image/heic" }], true)).toBe("VIDEO");
    expect(summarizeMemoryType([{ mimeType: "image/png" }], false)).toBe("PHOTO");
  });

  it("is TEXT when no live media remains but words do, and null when neither does", () => {
    expect(summarizeMemoryType([], true)).toBe("TEXT");
    expect(summarizeMemoryType([], false)).toBeNull();
  });

  it("ignores media whose type is not on the allowlist", () => {
    expect(summarizeMemoryType([{ mimeType: "text/html" }], true)).toBe("TEXT");
  });
});

describe("matchesSignature (issue #45: bytes, not labels, decide what becomes READY)", () => {
  it("has a sample for every allowed type and accepts each one under its own label", () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      expect(SIGNATURE_SAMPLES[mime], mime).toBeDefined();
      expect(matchesSignature(mime, SIGNATURE_SAMPLES[mime]!), mime).toBe(true);
    }
  });

  it("rejects things that are not media under every label", () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      for (const [name, sample] of Object.entries(NOT_MEDIA)) {
        expect(matchesSignature(mime, sample), `${name} as ${mime}`).toBe(false);
      }
    }
  });

  it("rejects a file of one family labelled as another (PNG as JPEG, JPEG as MP4, MP4 as HEIC, WAV as MP3, OGG as WebM)", () => {
    expect(matchesSignature("image/jpeg", SIGNATURE_SAMPLES["image/png"]!)).toBe(false);
    expect(matchesSignature("video/mp4", SIGNATURE_SAMPLES["image/jpeg"]!)).toBe(false);
    expect(matchesSignature("image/heic", SIGNATURE_SAMPLES["video/mp4"]!)).toBe(false);
    expect(matchesSignature("audio/mpeg", SIGNATURE_SAMPLES["audio/wav"]!)).toBe(false);
    expect(matchesSignature("audio/webm", SIGNATURE_SAMPLES["audio/ogg"]!)).toBe(false);
    expect(matchesSignature("image/webp", SIGNATURE_SAMPLES["audio/wav"]!)).toBe(false);
  });

  it("keeps the ISO BMFF families broad on purpose: any ftyp brand passes for mp4/mov/m4a, HEIF needs a HEIF brand", () => {
    // Real device files carry brands we cannot enumerate (Safari recordings, Voice Memos, Android exports); a
    // false rejection costs the family a memory, so the container is what we check for these.
    for (const mime of ["video/mp4", "video/quicktime", "audio/mp4", "audio/x-m4a"]) {
      expect(matchesSignature(mime, ftyp("mp42", ["isom"])), mime).toBe(true);
      expect(matchesSignature(mime, ftyp("qt  ")), mime).toBe(true);
      expect(matchesSignature(mime, ftyp("M4A ", ["mp42", "isom"])), mime).toBe(true);
      expect(matchesSignature(mime, ftyp("3gp5")), mime).toBe(true);
    }
    expect(matchesSignature("image/heic", ftyp("mif1", ["heic"]))).toBe(true);
    expect(matchesSignature("image/heic", ftyp("isom", ["mp42"]))).toBe(false);
    expect(matchesSignature("image/heif", ftyp("msf1", ["hevc"]))).toBe(true);
  });

  it("accepts an MP3 that starts with a frame sync instead of an ID3 tag, after zero padding, or behind an APEv2 tag", () => {
    expect(matchesSignature("audio/mpeg", MP3_FRAME_SYNC)).toBe(true);
    expect(matchesSignature("audio/mpeg", ALSO_VALID.mp3_zero_padded!)).toBe(true);
    expect(matchesSignature("audio/mpeg", ALSO_VALID.mp3_ape_tag!)).toBe(true);
    expect(matchesSignature("audio/mpeg", ALSO_VALID.mp3_mpeg2_layer3!)).toBe(true);
    // Eleven sync bits are not enough on their own: a reserved version or layer is no frame.
    expect(matchesSignature("audio/mpeg", Uint8Array.from([0xff, 0x00, 0x90]))).toBe(false);
    expect(matchesSignature("audio/mpeg", Uint8Array.from([0xff, 0xe8, 0x90]))).toBe(false); // version bits 01 (reserved)
    expect(matchesSignature("audio/mpeg", Uint8Array.from([0xff, 0xf9, 0x90]))).toBe(false); // layer bits 00 (reserved)
    expect(matchesSignature("audio/mpeg", NOT_MEDIA.zeros!)).toBe(false);
  });

  it("accepts RF64 and BW64 WAV files", () => {
    expect(matchesSignature("audio/wav", ALSO_VALID.wav_rf64!)).toBe(true);
    expect(matchesSignature("audio/wav", ALSO_VALID.wav_bw64!)).toBe(true);
  });

  it("does not recognise real formats outside the allowlist under any label (they are kept, not served)", () => {
    for (const [name, sample] of Object.entries(REAL_BUT_NOT_ALLOWED)) {
      for (const mime of ALLOWED_MIME_TYPES) {
        expect(matchesSignature(mime, sample), `${name} as ${mime}`).toBe(false);
      }
      expect(detectMediaType("audio/wav", sample), name).toBeNull();
      expect(detectMediaType("image/jpeg", sample), name).toBeNull();
    }
  });

  it("never throws on short input and needs no more than the documented prefix", () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      expect(matchesSignature(mime, new Uint8Array(3))).toBe(false);
      expect(matchesSignature(mime, SIGNATURE_SAMPLES[mime]!.slice(0, SIGNATURE_PREFIX_BYTES))).toBe(true);
    }
    expect(matchesSignature("application/pdf", NOT_MEDIA.pdf!)).toBe(false);
  });

  it("accepts QuickTime and MP4 files that do not start with ftyp (moov, mdat, wide, free, skip, pnot), and 0 / 64-bit atom sizes", () => {
    // QTFF makes ftyp optional; camcorder imports and old QuickTime exports start with moov or wide+mdat.
    for (const mime of ["video/quicktime", "video/mp4", "audio/mp4", "audio/x-m4a"]) {
      for (const type of ["moov", "mdat", "wide", "free", "skip", "pnot"]) {
        expect(matchesSignature(mime, atom(type)), `${type} as ${mime}`).toBe(true);
      }
      expect(matchesSignature(mime, atom("mdat", 0)), `to-EOF mdat as ${mime}`).toBe(true);
      expect(matchesSignature(mime, atom("mdat", 1)), `64-bit mdat as ${mime}`).toBe(true);
      expect(matchesSignature(mime, ftypLarge("qt  ", ["qt  "])), `largesize ftyp as ${mime}`).toBe(true);
      // Not an atom: a plausible size with an unknown type, or a size under the 8-byte header.
      expect(matchesSignature(mime, atom("abcd")), `unknown atom as ${mime}`).toBe(false);
      expect(matchesSignature(mime, atom("moov", 4)), `short atom as ${mime}`).toBe(false);
    }
    // HEIF still needs its brand, read correctly after a 64-bit size too.
    expect(matchesSignature("image/heic", ftypLarge("heic", ["mif1"]))).toBe(true);
    expect(matchesSignature("image/heic", atom("moov"))).toBe(false);
  });
});

describe("detectMediaType (issue #45: a mislabelled file of an allowed type is relabelled, never destroyed)", () => {
  it("keeps the declared type when the bytes agree", () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      expect(detectMediaType(mime, SIGNATURE_SAMPLES[mime]!), mime).toBe(mime);
    }
    // An ISO BMFF label stays as declared even though the container alone cannot tell mp4 from mov from m4a.
    expect(detectMediaType("video/quicktime", ftyp("isom", ["mp42"]))).toBe("video/quicktime");
  });

  it("relabels to the type the bytes are, when that type is allowed and of the same kind", () => {
    expect(detectMediaType("image/heic", SIGNATURE_SAMPLES["image/jpeg"]!)).toBe("image/jpeg"); // JPEG saved as .heic
    expect(detectMediaType("image/jpeg", SIGNATURE_SAMPLES["image/heic"]!)).toBe("image/heic"); // HEIC named .jpg
    expect(detectMediaType("image/jpeg", SIGNATURE_SAMPLES["image/webp"]!)).toBe("image/webp"); // WebP saved as .jpg
    expect(detectMediaType("image/png", SIGNATURE_SAMPLES["image/gif"]!)).toBe("image/gif");
    expect(detectMediaType("audio/mpeg", SIGNATURE_SAMPLES["audio/x-m4a"]!)).toBe("audio/mp4"); // Voice Memo named .mp3
    expect(detectMediaType("audio/wav", SIGNATURE_SAMPLES["audio/ogg"]!)).toBe("audio/ogg");
    expect(detectMediaType("video/mp4", SIGNATURE_SAMPLES["video/webm"]!)).toBe("video/webm");
    expect(detectMediaType("video/webm", SIGNATURE_SAMPLES["video/quicktime"]!)).toBe("video/mp4");
  });

  it("answers null across kinds, for non-media and for an unknown declared type", () => {
    expect(detectMediaType("image/jpeg", SIGNATURE_SAMPLES["video/mp4"]!)).toBeNull();
    expect(detectMediaType("video/mp4", SIGNATURE_SAMPLES["image/jpeg"]!)).toBeNull();
    expect(detectMediaType("audio/mpeg", SIGNATURE_SAMPLES["image/png"]!)).toBeNull();
    for (const sample of Object.values(NOT_MEDIA)) {
      expect(detectMediaType("image/jpeg", sample)).toBeNull();
      expect(detectMediaType("video/quicktime", sample)).toBeNull();
    }
    expect(detectMediaType("image/svg+xml", SIGNATURE_SAMPLES["image/jpeg"]!)).toBeNull();
  });
});
