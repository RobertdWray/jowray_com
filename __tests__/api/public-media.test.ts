/**
 * GET /api/public-media/[id] (plan docs/plans/2026-11-08-see-memories.md, D6, D15, D16 as amended, D18).
 *
 * The public route serves a file of a memory that is APPROVED, visibility
 * PUBLIC and not deleted, to anyone, only while the launch flag is on. Photos
 * only ever leave as the server-made copies; videos and recordings leave as
 * recorded, location included (Rob, 2026-11-08). Public visitors are counted in
 * their own `public:` scopes and limits, never in the claim-link ones. Every
 * refusal is the same 404 (no oracle).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GLOBAL_EGRESS_SCOPE, mediaEgressScope, mediaViewerScope } from "@/features/media/egress";
import { resetEnvCache } from "@/server/config/env";

type Status = "DRAFT" | "PENDING" | "APPROVED" | "HIDDEN";
type Visibility = "PUBLIC" | "FAMILY" | "PRIVATE";
interface MediaRow {
  id: string;
  sizeBytes: number | null;
  status: "PENDING" | "READY" | "FAILED";
  mimeType: string;
  storageKey: string;
  originalFilename: string | null;
  deletedAt: Date | null;
  purgedAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  gpsCheckedAt: Date | null;
  gpsScanComplete: boolean | null;
  derivatives: Array<{ kind: "WEB_IMAGE" | "THUMBNAIL" | "POSTER"; status: "READY" | "PENDING" | "FAILED"; storageKey: string; mimeType: string; sizeBytes: number | null }>;
  memory: { claimTokenHash: string; deletedAt: Date | null; status: Status; visibility: Visibility };
}
let media: MediaRow[] = [];

/** The same EgressCounter emulation as __tests__/api/media.test.ts: conditional adds, releases and the counted request. */
const counters = new Map<string, bigint>();
const key = (scope: unknown, day: unknown) => `${String(scope)}|${String(day)}`;
const executeRawMock = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const sql = strings.join("?");
  if (sql.includes("GREATEST")) {
    const [bytes, scope, day] = values as [bigint, string, string];
    const current = counters.get(key(scope, day)) ?? BigInt(0);
    counters.set(key(scope, day), current > bytes ? current - bytes : BigInt(0));
    return 1;
  }
  const [scope, day, bytes, limit] = values as [string, string, bigint, bigint | undefined];
  const next = (counters.get(key(scope, day)) ?? BigInt(0)) + bytes;
  if (limit !== undefined && next > limit) {
    return 0;
  }
  counters.set(key(scope, day), next);
  return 1;
});
const queryRawMock = vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
  const [scope, day, limit] = values as [string, string, bigint];
  const next = (counters.get(key(scope, day)) ?? BigInt(0)) + BigInt(1);
  if (next > limit) {
    return [];
  }
  counters.set(key(scope, day), next);
  return [{ bytes: next }];
});
const scopesTouched = () => [...counters.keys()].map((k) => k.split("|")[0]!);
const dbStub = {
  $executeRaw: executeRawMock,
  $queryRaw: queryRawMock,
  media: {
    findUnique: vi.fn(async ({ where, include }: { where: { id: string }; include: { memory: { select: Record<string, boolean> }; derivatives: { where: { status: string } } } }) => {
      const row = media.find((m) => m.id === where.id);
      if (!row) {
        return null;
      }
      // Honour the memory select, so a column the code forgot to select is missing here as it would be from Prisma.
      const memory = Object.fromEntries(Object.entries(row.memory).filter(([column]) => include.memory.select[column]));
      return { maxBytes: 25 * 1024 * 1024, ...row, memory, derivatives: row.derivatives.filter((d) => d.status === include.derivatives.where.status) };
    }),
  },
};
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));

const presignMock = vi.fn(async ({ pathname }: { pathname: string; validUntil: number }) => ({ url: `https://blob.test/${pathname}?signed=1`, expiresAt: new Date(Date.now() + 60_000) }));
const getMock = vi.fn(async () => ({ stream: new Blob(["bytes"]).stream(), contentType: "video/quicktime", contentLength: 5 }));
vi.mock("@/services/storage", () => ({ createStorageService: () => ({ presignGet: presignMock, get: getMock, head: vi.fn(), del: vi.fn(), put: vi.fn() }) }));

import { GET } from "@/app/api/public-media/[id]/route";
import { serveMedia } from "@/features/media/serve-media";

function request(id: string, query = "", ip = "203.0.113.7") {
  const req = new NextRequest(`http://localhost:3000/api/public-media/${id}${query}`, { headers: { "x-forwarded-for": ip } });
  return GET(req, { params: Promise.resolve({ id }) });
}

const CHECKED = new Date("2026-11-07T12:00:00Z");
const PUBLIC_MEMORY = { claimTokenHash: "a".repeat(64), deletedAt: null, status: "APPROVED", visibility: "PUBLIC" } as const;

function photo(over: Partial<MediaRow> = {}): MediaRow {
  return {
    id: "med_photo",
    sizeBytes: 4_000_000,
    status: "READY",
    mimeType: "image/heic",
    storageKey: "originals/mem_1/photo.heic",
    originalFilename: "IMG_0001.HEIC",
    deletedAt: null,
    purgedAt: null,
    // The original carries where it was taken; only the stripped copies may ever leave.
    latitude: 39.4815,
    longitude: -76.6447,
    gpsCheckedAt: CHECKED,
    gpsScanComplete: null,
    derivatives: [
      { kind: "WEB_IMAGE", status: "READY", storageKey: "derived/mem_1/web.jpg", mimeType: "image/jpeg", sizeBytes: 400_000 },
      { kind: "THUMBNAIL", status: "READY", storageKey: "derived/mem_1/thumb.jpg", mimeType: "image/jpeg", sizeBytes: 90_000 },
    ],
    memory: { ...PUBLIC_MEMORY },
    ...over,
  };
}
function recording(id: string, mimeType: string, location: Pick<MediaRow, "latitude" | "longitude" | "gpsCheckedAt" | "gpsScanComplete">): MediaRow {
  return { ...photo({ id, mimeType, storageKey: `originals/mem_1/${id}`, derivatives: [], sizeBytes: 3_000_000 }), ...location };
}

const ENV_KEYS = ["PUBLIC_MEMORIES_ENABLED", "MEDIA_PUBLIC_DAILY_EGRESS_BYTES", "MEDIA_PUBLIC_FILE_DAILY_MULTIPLE", "MEDIA_PUBLIC_VIEWER_DAILY_REQUESTS", "MEDIA_VIEWER_DAILY_REQUESTS", "MEDIA_DAILY_EGRESS_BYTES"];

beforeEach(() => {
  media = [
    photo(),
    recording("med_mov_located", "video/quicktime", { latitude: 40.6892, longitude: -74.0445, gpsCheckedAt: CHECKED, gpsScanComplete: true }),
    recording("med_mov_unscanned", "video/quicktime", { latitude: null, longitude: null, gpsCheckedAt: null, gpsScanComplete: null }),
    recording("med_mov_clean", "video/quicktime", { latitude: null, longitude: null, gpsCheckedAt: CHECKED, gpsScanComplete: true }),
    // Decided absent, but the reader gave up (a limit, a malformed box) or ran before the flag existed (TCR round 1, B1-1).
    recording("med_mov_gave_up", "video/quicktime", { latitude: null, longitude: null, gpsCheckedAt: CHECKED, gpsScanComplete: false }),
    recording("med_mp4_legacy", "video/mp4", { latitude: null, longitude: null, gpsCheckedAt: CHECKED, gpsScanComplete: null }),
    recording("med_m4a_unscanned", "audio/mp4", { latitude: null, longitude: null, gpsCheckedAt: null, gpsScanComplete: null }),
    recording("med_m4a_clean", "audio/x-m4a", { latitude: null, longitude: null, gpsCheckedAt: CHECKED, gpsScanComplete: true }),
    recording("med_m4a_gave_up", "audio/x-m4a", { latitude: null, longitude: null, gpsCheckedAt: CHECKED, gpsScanComplete: false }),
    recording("med_webm", "audio/webm", { latitude: null, longitude: null, gpsCheckedAt: null, gpsScanComplete: null }),
  ];
  presignMock.mockClear();
  getMock.mockClear();
  counters.clear();
  for (const name of ENV_KEYS) {
    delete process.env[name];
  }
  process.env.PUBLIC_MEMORIES_ENABLED = "true";
  resetEnvCache();
});

describe("GET /api/public-media/[id]: who may see", () => {
  it("redirects a public photo's web copy and thumbnail with no token, with the protective headers", async () => {
    const web = await request("med_photo", "?v=web");
    expect(web.status).toBe(302);
    expect(web.headers.get("location")).toBe("https://blob.test/derived/mem_1/web.jpg?signed=1");
    expect(web.headers.get("x-content-type-options")).toBe("nosniff");
    expect(web.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(web.headers.get("referrer-policy")).toBe("no-referrer");
    const thumb = await request("med_photo", "?v=thumb");
    expect(thumb.status).toBe(302);
    expect(thumb.headers.get("location")).toBe("https://blob.test/derived/mem_1/thumb.jpg?signed=1");
  });

  it.each([
    ["PENDING", "PUBLIC"],
    ["HIDDEN", "PUBLIC"],
    ["DRAFT", "PUBLIC"],
    ["APPROVED", "FAMILY"],
    ["APPROVED", "PRIVATE"],
  ] as const)("404s a %s memory with visibility %s", async (status, visibility) => {
    media[0]!.memory = { ...PUBLIC_MEMORY, status, visibility };
    expect((await request("med_photo", "?v=web")).status).toBe(404);
    expect(presignMock).not.toHaveBeenCalled();
  });

  it("404s a deleted memory, a removed file, a purged file, a file not READY, a missing copy and an unknown id", async () => {
    const cases: Array<Partial<MediaRow>> = [
      { memory: { ...PUBLIC_MEMORY, deletedAt: new Date() } },
      { deletedAt: new Date() },
      { purgedAt: new Date() },
      { status: "PENDING" },
      { derivatives: [] },
    ];
    for (const over of cases) {
      media = [photo(over)];
      expect((await request("med_photo", "?v=web")).status, JSON.stringify(over)).toBe(404);
    }
    expect((await request("nope", "?v=web")).status).toBe(404);
    expect(presignMock).not.toHaveBeenCalled();
  });

  it("404s everything while the launch flag is off, without reading the database", async () => {
    process.env.PUBLIC_MEMORIES_ENABLED = "false";
    resetEnvCache();
    dbStub.media.findUnique.mockClear();
    expect((await request("med_photo", "?v=web")).status).toBe(404);
    delete process.env.PUBLIC_MEMORIES_ENABLED;
    resetEnvCache();
    expect((await request("med_photo", "?v=thumb")).status).toBe(404);
    expect(dbStub.media.findUnique).not.toHaveBeenCalled();
    expect(presignMock).not.toHaveBeenCalled();
  });

  it("ignores a claim token: `t` grants nothing extra on the public route", async () => {
    media[0]!.memory = { ...PUBLIC_MEMORY, visibility: "FAMILY" };
    expect((await request("med_photo", `?v=web&t=${"x".repeat(43)}`)).status).toBe(404);
  });
});

describe("GET /api/public-media/[id]: videos and recordings play as recorded (D16 as amended, Rob 2026-11-08)", () => {
  it.each(["med_mov_located", "med_mov_unscanned", "med_mov_clean", "med_mov_gave_up", "med_mp4_legacy", "med_m4a_unscanned", "med_m4a_clean", "med_m4a_gave_up", "med_webm"])("redirects %s to its original, whatever its location scan found", async (id) => {
    const res = await request(id);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://blob.test/originals/mem_1/${id}?signed=1`);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("never sends a photo's original, whatever `v` or `download` asks for", async () => {
    for (const query of ["?v=original", "?download=1", "?v=original&download=1", "?v=thumb&download=1"]) {
      presignMock.mockClear();
      const res = await request("med_photo", query);
      expect(res.status, query).toBe(302);
      const location = res.headers.get("location") ?? "";
      expect(location, query).toMatch(/^https:\/\/blob\.test\/derived\/mem_1\/(web|thumb)\.jpg\?signed=1$/);
      expect(location, query).not.toContain("download=1");
      expect(presignMock).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: "originals/mem_1/photo.heic" }));
    }
    expect(getMock).not.toHaveBeenCalled();
  });

  it("never streams a video as a download: `download=1` is ignored and the file is an inline redirect", async () => {
    const res = await request("med_mov_clean", "?download=1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).not.toContain("download=1");
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(getMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/public-media/[id]: a video's v=thumb is its POSTER or nothing (D7)", () => {
  const posterRow = (over: Partial<MediaRow["derivatives"][number]> = {}): MediaRow["derivatives"][number] => ({ kind: "POSTER", status: "READY", storageKey: "derived/mem_1/poster.jpg", mimeType: "image/jpeg", sizeBytes: 120_000, ...over });

  it("redirects to the poster, touching only public: scopes and charging the poster's bytes", async () => {
    media = [{ ...recording("med_mov_clean", "video/quicktime", { latitude: null, longitude: null, gpsCheckedAt: CHECKED, gpsScanComplete: true }), derivatives: [posterRow()] }];
    const res = await request("med_mov_clean", "?v=thumb");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://blob.test/derived/mem_1/poster.jpg?signed=1");
    const touched = scopesTouched();
    expect(touched).toContain(`public:${mediaViewerScope("med_mov_clean", "thumb", "203.0.113.7")}`);
    for (const scope of touched) {
      expect(scope.startsWith("public:"), scope).toBe(true);
    }
    expect(counters.get(`public:${GLOBAL_EGRESS_SCOPE}|${[...counters.keys()][0]!.split("|")[1]}`)).toBe(BigInt(120_000));
  });

  it("serves the poster for ?v=thumb&download=1 too (the public route ignores download)", async () => {
    media = [{ ...recording("med_mov_clean", "video/quicktime", { latitude: null, longitude: null, gpsCheckedAt: CHECKED, gpsScanComplete: true }), derivatives: [posterRow()] }];
    const res = await request("med_mov_clean", "?v=thumb&download=1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://blob.test/derived/mem_1/poster.jpg?signed=1");
  });

  it("404s without a READY poster, never sending the video, and without a presign", async () => {
    // The default fixtures have no derivatives at all.
    expect((await request("med_mov_clean", "?v=thumb")).status).toBe(404);
    media = [{ ...recording("med_mov_clean", "video/quicktime", { latitude: null, longitude: null, gpsCheckedAt: CHECKED, gpsScanComplete: true }), derivatives: [posterRow({ status: "PENDING" })] }];
    expect((await request("med_mov_clean", "?v=thumb")).status).toBe(404);
    expect(presignMock).not.toHaveBeenCalled();
  });

  it("404s the poster of a memory that is not public", async () => {
    media = [{ ...recording("med_mov_clean", "video/quicktime", { latitude: null, longitude: null, gpsCheckedAt: CHECKED, gpsScanComplete: true }), derivatives: [posterRow()], memory: { ...PUBLIC_MEMORY, visibility: "FAMILY" } }];
    expect((await request("med_mov_clean", "?v=thumb")).status).toBe(404);
    expect(presignMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/public-media/[id]: allowances (D18)", () => {
  it("charges the public scopes and never the claim-link ones", async () => {
    expect((await request("med_photo", "?v=web")).status).toBe(302);
    const touched = scopesTouched();
    expect(touched.length).toBeGreaterThan(0);
    for (const scope of touched) {
      expect(scope.startsWith("public:"), scope).toBe(true);
    }
    expect(touched).toContain(`public:${GLOBAL_EGRESS_SCOPE}`);
    expect(touched).toContain(`public:${mediaEgressScope("med_photo")}`);
    expect(touched).toContain(`public:${mediaViewerScope("med_photo", "web", "203.0.113.7")}`);
    expect(touched).not.toContain(GLOBAL_EGRESS_SCOPE);
    expect(touched).not.toContain(mediaEgressScope("med_photo"));
  });

  it("refuses with 429 once one viewer's public request cap is reached, and only for that viewer", async () => {
    process.env.MEDIA_PUBLIC_VIEWER_DAILY_REQUESTS = "2";
    process.env.MEDIA_VIEWER_DAILY_REQUESTS = "1000";
    resetEnvCache();
    expect((await request("med_photo", "?v=web")).status).toBe(302);
    expect((await request("med_photo", "?v=web")).status).toBe(302);
    const refused = await request("med_photo", "?v=web");
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await request("med_photo", "?v=web", "198.51.100.9")).status).toBe(302);
  });

  it("refuses with 429 when the site-wide public bytes are used up, while the claim-link budget is untouched", async () => {
    process.env.MEDIA_PUBLIC_DAILY_EGRESS_BYTES = "500000";
    process.env.MEDIA_DAILY_EGRESS_BYTES = "1";
    resetEnvCache();
    expect((await request("med_photo", "?v=web")).status).toBe(302);
    expect((await request("med_photo", "?v=web", "198.51.100.9")).status).toBe(429);
  });
});

describe("serveMedia with caller public (defence in depth)", () => {
  it("refuses a memory that is not APPROVED + PUBLIC even when the caller's authorize says yes", async () => {
    media[0]!.memory = { ...PUBLIC_MEMORY, visibility: "FAMILY" };
    const res = await serveMedia({ id: "med_photo", variant: "web", download: false, caller: "public", viewerKey: "x", allowDeletedMemory: false, authorize: () => true });
    expect(res.status).toBe(404);
  });

  it("refuses a deleted memory for the public caller even when asked to allow deleted memories", async () => {
    media[0]!.memory = { ...PUBLIC_MEMORY, deletedAt: new Date() };
    const res = await serveMedia({ id: "med_photo", variant: "web", download: false, caller: "public", viewerKey: "x", allowDeletedMemory: true, authorize: () => true });
    expect(res.status).toBe(404);
  });

  it("refuses a located video in a memory that is not APPROVED + PUBLIC even when the caller's authorize says yes", async () => {
    media.find((m) => m.id === "med_mov_located")!.memory = { ...PUBLIC_MEMORY, visibility: "FAMILY" };
    const res = await serveMedia({ id: "med_mov_located", variant: "web", download: false, caller: "public", viewerKey: "x", allowDeletedMemory: false, authorize: () => true });
    expect(res.status).toBe(404);
    expect(presignMock).not.toHaveBeenCalled();
  });

  it("gives the public caller a located video only as an inline redirect, never a download, even when asked through serveMedia", async () => {
    const res = await serveMedia({ id: "med_mov_located", variant: "original", download: true, caller: "public", viewerKey: "x", allowDeletedMemory: false, authorize: () => true });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://blob.test/originals/mem_1/med_mov_located?signed=1");
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(getMock).not.toHaveBeenCalled();
  });
});
