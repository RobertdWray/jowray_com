import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";
import { attachmentDisposition } from "@/lib/media-types";

const TOKEN = "AbCdEf0123456789_-AbCdEf0123456789_-AbCdEf0";

interface MediaRow {
  id: string;
  sizeBytes: number | null;
  status: "PENDING" | "READY" | "FAILED";
  mimeType: string;
  storageKey: string;
  originalFilename: string | null;
  deletedAt: Date | null;
  memory: { claimTokenHash: string; deletedAt: Date | null };
}
let media: MediaRow[] = [];
const dbStub = {
  media: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => media.find((m) => m.id === where.id) ?? null),
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
      memory: { claimTokenHash: hashClaimToken(TOKEN), deletedAt: null },
    },
    { ...{} as MediaRow, id: "med_pending", sizeBytes: null, status: "PENDING", mimeType: "video/mp4", storageKey: "originals/mem_1/p.mp4", originalFilename: null, deletedAt: null, memory: { claimTokenHash: hashClaimToken(TOKEN), deletedAt: null } },
    { ...{} as MediaRow, id: "med_deleted", sizeBytes: 9, status: "READY", mimeType: "image/png", storageKey: "originals/mem_2/d.png", originalFilename: null, deletedAt: null, memory: { claimTokenHash: hashClaimToken(TOKEN), deletedAt: new Date() } },
    { ...{} as MediaRow, id: "med_removed", sizeBytes: 9, status: "READY", mimeType: "image/png", storageKey: "originals/mem_1/r.png", originalFilename: null, deletedAt: new Date(), memory: { claimTokenHash: hashClaimToken(TOKEN), deletedAt: null } },
  ];
  presignMock.mockClear();
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

  it("redirects READY media to a short-lived presigned url with the protective headers", async () => {
    const res = await request("med_ready", `?t=${TOKEN}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://blob.test/originals/mem_1/abc.jpg?signed=1");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(presignMock).toHaveBeenCalledWith(expect.objectContaining({ pathname: "originals/mem_1/abc.jpg" }));
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
    getMock.mockResolvedValueOnce({ stream: new Blob(["x"]).stream(), contentType: "video/mp4", contentLength: 200 * 1024 * 1024 });
    media.push({ ...media[0]!, id: "med_big", sizeBytes: 200 * 1024 * 1024, mimeType: "video/mp4", storageKey: "originals/mem_1/big.mp4" });
    const res = await request("med_big", `?t=${TOKEN}&download=1`);
    expect(res.status).toBe(302);
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
