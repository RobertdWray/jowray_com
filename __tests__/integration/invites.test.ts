/**
 * Real Postgres verifies invite uniqueness, idempotent imports, rotation and
 * read-only prefill. Every write rolls back; only TEST_DATABASE_URL is used.
 */
import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInvites } from "@/features/invites/create-invites";
import { getInvitePrefill } from "@/features/invites/resolve-invite";
import { PrismaClient } from "@/generated/prisma/client";
import { hashInviteToken, newInviteToken } from "@/lib/invite-token";
import { resetEnvCache } from "@/server/config/env";

const url = process.env.TEST_DATABASE_URL;
if (process.env.CI && !url) {
  throw new Error("TEST_DATABASE_URL is not set in CI; the invites suite must run there");
}
const client = url ? new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }) : null;
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
// Features use the rollback transaction; Prisma 7.10 nests their transactions as savepoints.
let current: Tx | null = null;
vi.mock("@/server/db/client", () => ({ getDb: () => current }));
class RolledBack extends Error {}

async function attempt(write: (tx: Tx, memorialId: string) => Promise<void>): Promise<unknown> {
  try {
    await client!.$transaction(async (tx) => {
      current = tx;
      try {
        const slug = `invites-${randomUUID()}`;
        const memorial = await tx.memorial.create({ data: { name: "Invite test memorial", slug } });
        vi.stubEnv("MEMORIAL_SLUG", slug);
        resetEnvCache();
        await write(tx, memorial.id);
      } finally {
        current = null;
      }
      throw new RolledBack();
    });
  } catch (error) {
    return error instanceof RolledBack ? null : error;
  }
  throw new Error("unreachable: the transaction always throws");
}

const rows = [
  { firstName: "Alice", lastName: "Example", email: "alice@example.com" },
  { firstName: "Bob", lastName: "Sample", email: "bob@example.com" },
  { firstName: "Casey", email: "casey@example.com" },
];

describe.skipIf(!client)("invite invariants (real Postgres)", () => {
  beforeEach(() => {
    vi.stubEnv("CONSENT_VERSION", "invite-test-v1");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://invites.example.com");
    resetEnvCache();
  });
  afterEach(() => { vi.unstubAllEnvs(); resetEnvCache(); });
  afterAll(async () => { await client!.$disconnect(); });

  it("enforces unique email within a memorial", async () => {
    const error = await attempt(async (tx, memorialId) => {
      await tx.invite.create({ data: { ...rows[0], memorialId, tokenHash: hashInviteToken(newInviteToken()) } });
      await tx.invite.create({ data: { ...rows[0], memorialId, tokenHash: hashInviteToken(newInviteToken()) } });
    });
    expect(error).toMatchObject({ code: "P2002" });
  });

  it("allows the same email in different memorials", async () => {
    const error = await attempt(async (tx, memorialId) => {
      const other = await tx.memorial.create({ data: { name: "Other test memorial", slug: `invites-${randomUUID()}` } });
      for (const id of [memorialId, other.id]) {
        await tx.invite.create({ data: { ...rows[0], memorialId: id, tokenHash: hashInviteToken(newInviteToken()) } });
      }
      expect(await tx.invite.count({ where: { memorialId: { in: [memorialId, other.id] } } })).toBe(2);
    });
    expect(error).toBeNull();
  });

  it("enforces unique tokenHash across memorials and emails", async () => {
    const error = await attempt(async (tx, memorialId) => {
      const other = await tx.memorial.create({ data: { name: "Other test memorial", slug: `invites-${randomUUID()}` } });
      const tokenHash = hashInviteToken(newInviteToken());
      await tx.invite.create({ data: { ...rows[0], memorialId, tokenHash } });
      await tx.invite.create({ data: { ...rows[1], memorialId: other.id, tokenHash } });
    });
    expect(error).toMatchObject({ code: "P2002" });
  });

  it("returns exists without a token on the second import and preserves the stored row", async () => {
    const error = await attempt(async (tx, memorialId) => {
      const [created] = await createInvites({ invites: [rows[0]] });
      expect(created.status).toBe("created");
      const before = await tx.invite.findMany({ where: { memorialId } });
      expect(await createInvites({ invites: [rows[0]] })).toEqual([{ index: 0, status: "exists" }]);
      expect(await tx.invite.findMany({ where: { memorialId } })).toEqual(before);
      expect(before).toHaveLength(1);
      expect(before[0].tokenHash).toBe(hashInviteToken(created.token!));
    });
    expect(error).toBeNull();
  });

  it("maps returned tokens to the correct emails with an existing middle row", async () => {
    const error = await attempt(async (tx, memorialId) => {
      const [middle] = await createInvites({ invites: [rows[1]] });
      const results = await createInvites({ invites: rows });
      expect(results.map(({ index, status }) => ({ index, status }))).toEqual([
        { index: 0, status: "created" }, { index: 1, status: "exists" }, { index: 2, status: "created" },
      ]);
      const stored = await tx.invite.findMany({ where: { memorialId } });
      expect(stored).toHaveLength(3);
      for (const index of [0, 1, 2]) {
        const token = index === 1 ? middle.token! : results[index].token!;
        expect(stored.find(({ email }) => email === rows[index].email)?.tokenHash).toBe(hashInviteToken(token));
      }
      expect(results[1]).toEqual({ index: 1, status: "exists" });
    });
    expect(error).toBeNull();
  });

  it("rotates the stored hash, invalidates the old link and preserves the other fields", async () => {
    const error = await attempt(async (tx, memorialId) => {
      const [created] = await createInvites({ invites: [rows[0]] });
      const before = await tx.invite.findUniqueOrThrow({ where: { memorialId_email: { memorialId, email: rows[0].email } } });
      const [rotated] = await createInvites({ invites: [rows[0]], rotate: true });
      expect(rotated).toEqual({ index: 0, status: "rotated", token: expect.any(String), shareUrl: `https://invites.example.com/s/${rotated.token}` });
      expect(rotated.token).not.toBe(created.token);
      expect(await tx.invite.findUniqueOrThrow({ where: { id: before.id } })).toEqual({ ...before, tokenHash: hashInviteToken(rotated.token!) });
      expect(await getInvitePrefill(created.token!)).toBeNull();
      expect(await getInvitePrefill(rotated.token!)).toEqual({ firstName: "Alice", name: "Alice Example", email: rows[0].email });
    });
    expect(error).toBeNull();
  });

  it("does not rotate or change a revoked invite", async () => {
    const error = await attempt(async (tx, memorialId) => {
      const [created] = await createInvites({ invites: [rows[0]] });
      const revoked = await tx.invite.update({
        where: { memorialId_email: { memorialId, email: rows[0].email } }, data: { revokedAt: new Date() },
      });
      expect(await createInvites({ invites: [rows[0]], rotate: true })).toEqual([{ index: 0, status: "revoked" }]);
      expect(await tx.invite.findUniqueOrThrow({ where: { id: revoked.id } })).toEqual(revoked);
      expect(await getInvitePrefill(created.token!)).toBeNull();
    });
    expect(error).toBeNull();
  });

  it.each(["Example", null])("resolves lastName %j without changing row count or any stored field", async (lastName) => {
    const error = await attempt(async (tx, memorialId) => {
      const token = newInviteToken();
      const before = await tx.invite.create({ data: { ...rows[0], lastName, memorialId, tokenHash: hashInviteToken(token) } });
      const count = await tx.invite.count();
      expect(await getInvitePrefill(token)).toEqual({ firstName: "Alice", name: lastName ? "Alice Example" : "Alice", email: rows[0].email });
      expect(await tx.invite.count()).toBe(count);
      expect(await tx.invite.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
    });
    expect(error).toBeNull();
  });
});
