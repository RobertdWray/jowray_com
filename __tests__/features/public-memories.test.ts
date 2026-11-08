/**
 * The public read model (plan docs/plans/2026-11-08-see-memories.md, L8, D1, D2, D16).
 *
 * `features/memories/public.ts` is the only reader of `PUBLIC_MEMORY_WHERE`:
 * every query it makes is pinned here, and every DTO it returns is checked
 * for what must never leave the server (emails, claim token hashes, blob URLs,
 * storage keys, exact coordinates).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CHECKED = new Date("2026-11-07T12:00:00Z");
const SECRET_EMAIL = "secret.person@example.com";
const SECRET_HASH = "f".repeat(64);
const SECRET_KEY = "originals/mem_1/secret-key.heic";
const SECRET_URL = "https://blob.example.invalid/secret";
const EXACT_LAT = 39.48153;
const EXACT_LON = -76.64471;

type Row = Record<string, unknown>;
let rows: Row[] = [];
const findMany = vi.fn(async (_args: unknown) => rows);
const findFirst = vi.fn(async (_args: unknown) => rows[0] ?? null);
vi.mock("@/server/db/client", () => ({ getDb: () => ({ memory: { findMany, findFirst } }) }));

import { getPublicMemory, listPublicMemories, PUBLIC_MEMORY_WHERE } from "@/features/memories/public";

function mediaRow(over: Row = {}): Row {
  return {
    id: "00000000-0000-4000-8000-0000000000m1",
    mimeType: "image/heic",
    durationSeconds: null,
    width: 4032,
    height: 3024,
    caption: "At the county fair",
    sortOrder: 0,
    latitude: EXACT_LAT,
    longitude: EXACT_LON,
    gpsCheckedAt: CHECKED,
    gpsScanComplete: null,
    // What the query returns when the stub does not apply the select: the test proves none of it reaches the DTO.
    storageKey: SECRET_KEY,
    blobUrl: SECRET_URL,
    derivatives: [
      { kind: "WEB_IMAGE", width: 2048, height: 1536, storageKey: "derived/mem_1/web.jpg" },
      { kind: "THUMBNAIL", width: 1000, height: 750, storageKey: "derived/mem_1/thumb.jpg" },
    ],
    ...over,
  };
}

function memoryRow(over: Row = {}): Row {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    type: "PHOTO",
    contributorNote: "  Jo taught me to hold calico up to the window.  ",
    approxDateText: "Summer 1985",
    approxYear: null,
    approxMonth: null,
    place: "Towson,  MD.",
    latitude: EXACT_LAT,
    longitude: EXACT_LON,
    tags: ["quilting", "Café", "cafe"],
    createdAt: new Date("2026-11-03T10:00:00Z"),
    claimTokenHash: SECRET_HASH,
    contributor: { name: "Ellen Kerrigan", relationship: "quilting friend", email: SECRET_EMAIL },
    media: [mediaRow()],
    ...over,
  };
}

beforeEach(() => {
  rows = [memoryRow()];
  findMany.mockClear();
  findFirst.mockClear();
});

describe("PUBLIC_MEMORY_WHERE (debt rule M-E-14, plan D1)", () => {
  it("is APPROVED, PUBLIC and not deleted, nothing else", () => {
    expect(PUBLIC_MEMORY_WHERE).toEqual({ status: "APPROVED", visibility: "PUBLIC", deletedAt: null });
  });
});

describe("listPublicMemories", () => {
  it("reads with exactly PUBLIC_MEMORY_WHERE, newest first with an id tie-breaker", async () => {
    await listPublicMemories();
    const args = findMany.mock.calls[0]![0] as { where: unknown; orderBy: unknown };
    expect(args.where).toEqual(PUBLIC_MEMORY_WHERE);
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("selects only what the pages show: no email, token hash, blob URL or original storage key", async () => {
    await listPublicMemories();
    const { select } = findMany.mock.calls[0]![0] as { select: Record<string, unknown> };
    const selected = JSON.stringify(select);
    for (const forbidden of ["email", "claimTokenHash", "blobUrl", "exif", "originalFilename", "phone", "sourceRef"]) {
      expect(selected, forbidden).not.toContain(`"${forbidden}"`);
    }
    expect(select.contributor).toEqual({ select: { name: true, relationship: true } });
    const media = select.media as { where: unknown; select: Record<string, unknown> };
    expect(media.where).toEqual({ deletedAt: null, purgedAt: null, status: "READY" });
    expect(media.select).not.toHaveProperty("storageKey");
    // Playability no longer depends on where a file was recorded (D16 as amended, Rob 2026-11-08), so the public read never selects it.
    for (const column of ["latitude", "longitude", "gpsCheckedAt", "gpsScanComplete"]) {
      expect(media.select, column).not.toHaveProperty(column);
    }
    expect(media.select.derivatives).toEqual({ where: { status: "READY" }, select: { kind: true, width: true, height: true, storageKey: true } });
  });

  it("returns a DTO with no secret, no exact coordinate and the point rounded to 0.05°", async () => {
    const [memory] = await listPublicMemories();
    const json = JSON.stringify(memory);
    for (const secret of [SECRET_EMAIL, SECRET_HASH, SECRET_KEY, SECRET_URL, String(EXACT_LAT), String(EXACT_LON), "derived/mem_1"]) {
      expect(json, secret).not.toContain(secret);
    }
    expect(memory!.point).toEqual({ lat: 39.5, lon: -76.65 });
  });

  it("maps the words, the place, the year, the tags and the contributor", async () => {
    const [memory] = await listPublicMemories();
    expect(memory).toMatchObject({
      id: "00000000-0000-4000-8000-000000000001",
      kind: "PHOTO",
      who: "Ellen Kerrigan",
      relationship: "quilting friend",
      note: "Jo taught me to hold calico up to the window.",
      when: "Summer 1985",
      year: 1985,
      month: null,
      place: { label: "Towson, MD", slug: "towson-md" },
      tags: [{ name: "quilting", slug: "quilting" }, { name: "Café", slug: "cafe" }],
      createdAt: "2026-11-03T10:00:00.000Z",
    });
  });

  it("prefers the family's year and keeps the month only with it", async () => {
    rows = [memoryRow({ approxYear: 1962, approxMonth: 7 }), memoryRow({ id: "00000000-0000-4000-8000-000000000002", approxYear: null, approxMonth: 7 })];
    const [withYear, withoutYear] = await listPublicMemories();
    expect(withYear).toMatchObject({ year: 1962, month: 7 });
    expect(withoutYear).toMatchObject({ year: 1985, month: null });
  });

  it("calls an unnamed contributor \"A friend of Jo's\" and drops empty words", async () => {
    rows = [memoryRow({ contributor: null, contributorNote: "   ", approxDateText: "", place: "   ", tags: [] }), memoryRow({ id: "00000000-0000-4000-8000-000000000002", contributor: { name: "  ", relationship: " ", email: SECRET_EMAIL } })];
    const [first, second] = await listPublicMemories();
    expect(first).toMatchObject({ who: "A friend of Jo's", relationship: null, note: null, when: null, place: null, tags: [] });
    expect(second).toMatchObject({ who: "A friend of Jo's", relationship: null });
  });

  it("lists only photos with a READY web copy, with the copy's size and the caption as alt", async () => {
    rows = [memoryRow({ media: [
      mediaRow(),
      mediaRow({ id: "00000000-0000-4000-8000-0000000000m2", caption: null, derivatives: [] }),
      mediaRow({ id: "00000000-0000-4000-8000-0000000000m3", caption: "  ", derivatives: [{ kind: "WEB_IMAGE", width: 800, height: 600, storageKey: "derived/x.jpg" }] }),
      mediaRow({ id: "00000000-0000-4000-8000-0000000000m4", derivatives: [{ kind: "WEB_IMAGE", width: 800, height: 600, storageKey: "derived/mem_1/browser-staged.upload.jpg" }] }),
    ] })];
    const [memory] = await listPublicMemories();
    expect(memory!.photos).toEqual([
      { id: "00000000-0000-4000-8000-0000000000m1", width: 2048, height: 1536, alt: "At the county fair" },
      { id: "00000000-0000-4000-8000-0000000000m3", width: 800, height: 600, alt: "A photo from Ellen Kerrigan's memory" },
    ]);
  });

  it.each([
    ["a recording a browser made", { mimeType: "audio/webm", gpsCheckedAt: null, gpsScanComplete: null, latitude: null, longitude: null }],
    ["an M4A scanned clean", { mimeType: "audio/x-m4a", gpsCheckedAt: CHECKED, gpsScanComplete: true, latitude: null, longitude: null }],
    ["an M4A not scanned yet", { mimeType: "audio/mp4", gpsCheckedAt: null, gpsScanComplete: null, latitude: null, longitude: null }],
    ["an M4A with a location", { mimeType: "audio/x-m4a", gpsCheckedAt: CHECKED, gpsScanComplete: true, latitude: 40.68, longitude: -74.04 }],
    ["a MOV with a location", { mimeType: "video/quicktime", gpsCheckedAt: CHECKED, gpsScanComplete: true, latitude: 40.68, longitude: -74.04 }],
    ["a MOV scanned clean", { mimeType: "video/quicktime", gpsCheckedAt: CHECKED, gpsScanComplete: true, latitude: null, longitude: null }],
    ["a MOV whose scan gave up", { mimeType: "video/quicktime", gpsCheckedAt: CHECKED, gpsScanComplete: false, latitude: null, longitude: null }],
    ["an MP4 decided before the completeness flag", { mimeType: "video/mp4", gpsCheckedAt: CHECKED, gpsScanComplete: null, latitude: null, longitude: null }],
  ])("marks %s as playable (D16 as amended, Rob 2026-11-08) and takes its duration", async (_name, location) => {
    rows = [memoryRow({ type: location.mimeType.startsWith("video/") ? "VIDEO" : "VOICE", media: [mediaRow({ ...location, durationSeconds: 47, derivatives: [] })] })];
    const [memory] = await listPublicMemories();
    expect(memory).toMatchObject({ playable: "yes", durationSeconds: 47, photos: [] });
  });

  it("is playable when there is nothing to play (a written memory)", async () => {
    rows = [memoryRow({ type: "TEXT", media: [] })];
    const [memory] = await listPublicMemories();
    expect(memory).toMatchObject({ kind: "TEXT", playable: "yes", durationSeconds: null, photos: [] });
  });
});

/**
 * The card's video picture (video-posters T10, D7): the first video whose server-made POSTER is READY and not a
 * browser-staged key, sized from that POSTER row (never from the original video), and nothing else.
 */
describe("the poster on a memory (video posters, T10)", () => {
  const POSTER = (over: Row = {}): Row => ({ kind: "POSTER", width: 1000, height: 562, storageKey: "derived/mem_1/poster.jpg", ...over });
  const video = (id: string, derivatives: Row[]): Row => mediaRow({ id, mimeType: "video/mp4", durationSeconds: 30, width: 3840, height: 2160, caption: null, derivatives });

  it("takes the first video with a READY POSTER, sized from the POSTER row, past a photo and a video without one", async () => {
    rows = [memoryRow({ type: "VIDEO", media: [
      mediaRow(),
      video("00000000-0000-4000-8000-0000000000v1", []),
      video("00000000-0000-4000-8000-0000000000v2", [POSTER()]),
      video("00000000-0000-4000-8000-0000000000v3", [POSTER({ width: 640, height: 360, storageKey: "derived/mem_1/other.jpg" })]),
    ] })];
    const [memory] = await listPublicMemories();
    expect(memory!.poster).toEqual({ mediaId: "00000000-0000-4000-8000-0000000000v2", width: 1000, height: 562 });
  });

  it("skips a POSTER on a browser-staged key and never lets a derived key into the DTO", async () => {
    rows = [memoryRow({ type: "VIDEO", media: [
      video("00000000-0000-4000-8000-0000000000v1", [POSTER({ storageKey: "derived/mem_1/v1.upload.jpg" })]),
      video("00000000-0000-4000-8000-0000000000v2", [POSTER()]),
    ] })];
    const [memory] = await listPublicMemories();
    expect(memory!.poster).toEqual({ mediaId: "00000000-0000-4000-8000-0000000000v2", width: 1000, height: 562 });
    expect(JSON.stringify(memory)).not.toContain("derived/mem_1");

    rows = [memoryRow({ type: "VIDEO", media: [video("00000000-0000-4000-8000-0000000000v1", [POSTER({ storageKey: "derived/mem_1/v1.upload.jpg" })])] })];
    const [stagedOnly] = await listPublicMemories();
    expect(stagedOnly!.poster).toBeNull();
  });

  it("is null for a video without one, a photo memory, a recording and a written memory", async () => {
    rows = [
      memoryRow({ type: "VIDEO", media: [video("00000000-0000-4000-8000-0000000000v1", [{ kind: "THUMBNAIL", width: 1000, height: 562, storageKey: "derived/mem_1/t.jpg" }])] }),
      memoryRow({ id: "00000000-0000-4000-8000-000000000002" }),
      memoryRow({ id: "00000000-0000-4000-8000-000000000003", type: "VOICE", media: [mediaRow({ mimeType: "audio/mp4", derivatives: [POSTER()] })] }),
      memoryRow({ id: "00000000-0000-4000-8000-000000000004", type: "TEXT", media: [] }),
    ];
    const memories = await listPublicMemories();
    expect(memories.map((m) => m.poster)).toEqual([null, null, null, null]);
  });

  it("is on the memory page's read too", async () => {
    rows = [memoryRow({ type: "VIDEO", media: [video("00000000-0000-4000-8000-0000000000v2", [POSTER()])] })];
    const memory = await getPublicMemory("00000000-0000-4000-8000-000000000001");
    expect(memory!.poster).toEqual({ mediaId: "00000000-0000-4000-8000-0000000000v2", width: 1000, height: 562 });
  });

  it("sets hasThumb from the copy `?v=thumb` serves for the kind: a photo's THUMBNAIL, a video's POSTER, never for a recording", async () => {
    const STAGED = POSTER({ storageKey: "derived/mem_1/v4.upload.jpg" });
    const THUMBNAIL = { kind: "THUMBNAIL", width: 1000, height: 750, storageKey: "derived/mem_1/thumb.jpg" };
    rows = [memoryRow({ media: [
      mediaRow({ id: "00000000-0000-4000-8000-0000000000p1" }),
      mediaRow({ id: "00000000-0000-4000-8000-0000000000p2", derivatives: [{ kind: "WEB_IMAGE", width: 2048, height: 1536, storageKey: "derived/mem_1/web.jpg" }, POSTER()] }),
      video("00000000-0000-4000-8000-0000000000v1", [POSTER()]),
      video("00000000-0000-4000-8000-0000000000v2", [THUMBNAIL]),
      video("00000000-0000-4000-8000-0000000000v3", []),
      video("00000000-0000-4000-8000-0000000000v4", [STAGED]),
      mediaRow({ id: "00000000-0000-4000-8000-0000000000a1", mimeType: "audio/mp4", derivatives: [THUMBNAIL, POSTER()] }),
    ] })];
    const memory = await getPublicMemory("00000000-0000-4000-8000-000000000001");
    expect(memory!.media.map((item) => [item.id.slice(-2), item.hasThumb])).toEqual([
      ["p1", true],
      ["p2", false],
      ["v1", true],
      ["v2", false],
      ["v3", false],
      ["v4", false],
      ["a1", false],
    ]);
  });
});

describe("getPublicMemory", () => {
  it("reads one memory with PUBLIC_MEMORY_WHERE and its id, and returns its files in order", async () => {
    rows = [memoryRow({ media: [mediaRow(), mediaRow({ id: "00000000-0000-4000-8000-0000000000m5", mimeType: "video/quicktime", durationSeconds: 30, gpsCheckedAt: CHECKED, latitude: 40.68, longitude: -74.04, derivatives: [] })] })];
    const memory = await getPublicMemory("00000000-0000-4000-8000-000000000001");
    const args = findFirst.mock.calls[0]![0] as { where: unknown };
    expect(args.where).toEqual({ id: "00000000-0000-4000-8000-000000000001", ...PUBLIC_MEMORY_WHERE });
    expect(memory?.media).toEqual([
      { id: "00000000-0000-4000-8000-0000000000m1", kind: "PHOTO", mimeType: "image/heic", caption: "At the county fair", durationSeconds: null, width: 2048, height: 1536, hasThumb: true, playable: "yes" },
      { id: "00000000-0000-4000-8000-0000000000m5", kind: "VIDEO", mimeType: "video/quicktime", caption: "At the county fair", durationSeconds: 30, width: 4032, height: 3024, hasThumb: false, playable: "yes" },
    ]);
    const json = JSON.stringify(memory);
    for (const secret of [SECRET_EMAIL, SECRET_HASH, SECRET_KEY, SECRET_URL, "40.68", "-74.04", String(EXACT_LAT)]) {
      expect(json, secret).not.toContain(secret);
    }
  });

  it("returns null for a memory that is not public, and never queries for an id that is not a UUID", async () => {
    rows = [];
    expect(await getPublicMemory("00000000-0000-4000-8000-000000000009")).toBeNull();
    findFirst.mockClear();
    expect(await getPublicMemory("../admin")).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});
