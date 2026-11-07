import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reservePendingMedia, type ResolvedFile } from "@/features/memories/create-memory";
import type { Tx } from "@/features/memories/lock";
import { resetEnvCache } from "@/server/config/env";

vi.mock("@/server/db/client", () => ({ getDb: () => { throw new Error("reservation helpers must use the caller's transaction"); } }));

const tx = {
  $executeRaw: vi.fn(async () => 1),
  $queryRaw: vi.fn(async () => [{ memoriesToday: 0, bytesToday: 0, storedBytes: 0, derivedBytes: 0, openBytes: 0 }]),
  media: {
    count: vi.fn(async () => 0),
    create: vi.fn(async () => ({ id: "med_admin" })),
  },
};
const file: ResolvedFile = {
  mimeType: "image/jpeg",
  maxBytes: 25 * 1024 * 1024,
  extension: "jpg",
  originalFilename: "photo.jpg",
  durationSeconds: null,
  caption: "At the beach",
  approxDateText: "Summer 1998",
  place: "Brighton",
};
const declaredSha256 = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("UPLOAD_TICKET_SECRET", "s".repeat(32));
  vi.stubEnv("DAILY_BYTE_BUDGET", "1024");
  vi.stubEnv("TOTAL_BYTE_CEILING", "1024");
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("reservePendingMedia with an admin declaration", () => {
  it("reserves the explicit size in the budget, row and grant, and stores the provenance", async () => {
    const result = await reservePendingMedia(tx as unknown as Tx, {
      memoryId: "mem_admin", file, maxBytes: 1024, addedVia: "ADMIN", declaredSha256,
    });

    expect(typeof result).toBe("object");
    if (typeof result === "string") { throw new Error(`unexpected refusal: ${result}`); }
    expect(result.ticket.maxBytes).toBe(1024);
    expect(tx.media.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        memoryId: "mem_admin", maxBytes: 1024, addedVia: "ADMIN", declaredSha256,
        caption: "At the beach", approxDateText: "Summer 1998", place: "Brighton",
      }),
    });
    expect(file.maxBytes).toBe(25 * 1024 * 1024);
  });

  it("refuses a declaration that exceeds the remaining budget without creating a row", async () => {
    const result = await reservePendingMedia(tx as unknown as Tx, {
      memoryId: "mem_admin", file, maxBytes: 1025, addedVia: "ADMIN", declaredSha256,
    });

    expect(result).toBe("budget_exceeded");
    expect(tx.media.create).not.toHaveBeenCalled();
  });
});
