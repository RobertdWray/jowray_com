import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { attachmentDisposition } from "@/lib/media-types";
import { mediaViewerScope } from "@/features/media/egress";
import { resetEnvCache } from "@/server/config/env";

const TOKEN = "AbCdEf0123456789_-AbCdEf0123456789_-AbCdEf0";

interface MediaRow {
  id: string;
  sizeBytes: number | null;
  maxBytes?: number;
  status: "PENDING" | "READY" | "FAILED";
  mimeType: string;
  storageKey: string;
  originalFilename: string | null;
  deletedAt: Date | null;
  purgedAt?: Date | null;
  derivatives?: Array<{ kind: "WEB_IMAGE" | "THUMBNAIL" | "POSTER"; status: "PENDING" | "READY" | "FAILED"; storageKey: string; mimeType: string | null; sizeBytes?: number | null }>;
  memory: { claimTokenHash: string; deletedAt: Date | null; status?: "DRAFT" | "PENDING" | "APPROVED" | "HIDDEN" };
}
let media: MediaRow[] = [];

/**
 * A small emulation of the EgressCounter statements in features/media/egress.ts,
 * so request sequences can be played against real counting: one row per
 * scope and day, conditional adds, unconditional adds, releases, and the
 * viewer request count with RETURNING.
 */
const counters = new Map<string, bigint>();
const counterCalls: Array<{ sql: string; values: unknown[] }> = [];
const key = (scope: unknown, day: unknown) => `${String(scope)}|${String(day)}`;
const executeRawMock = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const sql = strings.join("?");
  counterCalls.push({ sql, values });
  if (sql.includes("GREATEST")) {
    const [bytes, scope, day] = values as [bigint, string, string];
    counters.set(key(scope, day), (counters.get(key(scope, day)) ?? BigInt(0)) > bytes ? (counters.get(key(scope, day)) ?? BigInt(0)) - bytes : BigInt(0));
    return 1;
  }
  const [scope, day, bytes, limit] = values as [string, string, bigint, bigint | undefined];
  const next = (counters.get(key(scope, day)) ?? BigInt(0)) + bytes;
  if (limit !== undefined && next > limit) { return 0; }
  counters.set(key(scope, day), next);
  return 1;
});
const queryRawMock = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const sql = strings.join("?");
  counterCalls.push({ sql, values });
  const [scope, day, limit] = values as [string, string, bigint];
  const next = (counters.get(key(scope, day)) ?? BigInt(0)) + BigInt(1);
  if (next > limit) { return []; }
  counters.set(key(scope, day), next);
  return [{ bytes: next }];
});
const counterOf = (scope: string) => [...counters.entries()].filter(([k]) => k.startsWith(`${scope}|`)).reduce((sum, [, v]) => sum + v, BigInt(0));
const dbStub = {
  $executeRaw: executeRawMock,
  $queryRaw: queryRawMock,
  media: {
    findUnique: vi.fn(async ({ where, include }: { where: { id: string }; include?: { derivatives?: { where?: { status?: string } } } }) => {
      const row = media.find((m) => m.id === where.id);
      if (!row) { return null; }
      const wanted = include?.derivatives?.where?.status;
      return { purgedAt: null, maxBytes: 25 * 1024 * 1024, ...row, memory: { status: "PENDING", ...row.memory }, derivatives: (row.derivatives ?? []).filter((d) => !wanted || d.status === wanted) };
    }),
  },
};
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));

const presignMock = vi.fn(async ({ pathname }: { pathname: string; validUntil: number }) => ({
  url: `https://blob.test/${pathname}?signed=1`,
  expiresAt: new Date(Date.now() + 60_000),
}));
const getMock = vi.fn(async () => ({
  stream: new Blob(["jpegbytes"]).stream(),
  contentType: "image/jpeg",
  contentLength: 9,
}));
vi.mock("@/services/storage", () => ({
  createStorageService: () => ({ presignGet: presignMock, get: getMock, head: vi.fn(), del: vi.fn(), put: vi.fn() }),
}));

import { GET } from "@/app/api/media/[id]/route";

function request(id: string, query: string, headers: Record<string, string> = {}) {
  const req = new NextRequest(`http://localhost:3000/api/media/${id}${query}`, { headers });
  return GET(req, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  media = [
    {
      id: "med_ready",
      sizeBytes: 9,
      status: "READY",
      mimeType: "image/jpeg",
      storageKey: "originals/mem_1/abc.jpg",
      originalFilename: 'photo "one"\r\nBcc.jpg',
      deletedAt: null,
      derivatives: [
        { kind: "WEB_IMAGE", status: "READY", storageKey: "derived/mem_1/web.jpg", mimeType: "image/jpeg" },
        { kind: "THUMBNAIL", status: "READY", storageKey: "derived/mem_1/thumb.jpg", mimeType: "image/jpeg" },
      ],
      memory: { claimTokenHash: hashClaimToken(TOKEN), deletedAt: null },
    },
    { ...{} as MediaRow, id: "med_pending", sizeBytes: null, status: "PENDING", mimeType: "video/mp4", storageKey: "originals/mem_1/p.mp4", originalFilename: null, deletedAt: null, memory: { claimTokenHash: hashClaimToken(TOKEN), deletedAt: null } },
    { ...{} as MediaRow, id: "med_deleted", sizeBytes: 9, status: "READY", mimeType: "image/png", storageKey: "originals/mem_2/d.png", originalFilename: null, deletedAt: null, memory: { claimTokenHash: hashClaimToken(TOKEN), deletedAt: new Date() } },
    { ...{} as MediaRow, id: "med_removed", sizeBytes: 9, status: "READY", mimeType: "image/png", storageKey: "originals/mem_1/r.png", originalFilename: null, deletedAt: new Date(), memory: { claimTokenHash: hashClaimToken(TOKEN), deletedAt: null } },
  ];
  presignMock.mockClear();
  getMock.mockClear();
  executeRawMock.mockClear();
  queryRawMock.mockClear();
  counters.clear();
  counterCalls.length = 0;
  for (const name of ["MEDIA_FILE_DAILY_MULTIPLE", "MEDIA_FILE_DAILY_MULTIPLE_UNAPPROVED", "MEDIA_DAILY_EGRESS_BYTES", "MEDIA_PROXY_DOWNLOAD_MAX_BYTES", "MEDIA_VIEWER_DAILY_REQUESTS"]) { delete process.env[name]; }
  resetEnvCache();
});

/** A request as a browser at `ip` would send it; `range` is the Range header a media element adds. */
const from = (ip: string, range?: string) => ({ "x-forwarded-for": ip, ...(range ? { range } : {}) });
const MB = 1024 * 1024;

describe("GET /api/media/[id]", () => {
  it("404s without a token, with a wrong token, for PENDING media, for deleted memories and unknown ids", async () => {
    expect((await request("med_ready", "")).status).toBe(404);
    expect((await request("med_ready", "?t=wrong")).status).toBe(404);
    expect((await request("med_pending", `?t=${TOKEN}`)).status).toBe(404);
    expect((await request("med_deleted", `?t=${TOKEN}`)).status).toBe(404);
    expect((await request("med_removed", `?t=${TOKEN}`)).status).toBe(404);
    expect((await request("nope", `?t=${TOKEN}`)).status).toBe(404);
    expect(presignMock).not.toHaveBeenCalled();
  });

  it("redirects an inline photo to its sanitized web copy with the protective headers", async () => {
    const res = await request("med_ready", `?t=${TOKEN}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://blob.test/derived/mem_1/web.jpg?signed=1");
    expect(res.headers.get("cache-control")).toBe("private, max-age=55");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(presignMock).toHaveBeenCalledWith(expect.objectContaining({ pathname: "derived/mem_1/web.jpg" }));
    const call = presignMock.mock.calls[0]?.[0];
    expect(call!.validUntil - Date.now()).toBeLessThanOrEqual(60_000);
  });

  it("streams an attachment with a sanitized filename when download=1", async () => {
    const res = await request("med_ready", `?t=${TOKEN}&download=1`);
    expect(res.status).toBe(200);
    expect(presignMock).not.toHaveBeenCalled();
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-length")).toBe("9");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="[A-Za-z0-9._-]+"; filename\*=UTF-8''/);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition).not.toContain('""');
    expect(await res.text()).toBe("jpegbytes");
  });
});

describe("download size cap and header hygiene", () => {
  it("redirects large downloads to the presigned url instead of streaming through the function", async () => {
    // The recorded size alone decides: nothing is fetched for a file over the proxy cap.
    media.push({ ...media[0]!, id: "med_big", sizeBytes: 200 * 1024 * 1024, mimeType: "video/mp4", storageKey: "originals/mem_1/big.mp4", derivatives: [] });
    const res = await request("med_big", `?t=${TOKEN}&download=1`);
    expect(res.status).toBe(302);
    expect(getMock).not.toHaveBeenCalled();
    expect(presignMock).toHaveBeenCalledTimes(1);
  });

  it("sends no-referrer on every response", async () => {
    expect((await request("med_ready", `?t=${TOKEN}`)).headers.get("referrer-policy")).toBe("no-referrer");
    expect((await request("nope", "")).headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("attachmentDisposition", () => {
  it("percent-encodes RFC 8187 attr-char exceptions and falls back to memory.<ext> for non-ASCII names", () => {
    expect(attachmentDisposition("it's (1)*.jpg", "jpg")).toBe("attachment; filename=\"it_s_1.jpg\"; filename*=UTF-8''it%27s%20%281%29%2A.jpg");
    expect(attachmentDisposition("思い出.heic", "heic")).toMatch(/^attachment; filename="memory\.heic"; filename\*=UTF-8''%E6/);
    expect(attachmentDisposition("\r\nBcc: x.png", "png")).not.toMatch(/[\r\n]/);
  });
});

describe("variants", () => {
  it("serves the thumbnail for v=thumb, the web copy when no thumbnail exists, and the original for v=original", async () => {
    expect((await request("med_ready", `?t=${TOKEN}&v=thumb`)).headers.get("location")).toBe("https://blob.test/derived/mem_1/thumb.jpg?signed=1");
    media[0]!.derivatives = media[0]!.derivatives!.filter((d) => d.kind !== "THUMBNAIL");
    expect((await request("med_ready", `?t=${TOKEN}&v=thumb`)).headers.get("location")).toBe("https://blob.test/derived/mem_1/web.jpg?signed=1");
    expect((await request("med_ready", `?t=${TOKEN}&v=original`)).headers.get("location")).toBe("https://blob.test/originals/mem_1/abc.jpg?signed=1");
  });

  it("answers 404 for an inline photo that has no sanitized copy yet, while the download still works", async () => {
    media[0]!.derivatives = [{ kind: "WEB_IMAGE", status: "PENDING", storageKey: "derived/mem_1/pending.jpg", mimeType: null }];
    expect((await request("med_ready", `?t=${TOKEN}`)).status).toBe(404);
    expect((await request("med_ready", `?t=${TOKEN}&v=thumb`)).status).toBe(404);
    expect((await request("med_ready", `?t=${TOKEN}&download=1`)).status).toBe(200);
    expect(presignMock).not.toHaveBeenCalled();
  });

  it("never serves a staging key, even if a row points at one", async () => {
    media[0]!.derivatives = [{ kind: "WEB_IMAGE", status: "READY", storageKey: "derived/mem_1/x.upload.jpg", mimeType: "image/jpeg" }];
    expect((await request("med_ready", `?t=${TOKEN}`)).status).toBe(404);
  });

  it("never serves a row marked for purge, even while it is still READY", async () => {
    media.push({ ...media[0]!, id: "med_marked", mimeType: "audio/mp4", storageKey: "originals/mem_1/m.m4a", derivatives: [], purgedAt: new Date() });
    expect((await request("med_marked", `?t=${TOKEN}`)).status).toBe(404);
    expect((await request("med_marked", `?t=${TOKEN}&download=1`)).status).toBe(404);
    expect(presignMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });

  describe("a video's v=thumb is its POSTER or nothing (D7)", () => {
    const POSTER_BYTES = 120_000;
    const VIDEO_BYTES = 300 * MB;
    const poster = (over: Partial<NonNullable<MediaRow["derivatives"]>[number]> = {}) => ({ kind: "POSTER" as const, status: "READY" as const, storageKey: "derived/mem_1/poster.jpg", mimeType: "image/jpeg", sizeBytes: POSTER_BYTES, ...over });
    beforeEach(() => {
      media.push({ ...media[0]!, id: "med_video", sizeBytes: VIDEO_BYTES, mimeType: "video/mp4", storageKey: "originals/mem_1/v.mp4", originalFilename: "v.mp4", derivatives: [poster()] });
    });

    it("redirects to the poster and charges the poster's bytes to the thumb copy", async () => {
      const res = await request("med_video", `?t=${TOKEN}&v=thumb`, from("203.0.113.20"));
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://blob.test/derived/mem_1/poster.jpg?signed=1");
      expect(counterOf(mediaViewerScope("med_video", "thumb", "203.0.113.20"))).toBe(BigInt(1));
      expect(counterOf("media:med_video")).toBe(BigInt(POSTER_BYTES));
      expect(counterOf("global")).toBe(BigInt(POSTER_BYTES));
      expect(presignMock).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: "originals/mem_1/v.mp4" }));
    });

    it("404s without a READY poster and never presigns the original", async () => {
      for (const derivatives of [[], [poster({ status: "PENDING" })], [poster({ status: "FAILED" })]]) {
        media.find((m) => m.id === "med_video")!.derivatives = derivatives;
        expect((await request("med_video", `?t=${TOKEN}&v=thumb`)).status).toBe(404);
      }
      expect(presignMock).not.toHaveBeenCalled();
      expect(counterOf("global")).toBe(BigInt(0));
    });

    it("404s a poster that points at a browser-staged key", async () => {
      media.find((m) => m.id === "med_video")!.derivatives = [poster({ storageKey: "derived/mem_1/x.upload.jpg" })];
      expect((await request("med_video", `?t=${TOKEN}&v=thumb`)).status).toBe(404);
      expect(presignMock).not.toHaveBeenCalled();
    });

    it("leaves v=web and no v on the original, and download=1 with v=thumb on the original download", async () => {
      expect((await request("med_video", `?t=${TOKEN}&v=web`)).headers.get("location")).toBe("https://blob.test/originals/mem_1/v.mp4?signed=1");
      expect((await request("med_video", `?t=${TOKEN}`)).headers.get("location")).toBe("https://blob.test/originals/mem_1/v.mp4?signed=1");
      const download = await request("med_video", `?t=${TOKEN}&v=thumb&download=1`);
      expect(download.status).toBe(302);
      expect(download.headers.get("location")).toBe("https://blob.test/originals/mem_1/v.mp4?signed=1&download=1");
    });
  });

  it("keeps serving audio and video originals inline", async () => {
    media.push({ ...media[0]!, id: "med_audio", mimeType: "audio/mp4", storageKey: "originals/mem_1/v.m4a", derivatives: [] });
    expect((await request("med_audio", `?t=${TOKEN}`)).headers.get("location")).toBe("https://blob.test/originals/mem_1/v.m4a?signed=1");
  });

});

describe("egress allowance (issue #45, review cycle 2): one charge per file, copy, viewer and day; requests capped per viewer", () => {
  const VIDEO = 300 * MB;
  beforeEach(() => {
    media.push({ ...media[0]!, id: "med_video", sizeBytes: VIDEO, mimeType: "video/mp4", storageKey: "originals/mem_1/v.mp4", originalFilename: "v.mp4", derivatives: [] });
  });

  it("iOS: a probe, the first range, later ranges, seeks and reloads of one video from one phone cost one charge and never 429", async () => {
    const phone = "203.0.113.10";
    const sequence = ["bytes=0-1", "bytes=0-", "bytes=1048576-", "bytes=52428800-", "bytes=0-", "bytes=104857600-", "bytes=0-1", "bytes=0-", "bytes=209715200-", "bytes=0-"];
    for (const range of sequence) {
      expect((await request("med_video", `?t=${TOKEN}`, from(phone, range))).status).toBe(302);
    }
    for (let reload = 0; reload < 20; reload += 1) {
      expect((await request("med_video", `?t=${TOKEN}`, from(phone, "bytes=0-"))).status).toBe(302);
    }
    expect(counterOf("media:med_video")).toBe(BigInt(VIDEO));
    expect(counterOf("global")).toBe(BigInt(VIDEO));
  });

  it("Chrome: restarted ranged requests after a cached redirect, plus the download link, from one laptop: still one charge per copy", async () => {
    const laptop = "198.51.100.7";
    for (const range of ["bytes=0-", "bytes=0-", "bytes=0-", "bytes=33554432-", "bytes=0-"]) {
      expect((await request("med_video", `?t=${TOKEN}`, from(laptop, range))).status).toBe(302);
    }
    expect((await request("med_video", `?t=${TOKEN}&download=1`, from(laptop))).status).toBe(302);
    expect(counterOf("media:med_video")).toBe(BigInt(VIDEO));
  });

  it("a contributor plus a few relatives on phones and laptops, all day, cost one charge each and never 429", async () => {
    const people = ["203.0.113.10", "203.0.113.11", "198.51.100.7", "192.0.2.44", "192.0.2.45", "2001:db8::1"];
    for (let round = 0; round < 10; round += 1) {
      for (const ip of people) {
        for (const range of ["bytes=0-1", "bytes=0-", "bytes=10485760-"]) {
          expect((await request("med_video", `?t=${TOKEN}`, from(ip, range))).status).toBe(302);
        }
        expect((await request("med_ready", `?t=${TOKEN}`, from(ip))).status).toBe(302);
      }
    }
    expect(counterOf("media:med_video")).toBe(BigInt(people.length) * BigInt(VIDEO));
    // The site-wide counter sees the same: a popular video costs viewers × size per day, not requests × size.
    expect(counterOf("global")).toBeLessThan(BigInt(people.length) * BigInt(VIDEO) + BigInt(people.length) * BigInt(1024));
  });

  it("abuse: a claim link published to the world is bounded by distinct viewers × size (the file's multiple), then 429", async () => {
    media.push({ ...media[0]!, id: "med_big", sizeBytes: 500 * MB, mimeType: "video/mp4", storageKey: "originals/mem_1/big.mp4", derivatives: [] });
    let served = 0;
    let refused = 0;
    for (let n = 0; n < 60; n += 1) {
      const res = await request("med_big", `?t=${TOKEN}`, from(`203.0.113.${n}`));
      if (res.status === 302) { served += 1; } else { expect(res.status).toBe(429); refused += 1; }
    }
    // Unapproved default: 50 viewer-days of 500 MB = 25 GB for this file today; the 51st viewer waits for tomorrow.
    expect(served).toBe(50);
    expect(refused).toBe(10);
    expect(counterOf("media:med_big")).toBe(BigInt(50) * BigInt(500 * MB));
  });

  it("abuse: one address looping on one file is bounded by the per-viewer daily request cap, then 429", async () => {
    process.env.MEDIA_VIEWER_DAILY_REQUESTS = "40";
    resetEnvCache();
    let served = 0;
    for (let n = 0; n < 45; n += 1) {
      if ((await request("med_video", `?t=${TOKEN}`, from("203.0.113.99", "bytes=1-"))).status === 302) { served += 1; }
    }
    expect(served).toBe(40);
    const res = await request("med_video", `?t=${TOKEN}`, from("203.0.113.99", "bytes=1-"));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // Still one charge: a loop does not multiply the bytes counted against the file.
    expect(counterOf("media:med_video")).toBe(BigInt(VIDEO));
  });

  it("the site-wide ceiling is the last line: when it refuses, the file's and the viewer's reservations are given back so the next try is honest", async () => {
    process.env.MEDIA_DAILY_EGRESS_BYTES = String(VIDEO - 1);
    resetEnvCache();
    const res = await request("med_video", `?t=${TOKEN}`, from("203.0.113.5"));
    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(counterOf("media:med_video")).toBe(BigInt(0));
    expect(counterOf(mediaViewerScope("med_video", "original", "203.0.113.5"))).toBe(BigInt(0));
    expect(presignMock).not.toHaveBeenCalled();
  });

  it("each copy is its own charge, at its own size: thumbnail, web copy and original of one photo", async () => {
    media[0]!.sizeBytes = 5 * MB;
    media[0]!.derivatives![0]!.sizeBytes = 400_000;
    media[0]!.derivatives![1]!.sizeBytes = 50_000;
    const ip = "203.0.113.5";
    for (let n = 0; n < 3; n += 1) {
      expect((await request("med_ready", `?t=${TOKEN}&v=thumb`, from(ip))).status).toBe(302);
      expect((await request("med_ready", `?t=${TOKEN}`, from(ip))).status).toBe(302);
      expect((await request("med_ready", `?t=${TOKEN}&v=original`, from(ip))).status).toBe(302);
    }
    expect(counterOf("media:med_ready")).toBe(BigInt(50_000 + 400_000 + 5 * MB));
    expect(counterOf(mediaViewerScope("med_ready", "thumb", ip))).toBe(BigInt(3));
  });

  it("an APPROVED memory gets the larger multiple; ceilings and the viewer cap come from the environment", async () => {
    process.env.MEDIA_FILE_DAILY_MULTIPLE = "2";
    process.env.MEDIA_FILE_DAILY_MULTIPLE_UNAPPROVED = "1";
    resetEnvCache();
    expect((await request("med_video", `?t=${TOKEN}`, from("203.0.113.1"))).status).toBe(302);
    expect((await request("med_video", `?t=${TOKEN}`, from("203.0.113.2"))).status).toBe(429);
    media.find((m) => m.id === "med_video")!.memory.status = "APPROVED";
    expect((await request("med_video", `?t=${TOKEN}`, from("203.0.113.2"))).status).toBe(302);
    expect((await request("med_video", `?t=${TOKEN}`, from("203.0.113.3"))).status).toBe(429);
  });

  it("never touches a counter before the token, status and visibility checks pass", async () => {
    await request("med_ready", "");
    await request("med_ready", `?t=${"A".repeat(TOKEN.length)}`);
    await request("med_pending", `?t=${TOKEN}`);
    await request("med_deleted", `?t=${TOKEN}`);
    expect(counterCalls).toHaveLength(0);
  });

  it("fails open: a counter error is logged and the file is still served (a cost control must not take the site down)", async () => {
    queryRawMock.mockRejectedValueOnce(new Error("connection reset"));
    const res = await request("med_ready", `?t=${TOKEN}`, from("203.0.113.5"));
    expect(res.status).toBe(302);
    executeRawMock.mockRejectedValueOnce(new Error("connection reset"));
    expect((await request("med_video", `?t=${TOKEN}`, from("203.0.113.6"))).status).toBe(302);
  });

  it("a request with no usable address still works, sharing the 'unknown' viewer", async () => {
    expect((await request("med_video", `?t=${TOKEN}`)).status).toBe(302);
    expect(counterOf(mediaViewerScope("med_video", "original", "unknown"))).toBe(BigInt(1));
  });
});

describe("downloads keep behaving as on main (review cycle 2, M1)", () => {
  it("streams photo-sized downloads (up to 25 MiB) through the function with the sanitized attachment filename", async () => {
    media.push({ ...media[0]!, id: "med_8mb", sizeBytes: 8 * MB });
    getMock.mockResolvedValueOnce({ stream: new Blob(["x"]).stream(), contentType: "image/jpeg", contentLength: 8 * MB });
    const res = await request("med_8mb", `?t=${TOKEN}&download=1`, from("203.0.113.5"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename=/);
  });

  it("redirects larger downloads with the blob host's download switch, so the browser saves instead of playing", async () => {
    media.push({ ...media[0]!, id: "med_big", sizeBytes: 200 * MB, mimeType: "video/mp4", storageKey: "originals/mem_1/big.mp4", derivatives: [] });
    const res = await request("med_big", `?t=${TOKEN}&download=1`, from("203.0.113.5"));
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("download")).toBe("1");
    expect(location.searchParams.get("signed")).toBe("1");
    expect(getMock).not.toHaveBeenCalled();
    // Inline views carry no download switch.
    const inline = new URL((await request("med_big", `?t=${TOKEN}`, from("203.0.113.5"))).headers.get("location")!);
    expect(inline.searchParams.get("download")).toBeNull();
  });

  it("honours MEDIA_PROXY_DOWNLOAD_MAX_BYTES", async () => {
    process.env.MEDIA_PROXY_DOWNLOAD_MAX_BYTES = "4";
    resetEnvCache();
    expect((await request("med_ready", `?t=${TOKEN}&download=1`, from("203.0.113.5"))).status).toBe(302);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("lets the browser reuse a redirect for the presign window; streams and refusals stay uncacheable", async () => {
    expect((await request("med_ready", `?t=${TOKEN}&v=original`, from("203.0.113.5"))).headers.get("cache-control")).toBe("private, max-age=55");
    expect((await request("med_ready", `?t=${TOKEN}&download=1`, from("203.0.113.5"))).headers.get("cache-control")).toBe("private, no-store");
  });
});
