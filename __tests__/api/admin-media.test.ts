import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_COOKIE, mintAdminCookie } from "@/features/admin/session";
import { resetEnvCache } from "@/server/config/env";

const SECRET = "s".repeat(40);

interface MediaRow {
  id: string;
  sizeBytes: number | null;
  status: "PENDING" | "READY" | "FAILED";
  mimeType: string;
  storageKey: string;
  originalFilename: string | null;
  deletedAt: Date | null;
  derivatives?: Array<{ kind: "WEB_IMAGE" | "THUMBNAIL" | "POSTER"; status: "PENDING" | "READY" | "FAILED"; storageKey: string; mimeType: string | null }>;
  memory: { claimTokenHash: string; deletedAt: Date | null };
}
let media: MediaRow[] = [];
const dbStub = {
  media: {
    findUnique: vi.fn(async ({ where, include }: { where: { id: string }; include?: { derivatives?: { where?: { status?: string } } } }) => {
      const row = media.find((m) => m.id === where.id);
      if (!row) { return null; }
      const wanted = include?.derivatives?.where?.status;
      return { ...row, derivatives: (row.derivatives ?? []).filter((d) => !wanted || d.status === wanted) };
    }),
  },
};
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));
const presignMock = vi.fn(async ({ pathname }: { pathname: string; validUntil: number }) => ({ url: `https://blob.test/${pathname}?signed=1`, expiresAt: new Date(Date.now() + 60_000) }));
vi.mock("@/services/storage", () => ({ createStorageService: () => ({ presignGet: presignMock, get: vi.fn(), head: vi.fn(), del: vi.fn(), put: vi.fn() }) }));

import { GET } from "@/app/admin/media/[id]/route";

function request(id: string, query = "", cookie?: string) {
  const req = new NextRequest(`http://localhost:3000/admin/media/${id}${query}`, { headers: cookie === undefined ? {} : { cookie: `${ADMIN_COOKIE}=${cookie}` } });
  return GET(req, { params: Promise.resolve({ id }) });
}

const saved = { ADMIN_PAGE_SECRET: process.env.ADMIN_PAGE_SECRET };
beforeEach(() => {
  process.env.ADMIN_PAGE_SECRET = SECRET;
  resetEnvCache();
  media = [
    { id: "med_ready", sizeBytes: 9, status: "READY", mimeType: "image/jpeg", storageKey: "originals/mem_1/abc.jpg", originalFilename: "a.jpg", deletedAt: null, derivatives: [{ kind: "WEB_IMAGE", status: "READY", storageKey: "derived/mem_1/web.jpg", mimeType: "image/jpeg" }, { kind: "THUMBNAIL", status: "READY", storageKey: "derived/mem_1/thumb.jpg", mimeType: "image/jpeg" }], memory: { claimTokenHash: "h".repeat(64), deletedAt: null } },
    { id: "med_of_deleted_memory", sizeBytes: 9, status: "READY", mimeType: "audio/mp4", storageKey: "originals/mem_2/v.m4a", originalFilename: null, deletedAt: null, derivatives: [], memory: { claimTokenHash: "h".repeat(64), deletedAt: new Date() } },
    { id: "med_removed", sizeBytes: 9, status: "READY", mimeType: "image/png", storageKey: "originals/mem_1/r.png", originalFilename: null, deletedAt: new Date(), derivatives: [], memory: { claimTokenHash: "h".repeat(64), deletedAt: null } },
    { id: "med_purged", sizeBytes: 9, status: "FAILED", mimeType: "image/png", storageKey: "originals/mem_1/p.png", originalFilename: null, deletedAt: null, derivatives: [], memory: { claimTokenHash: "h".repeat(64), deletedAt: null } },
  ];
  presignMock.mockClear();
});
afterEach(() => {
  if (saved.ADMIN_PAGE_SECRET === undefined) { delete process.env.ADMIN_PAGE_SECRET; } else { process.env.ADMIN_PAGE_SECRET = saved.ADMIN_PAGE_SECRET; }
  resetEnvCache();
});

describe("GET /admin/media/[id] (V13)", () => {
  it("404s with no cookie, a wrong cookie, an expired cookie, or the secret unset, never touching storage", async () => {
    expect((await request("med_ready")).status).toBe(404);
    expect((await request("med_ready", "", "garbage")).status).toBe(404);
    expect((await request("med_ready", "", mintAdminCookie(Date.now() - 31 * 24 * 60 * 60 * 1000))).status).toBe(404);
    const cookie = mintAdminCookie();
    delete process.env.ADMIN_PAGE_SECRET;
    resetEnvCache();
    expect((await request("med_ready", "", cookie)).status).toBe(404);
    expect(presignMock).not.toHaveBeenCalled();
    expect(dbStub.media.findUnique).not.toHaveBeenCalled();
  });

  it("redirects to the presigned web copy with the protective headers, and to the thumbnail for v=thumb", async () => {
    const cookie = mintAdminCookie();
    const res = await request("med_ready", "", cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://blob.test/derived/mem_1/web.jpg?signed=1");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await request("med_ready", "?v=thumb", cookie)).headers.get("location")).toBe("https://blob.test/derived/mem_1/thumb.jpg?signed=1");
  });

  it("serves a deleted memory's media (the page where Restore is decided), but never a removed or purged row", async () => {
    const cookie = mintAdminCookie();
    const res = await request("med_of_deleted_memory", "", cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://blob.test/originals/mem_2/v.m4a?signed=1");
    expect((await request("med_removed", "", cookie)).status).toBe(404);
    expect((await request("med_purged", "", cookie)).status).toBe(404);
    expect((await request("nope", "", cookie)).status).toBe(404);
  });
});
