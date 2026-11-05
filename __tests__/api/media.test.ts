import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { attachmentDisposition } from "@/lib/media-types";
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
/** Every counter statement; the SQL text and its bound values, so tests can see scope, bytes and ceiling. */
const counterCalls: Array<{ sql: string; values: unknown[] }> = [];
/** A counter statement that records itself and answers `changed` rows (1 = reserved, 0 = ceiling held). */
const counter = (changed: number) => async (strings: TemplateStringsArray, ...values: unknown[]) => { counterCalls.push({ sql: strings.join("?"), values }); return changed; };
const executeRawMock = vi.fn(counter(1));
const dbStub = {
  $executeRaw: executeRawMock,
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
  executeRawMock.mockImplementation(counter(1));
  counterCalls.length = 0;
  for (const key of ["MEDIA_FILE_DAILY_MULTIPLE", "MEDIA_FILE_DAILY_MULTIPLE_UNAPPROVED", "MEDIA_DAILY_EGRESS_BYTES", "MEDIA_PROXY_DOWNLOAD_MAX_BYTES"]) { delete process.env[key]; }
  resetEnvCache();
});

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

  it("keeps serving audio and video originals inline", async () => {
    media.push({ ...media[0]!, id: "med_audio", mimeType: "audio/mp4", storageKey: "originals/mem_1/v.m4a", derivatives: [] });
    expect((await request("med_audio", `?t=${TOKEN}`)).headers.get("location")).toBe("https://blob.test/originals/mem_1/v.m4a?signed=1");
  });

});

describe("egress allowance (issue #45)", () => {
  const ready = () => media[0]!;

  it("charges the served copy's size to the file's counter, then the site's, before anything is presigned", async () => {
    ready().derivatives![0]!.sizeBytes = 4;
    const res = await request("med_ready", `?t=${TOKEN}`);
    expect(res.status).toBe(302);
    expect(counterCalls).toHaveLength(2);
    const [file, site] = counterCalls;
    expect(file!.sql).toMatch(/INSERT INTO "EgressCounter"[\s\S]*ON CONFLICT[\s\S]*<= /);
    expect(file!.values).toEqual(["media:med_ready", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), BigInt(4), BigInt(10 * 9)]);
    expect(site!.values).toEqual(["global", expect.any(String), BigInt(4), BigInt(50 * 1024 ** 3)]);
    expect(executeRawMock.mock.invocationCallOrder[1]!).toBeLessThan(presignMock.mock.invocationCallOrder[0]!);
  });

  it("uses the original's size for downloads and v=original, and the larger multiple once the memory is APPROVED", async () => {
    ready().memory.status = "APPROVED";
    await request("med_ready", `?t=${TOKEN}&v=original`);
    expect(counterCalls[0]!.values).toEqual(["media:med_ready", expect.any(String), BigInt(9), BigInt(20 * 9)]);
    counterCalls.length = 0;
    await request("med_ready", `?t=${TOKEN}&download=1`);
    expect(counterCalls[0]!.values[2]).toBe(BigInt(9));
  });

  it("answers 429 with Retry-After when the file's allowance is spent; nothing is streamed or presigned", async () => {
    executeRawMock.mockImplementationOnce(counter(0));
    const res = await request("med_ready", `?t=${TOKEN}&download=1`);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(res.headers.get("retry-after"))).toBeLessThanOrEqual(86_400);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(getMock).not.toHaveBeenCalled();
    expect(presignMock).not.toHaveBeenCalled();
    expect(counterCalls).toHaveLength(1);
  });

  it("gives the file's reservation back when the site's allowance refuses", async () => {
    executeRawMock.mockImplementationOnce(counter(1)).mockImplementationOnce(counter(0));
    const res = await request("med_ready", `?t=${TOKEN}`);
    expect(res.status).toBe(429);
    expect(counterCalls).toHaveLength(3);
    expect(counterCalls[2]!.sql).toMatch(/UPDATE "EgressCounter"[\s\S]*GREATEST/);
    expect(counterCalls[2]!.values).toContain("media:med_ready");
  });

  it("never charges anything before the token, status and visibility checks pass (no counter row for refused requests)", async () => {
    await request("med_ready", "");
    await request("med_ready", `?t=${"A".repeat(TOKEN.length)}`);
    await request("med_pending", `?t=${TOKEN}`);
    await request("med_deleted", `?t=${TOKEN}`);
    expect(counterCalls).toHaveLength(0);
  });

  it("reads the ceilings from the environment", async () => {
    process.env.MEDIA_FILE_DAILY_MULTIPLE_UNAPPROVED = "3";
    process.env.MEDIA_DAILY_EGRESS_BYTES = "1000";
    resetEnvCache();
    await request("med_ready", `?t=${TOKEN}&v=original`);
    expect(counterCalls[0]!.values[3]).toBe(BigInt(3 * 9));
    expect(counterCalls[1]!.values[3]).toBe(BigInt(1000));
  });

  it("refuses without a statement when one response alone would exceed the ceiling", async () => {
    process.env.MEDIA_DAILY_EGRESS_BYTES = "5";
    resetEnvCache();
    const res = await request("med_ready", `?t=${TOKEN}&v=original`);
    expect(res.status).toBe(429);
    // file counter reserved, site refused without a round trip, file released
    expect(counterCalls.map((c) => c.sql.includes("GREATEST"))).toEqual([false, true]);
  });
});

describe("proxy download cap (issue #45: the double-billed path is small and env-driven)", () => {
  it("redirects a 3 MB photo download instead of streaming it, and still streams a small one", async () => {
    media.push({ ...media[0]!, id: "med_3mb", sizeBytes: 3 * 1024 * 1024 });
    const res = await request("med_3mb", `?t=${TOKEN}&download=1`);
    expect(res.status).toBe(302);
    expect(getMock).not.toHaveBeenCalled();
    expect((await request("med_ready", `?t=${TOKEN}&download=1`)).status).toBe(200);
  });

  it("honours MEDIA_PROXY_DOWNLOAD_MAX_BYTES", async () => {
    process.env.MEDIA_PROXY_DOWNLOAD_MAX_BYTES = "4";
    resetEnvCache();
    expect((await request("med_ready", `?t=${TOKEN}&download=1`)).status).toBe(302);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("lets the browser reuse a redirect for the presign window, so a media element's range requests cost one charge, not one each", async () => {
    const res = await request("med_ready", `?t=${TOKEN}&v=original`);
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("private, max-age=55");
    // Streams and refusals stay uncacheable.
    expect((await request("med_ready", `?t=${TOKEN}&download=1`)).headers.get("cache-control")).toBe("private, no-store");
    executeRawMock.mockImplementationOnce(counter(0));
    expect((await request("med_ready", `?t=${TOKEN}`)).headers.get("cache-control")).toBe("private, no-store");
  });
});
