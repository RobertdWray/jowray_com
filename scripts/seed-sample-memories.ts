// Sample memories for looking at See memories on a LOCAL database only (plan docs/plans/2026-11-08-see-memories.md,
// L13, finding #14). It loads the canvas's invented seed (design/reference/see-memories/data/memories.js: "Every
// contributor and memory below is invented") into a memorial of its own, with files that have no bytes behind them,
// so the pages, filters, timeline and player states can be checked without real memories.
//
// It refuses any database host other than localhost, 127.0.0.1 or ::1, and has no flag to override that: the
// preview and production databases hold real memories, and invented names on a memorial are not acceptable there.
//
//   DATABASE_URL_UNPOOLED=postgresql://postgres@127.0.0.1:54329/<db> npx tsx scripts/seed-sample-memories.ts
//
// Running it again replaces the sample memorial's rows (only those: they all hang off its own memorial).
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { PrismaPg } from "@prisma/adapter-pg";

import { type Prisma, PrismaClient } from "../generated/prisma/client";

const SAMPLE_SLUG = "see-memories-sample";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

interface SamplePlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
}
interface SampleMemory {
  id: string;
  type: "PHOTO" | "VOICE" | "VIDEO" | "TEXT";
  who: string;
  relationship: string | null;
  when: string | null;
  year: number | null;
  month: number | null;
  placeId: string | null;
  note: string | null;
  tags: string[];
  durationSeconds: number | null;
  photoCount: number;
}
interface SampleData {
  places: SamplePlace[];
  tags: Array<{ id: string; name: string }>;
  memories: SampleMemory[];
}

/** The loopback check, exported for its test. Throws for anything that is not plainly this machine. */
export function assertLoopback(connectionString: string): string {
  const url = new URL(connectionString);
  if (!LOOPBACK.has(url.hostname)) {
    throw new Error(`seed-sample-memories only writes to a database on this machine (localhost, 127.0.0.1, ::1); refusing host "${url.hostname}"`);
  }
  return url.hostname;
}

/** The canvas seed is JSON after a `window.JW_MEMORIES =` assignment; parse it as data, never run it. */
export function parseSample(source: string): SampleData {
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("the sample data file has no object");
  }
  return JSON.parse(source.slice(start, end + 1)) as SampleData;
}

const hex = () => randomBytes(32).toString("hex");

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    throw new Error("DATABASE_URL_UNPOOLED is required (a local database)");
  }
  const host = assertLoopback(connectionString);
  const data = parseSample(readFileSync(new URL("../design/reference/see-memories/data/memories.js", import.meta.url), "utf8"));
  const places = new Map(data.places.map((place) => [place.id, place]));
  const tagNames = new Map(data.tags.map((tag) => [tag.id, tag.name]));
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const memorial = await prisma.memorial.upsert({ where: { slug: SAMPLE_SLUG }, create: { name: "Sample memorial (invented)", slug: SAMPLE_SLUG }, update: {} });
    // Replace the previous sample, children first.
    const old = await prisma.memory.findMany({ where: { memorialId: memorial.id }, select: { id: true } });
    const oldIds = old.map((row) => row.id);
    await prisma.derivedMedia.deleteMany({ where: { media: { memoryId: { in: oldIds } } } });
    await prisma.media.deleteMany({ where: { memoryId: { in: oldIds } } });
    await prisma.memoryRevision.deleteMany({ where: { memoryId: { in: oldIds } } });
    await prisma.memory.deleteMany({ where: { memorialId: memorial.id } });
    await prisma.contributor.deleteMany({ where: { memorialId: memorial.id } });

    const contributors: Prisma.ContributorCreateManyInput[] = [];
    const memories: Prisma.MemoryCreateManyInput[] = [];
    const media: Prisma.MediaCreateManyInput[] = [];
    const derived: Prisma.DerivedMediaCreateManyInput[] = [];
    const now = new Date();
    data.memories.forEach((sample, index) => {
      const contributorId = randomUUID();
      const memoryId = randomUUID();
      const place = sample.placeId ? places.get(sample.placeId) : undefined;
      contributors.push({ id: contributorId, memorialId: memorial.id, name: sample.who, relationship: sample.relationship });
      // Most are public; a few are FAMILY or PENDING so the hidden ones can be checked too; one in twenty has no date.
      const status = index % 15 === 7 ? "PENDING" : "APPROVED";
      const visibility = index % 10 === 3 ? "FAMILY" : "PUBLIC";
      const undated = index % 20 === 11;
      memories.push({
        id: memoryId,
        memorialId: memorial.id,
        contributorId,
        type: sample.type,
        source: "OTHER",
        sourceRef: `sample:${sample.id}`,
        approxDateText: undated ? null : sample.when,
        approxYear: undated ? null : sample.month !== null ? sample.year : null,
        approxMonth: undated ? null : sample.month,
        place: place?.name ?? null,
        latitude: place?.lat ?? null,
        longitude: place?.lon ?? null,
        tags: sample.tags.map((id) => tagNames.get(id) ?? id),
        contributorNote: sample.note,
        visibility,
        consentVersion: "sample",
        consentedAt: now,
        status,
        claimTokenHash: hex(),
        createdAt: new Date(now.getTime() - index * 60_000),
      });
      const addFile = (mimeType: string, extra: Partial<Prisma.MediaCreateManyInput> = {}) => {
        const id = randomUUID();
        media.push({ id, memoryId, storageKey: `dev/originals/sample/${id}`, status: "READY", mimeType, maxBytes: 25 * 1024 * 1024, sizeBytes: 1_000_000, sortOrder: media.length, ...extra });
        return id;
      };
      if (sample.type === "PHOTO") {
        for (let photo = 0; photo < Math.max(1, sample.photoCount); photo += 1) {
          const id = addFile("image/jpeg", { width: 4032, height: 3024, caption: photo === 0 ? sample.note?.slice(0, 80) ?? null : null });
          derived.push({ id: randomUUID(), mediaId: id, kind: "WEB_IMAGE", status: "READY", storageKey: `dev/derived/sample/${id}-web.jpg`, mimeType: "image/jpeg", width: 2048, height: 1536, sizeBytes: 400_000 });
          derived.push({ id: randomUUID(), mediaId: id, kind: "THUMBNAIL", status: "READY", storageKey: `dev/derived/sample/${id}-thumb.jpg`, mimeType: "image/jpeg", width: 1000, height: 750, sizeBytes: 90_000 });
        }
      } else if (sample.type === "VOICE") {
        // Alternate a browser recording (always playable) and an M4A not scanned yet (waiting, D16).
        addFile(index % 2 === 0 ? "audio/webm" : "audio/mp4", { durationSeconds: sample.durationSeconds });
      } else if (sample.type === "VIDEO") {
        // Alternate a MOV scanned clean (playable) and one whose scan found a location (waiting, D16).
        const located = index % 2 === 1;
        addFile("video/quicktime", { durationSeconds: sample.durationSeconds, gpsCheckedAt: now, latitude: located ? 40.6892 : null, longitude: located ? -74.0445 : null });
      }
    });
    await prisma.contributor.createMany({ data: contributors });
    await prisma.memory.createMany({ data: memories });
    await prisma.media.createMany({ data: media });
    await prisma.derivedMedia.createMany({ data: derived });
    console.log(`seed-sample-memories: ${memories.length} invented memories, ${media.length} files on ${host} (memorial "${SAMPLE_SLUG}")`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
