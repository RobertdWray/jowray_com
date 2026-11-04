// A representative confirmation (note, details, one photo preview, one video
// poster with the composited play badge, one voice recording) for the
// send-test and render-preview scripts. Pure except for sharp.
import sharp from "sharp";

import { PLAY_BADGE_COMPOSITE } from "../lib/email-assets";
import { buildMemoryConfirmation, type RenderedMemoryConfirmation } from "../services/email/templates/memory-confirmation";

async function gradientJpeg(width: number, height: number, from: [number, number, number], to: [number, number, number], badge?: Buffer): Promise<string> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="rgb(${from.join(",")})"/><stop offset="1" stop-color="rgb(${to.join(",")})"/>
    </linearGradient></defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
    <circle cx="${width * 0.7}" cy="${height * 0.35}" r="${Math.min(width, height) * 0.12}" fill="rgba(255,253,248,0.55)"/>
  </svg>`;
  let pipeline = sharp(Buffer.from(svg));
  if (badge) {
    const size = Math.max(48, Math.min(160, Math.round(Math.min(width, height) * 0.3)));
    const scaled = await sharp(badge).resize(size, size).png().toBuffer();
    pipeline = pipeline.composite([{ input: scaled, gravity: "centre" }]);
  }
  const jpeg = await pipeline.jpeg({ quality: 72, mozjpeg: true }).toBuffer();
  return jpeg.toString("base64");
}

/** A photo preview and a video poster (play badge composited), as base64 JPEG, shared by both sample emails. */
export async function samplePreviews(): Promise<{ photo: string; poster: string }> {
  const photo = await gradientJpeg(1000, 750, [232, 163, 23], [200, 16, 46]);
  const poster = await gradientJpeg(1000, 562, [91, 125, 177], [63, 125, 78], Buffer.from(PLAY_BADGE_COMPOSITE.contentBase64, "base64"));
  return { photo, poster };
}

export async function buildSampleConfirmation(claimLink: string): Promise<RenderedMemoryConfirmation> {
  const { photo, poster } = await samplePreviews();
  return buildMemoryConfirmation({
    name: "Kay Bartholomew",
    relationship: "former student",
    approxDateText: "Summer 1985",
    place: "her classroom",
    note: "She once caught me reading under the desk during a spelling test.\n\nInstead of taking the book away she asked what it was, said \"good choice\", and let me finish the chapter at lunch. Spelling, she said, didn't count that day.\n\nI still have the book.",
    media: [
      { kind: "PHOTO", originalFilename: "IMG_0412.jpg", durationSeconds: null, preview: { contentId: "preview-sample-photo", contentBase64: photo, width: 1000, height: 750 } },
      { kind: "VIDEO", originalFilename: "lake-george-1998.mov", durationSeconds: 47, preview: { contentId: "preview-sample-video", contentBase64: poster, width: 1000, height: 562 } },
      { kind: "VOICE", originalFilename: "voice-memo.m4a", durationSeconds: 134, preview: null },
    ],
    claimLink,
  });
}
