import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/server/config/env";

interface MediaRow {
  id: string;
  memoryId: string;
  storageKey: string;
  mimeType: string;
  maxBytes: number;
  status: "PENDING" | "READY" | "FAILED";
  sizeBytes: number | null;
  blobUrl: string | null;
  checksumSha256: string | null;
  memory: { deletedAt: Date | null };
}
let media: MediaRow[] = [];
let p2002Once = false;
const dbStub = {
  media: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => media.find((m) => m.id === where.id) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string; status?: "PENDING" }; data: Partial<MediaRow> }) => {
      const row = media.find((m) => m.id === where.id);
      if (!row || (where.status && row.status !== where.status)) {
        const err = Object.assign(new Error("Record to update not found."), { code: "P2025" });
        throw err;
      }
      if (p2002Once) {
        p2002Once = false;
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      Object.assign(row, data);
      return row;
    }),
  },
};
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));

const headMock = vi.fn();
const delMock = vi.fn();
vi.mock("@/services/storage", () => ({
  createStorageService: () => ({ head: headMock, del: delMock, get: vi.fn(), put: vi.fn(), presignGet: vi.fn() }),
}));

import { recordMedia } from "@/features/memories/ingest-upload";

function row(over: Partial<MediaRow> = {}): MediaRow {
  return {
    id: "med_1",
    memoryId: "mem_1",
    storageKey: "originals/mem_1/abc.jpg",
    mimeType: "image/jpeg",
    maxBytes: 25 * 1024 * 1024,
    status: "PENDING",
    sizeBytes: null,
    blobUrl: null,
    checksumSha256: null,
    memory: { deletedAt: null },
    ...over,
  };
}

beforeEach(() => {
  media = [row()];
  p2002Once = false;
  headMock.mockReset();
  delMock.mockReset();
  headMock.mockResolvedValue({
    pathname: "originals/mem_1/abc.jpg",
    url: "https://blob.test/originals/mem_1/abc.jpg",
    size: 1234,
    contentType: "image/jpeg",
    uploadedAt: new Date(),
  });
  resetEnvCache();
});

describe("recordMedia", () => {
  it("marks a PENDING row READY from head() by pathname and is idempotent", async () => {
    const first = await recordMedia({ mediaId: "med_1" });
    expect(first).toEqual({ status: "READY", mediaId: "med_1", memoryId: "mem_1", sizeBytes: 1234 });
    expect(headMock).toHaveBeenCalledWith("originals/mem_1/abc.jpg");
    expect(media[0]?.status).toBe("READY");
    expect(media[0]?.blobUrl).toBe("https://blob.test/originals/mem_1/abc.jpg");

    const second = await recordMedia({ mediaId: "med_1" });
    expect(second.status).toBe("READY");
    expect(headMock).toHaveBeenCalledTimes(1);
  });

  it("leaves the row PENDING when the blob is not there yet", async () => {
    headMock.mockResolvedValue(null);
    expect(await recordMedia({ mediaId: "med_1" })).toEqual({ status: "PENDING", mediaId: "med_1", memoryId: "mem_1" });
    expect(media[0]?.status).toBe("PENDING");
  });

  it("fails and deletes the blob when it is too large or the wrong type", async () => {
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 26 * 1024 * 1024, contentType: "image/jpeg", uploadedAt: new Date() });
    expect((await recordMedia({ mediaId: "med_1" })).status).toBe("FAILED");
    expect(delMock).toHaveBeenCalledWith("originals/mem_1/abc.jpg");

    media = [row()];
    headMock.mockResolvedValue({ pathname: "originals/mem_1/abc.jpg", url: "u", size: 10, contentType: "text/html", uploadedAt: new Date() });
    expect((await recordMedia({ mediaId: "med_1" })).status).toBe("FAILED");
    expect(delMock).toHaveBeenCalledTimes(2);
  });

  it("ignores soft-deleted memories and unknown ids", async () => {
    media = [row({ memory: { deletedAt: new Date() } })];
    expect(await recordMedia({ mediaId: "med_1" })).toEqual({ status: "NOT_FOUND", mediaId: "med_1" });
    expect(await recordMedia({ mediaId: "nope" })).toEqual({ status: "NOT_FOUND", mediaId: "nope" });
    expect(headMock).not.toHaveBeenCalled();
  });

  it("survives a concurrent writer: a lost race re-reads the row and never throws", async () => {
    p2002Once = true;
    const results = await Promise.all([recordMedia({ mediaId: "med_1" }), recordMedia({ mediaId: "med_1" })]);
    expect(results.map((r) => r.status).sort()).toEqual(["READY", "READY"]);
    expect(media).toHaveLength(1);
  });
});
