/**
 * The review version on real Postgres (TCR round 1, B1-3): the version `getMemoryForAdmin` hands out is the one
 * `setMemoryStatusAsAdmin` recomputes under the lock, so an approval of what was read goes through, and a file added
 * or a name changed in between answers `stale` with nothing written. The feature tests mock the database; only
 * Postgres shows the two reads select the same rows and the stored timestamps round-trip to the same string.
 *
 * Runs only when TEST_DATABASE_URL names a database at the repo's latest migration (CI provides one); never reads the
 * app's DATABASE_URL. Every write runs inside a transaction that is always rolled back; the feature's own transaction
 * nests as a savepoint (Prisma 7.10).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it, vi } from "vitest";

import { getMemoryForAdmin } from "@/features/admin/get-memory";
import { setMemoryStatusAsAdmin } from "@/features/admin/set-status";
import { PrismaClient } from "@/generated/prisma/client";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) {
  throw new Error("TEST_DATABASE_URL is not set in CI; the review-version suite must run there");
}
const client = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) : null;
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
let current: Tx | null = null;
vi.mock("@/server/db/client", () => ({ getDb: () => current }));

afterAll(async () => {
  await client?.$disconnect();
});

class RolledBack extends Error {}

async function inRolledBackTx<T>(body: (tx: Tx, memorialId: string) => Promise<T>): Promise<T> {
  let result: T | undefined;
  try {
    await client!.$transaction(async (tx) => {
      current = tx;
      try {
        const memorial = await tx.memorial.create({ data: { name: "Review version test", slug: `review-version-${crypto.randomUUID()}` } });
        result = await body(tx, memorial.id);
      } finally {
        current = null;
      }
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) {
      throw error;
    }
  }
  return result as T;
}

async function pendingMemory(tx: Tx, memorialId: string) {
  const contributor = await tx.contributor.create({ data: { memorialId, name: "Jo", relationship: "friend" } });
  const memory = await tx.memory.create({
    data: { memorialId, contributorId: contributor.id, type: "PHOTO", source: "WEB_UPLOAD", status: "PENDING", consentVersion: "review-test", consentedAt: new Date("2026-11-07T12:00:00Z"), contributorNote: "words", claimTokenHash: crypto.randomUUID().replaceAll("-", "").padEnd(64, "0") },
    select: { id: true },
  });
  await tx.media.create({ data: { memoryId: memory.id, storageKey: `test/review-version/${crypto.randomUUID()}.jpg`, mimeType: "image/jpeg", maxBytes: 1024, status: "READY" } });
  return { memoryId: memory.id, contributorId: contributor.id };
}

describe.skipIf(!client)("approval and the review version (real Postgres, B1-3)", () => {
  it("approves with the version getMemoryForAdmin handed out", async () => {
    const outcome = await inRolledBackTx(async (tx, memorialId) => {
      const { memoryId } = await pendingMemory(tx, memorialId);
      const read = (await getMemoryForAdmin(memoryId))!.reviewVersion;
      const result = await setMemoryStatusAsAdmin({ memoryId, status: "APPROVED", reviewVersion: read });
      return { result, status: (await tx.memory.findUniqueOrThrow({ where: { id: memoryId }, select: { status: true } })).status };
    });
    expect(outcome).toEqual({ result: { ok: true }, status: "APPROVED" });
  });

  it.each([
    ["a file was added", async (tx: Tx, ids: { memoryId: string }) => { await tx.media.create({ data: { memoryId: ids.memoryId, storageKey: `test/review-version/${crypto.randomUUID()}.mov`, mimeType: "video/quicktime", maxBytes: 1024 } }); }],
    ["the contributor's name changed", async (tx: Tx, ids: { contributorId: string }) => {
      // @updatedAt is stamped by the client in milliseconds; a later stamp keeps the case independent of how fast the run is.
      await tx.contributor.update({ where: { id: ids.contributorId }, data: { name: "Jo Friend", updatedAt: new Date(Date.now() + 1000) } });
    }],
  ])("answers stale and writes nothing when %s after the read", async (_what, change) => {
    const outcome = await inRolledBackTx(async (tx, memorialId) => {
      const ids = await pendingMemory(tx, memorialId);
      const read = (await getMemoryForAdmin(ids.memoryId))!.reviewVersion;
      await change(tx, ids);
      const result = await setMemoryStatusAsAdmin({ memoryId: ids.memoryId, status: "APPROVED", reviewVersion: read });
      const row = await tx.memory.findUniqueOrThrow({ where: { id: ids.memoryId }, select: { status: true, revisions: { select: { id: true } } } });
      return { result, status: row.status, revisions: row.revisions.length };
    });
    expect(outcome).toEqual({ result: { ok: false, code: "stale" }, status: "PENDING", revisions: 0 });
  });
});
