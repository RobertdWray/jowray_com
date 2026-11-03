import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashClaimToken } from "@/lib/claim-token";

const TOKEN = "AbCdEf0123456789_-AbCdEf0123456789_-AbCdEf0";

interface MediaRow {
  id: string;
  status: "PENDING" | "READY" | "FAILED";
  mimeType: string;
  storageKey: string;
  originalFilename: string | null;
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
      status: "READY",
      mimeType: "image/jpeg",
      storageKey: "originals/mem_1/abc.jpg",
      originalFilename: 'photo "one"\r\nBcc.jpg',
      memory: { claimTokenHash: hashClaimToken(TOKEN), deletedAt: null },
    },
    { ...{} as MediaRow, id: "med_pending", status: "PENDING", mimeType: "video/mp4", storageKey: "originals/mem_1/p.mp4", originalFilename: null, memory: { claimTokenHash: hashClaimToken(TOKEN), deletedAt: null } },
    { ...{} as MediaRow, id: "med_deleted", status: "READY", mimeType: "image/png", storageKey: "originals/mem_2/d.png", originalFilename: null, memory: { claimTokenHash: hashClaimToken(TOKEN), deletedAt: new Date() } },
  ];
  presignMock.mockClear();
});

describe("GET /api/media/[id]", () => {
  it("404s without a token, with a wrong token, for PENDING media, for deleted memories and unknown ids", async () => {
    expect((await request("med_ready", "")).status).toBe(404);
    expect((await request("med_ready", "?t=wrong")).status).toBe(404);
    expect((await request("med_pending", `?t=${TOKEN}`)).status).toBe(404);
    expect((await request("med_deleted", `?t=${TOKEN}`)).status).toBe(404);
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
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
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
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition).not.toContain('""');
    expect(await res.text()).toBe("jpegbytes");
  });
});
