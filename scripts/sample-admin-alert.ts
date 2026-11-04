// A representative family-admin alert (contributor and flags, note, one
// photo preview, one video poster, one voice recording, one file still
// uploading) for the send-test and render-preview scripts.
import { buildAdminNewMemory, type RenderedAdminNewMemory } from "../services/email/templates/admin-new-memory";

import { samplePreviews } from "./sample-confirmation";

export async function buildSampleAdminAlert(): Promise<RenderedAdminNewMemory> {
  const { photo, poster } = await samplePreviews();
  return buildAdminNewMemory({
    memoryId: "8f1c2d3e-5b6a-4c7d-8e9f-0a1b2c3d4e5f",
    submittedAt: new Date("2026-11-03T19:38:00Z"),
    name: "Kay Bartholomew",
    relationship: "former student",
    email: "kay@example.com",
    contactOptIn: true,
    mailingListOptIn: false,
    notifyWhenPosted: true,
    approxDateText: "Summer 1985",
    place: "her classroom",
    note: "She once caught me reading under the desk during a spelling test.\n\nInstead of taking the book away she asked what it was, said \"good choice\", and let me finish the chapter at lunch. Spelling, she said, didn't count that day.\n\nI still have the book.",
    visibility: "FAMILY",
    media: [
      { kind: "PHOTO", originalFilename: "IMG_0412.jpg", durationSeconds: null, preview: { contentId: "preview-sample-photo", contentBase64: photo, width: 1000, height: 750 } },
      { kind: "VIDEO", originalFilename: "lake-george-1998.mov", durationSeconds: 47, preview: { contentId: "preview-sample-video", contentBase64: poster, width: 1000, height: 562 } },
      { kind: "VOICE", originalFilename: "voice-memo.m4a", durationSeconds: 134, preview: null },
    ],
    filesNotReady: 1,
  });
}
