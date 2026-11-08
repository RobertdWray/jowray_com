import { setUser } from "@sentry/nextjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInvites } from "@/features/invites/create-invites";
import { getInvitePrefill } from "@/features/invites/resolve-invite";
import type { Invite } from "@/generated/prisma/client";
import { hashInviteToken, isInviteToken, newInviteToken } from "@/lib/invite-token";
import { identifyContributor } from "@/lib/sentry/user";
import { createInvitesInputSchema } from "@/lib/validations/invite";
import { resetEnvCache } from "@/server/config/env";

const MEMORIAL_ID = "00000000-0000-4000-8000-000000000001";
const SITE = "https://invites.example.com";
const rows = [
  { firstName: "Alice", lastName: "Example", email: "alice@example.com" },
  { firstName: "Bob", lastName: "Sample", email: "bob@example.com" },
  { firstName: "Casey", email: "casey@example.com" },
];

type InsertRow = Pick<Invite, "memorialId" | "tokenHash" | "firstName" | "lastName" | "email">;
interface InsertArgs { data: InsertRow[]; skipDuplicates: boolean; select: { tokenHash: true } }
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ createLogger: () => log }));
vi.mock("@sentry/nextjs", () => ({ setUser: vi.fn() }));
vi.mock("@/lib/sentry/user", () => ({ identifyContributor: vi.fn(), clearContributor: vi.fn(), tagIds: vi.fn() }));
let inTransaction = false;
const invite = {
  createManyAndReturn: vi.fn<(args: InsertArgs) => Promise<{ tokenHash: string }[]>>(),
  findMany: vi.fn<(args: { where: { memorialId: string; email: { in: string[] } } }) => Promise<Invite[]>>(),
  findUnique: vi.fn<() => Promise<Invite | null>>(),
  update: vi.fn<(args: { where: { id: string }; data: { tokenHash: string } }) => Promise<Invite>>(),
  updateMany: vi.fn<(args: { where: { id: string; revokedAt: null }; data: { tokenHash: string } }) => Promise<{ count: number }>>(),
  create: vi.fn(), createMany: vi.fn(), updateManyAndReturn: vi.fn(),
  delete: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn(),
};
const memorial = { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), upsert: vi.fn() };
const tx = { invite, memorial, $executeRaw: vi.fn(), $executeRawUnsafe: vi.fn(), $queryRaw: vi.fn(), $queryRawUnsafe: vi.fn() };
const db = {
  ...tx,
  $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => {
    expect(inTransaction).toBe(false);
    inTransaction = true;
    try {
      return await fn(tx);
    } finally {
      inTransaction = false;
    }
  }),
};
const getDb = vi.fn(() => db);
vi.mock("@/server/db/client", () => ({ getDb: () => getDb() }));

function existing(index = 0, overrides: Partial<Invite> = {}): Invite {
  return {
    id: `invite-${index}`, memorialId: MEMORIAL_ID, tokenHash: hashInviteToken(newInviteToken()),
    ...rows[index], lastName: "lastName" in rows[index] ? rows[index].lastName ?? null : null,
    createdAt: new Date("2026-11-07T00:00:00.000Z"), revokedAt: null, ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  inTransaction = false;
  vi.stubEnv("MEMORIAL_SLUG", "invite-test");
  vi.stubEnv("CONSENT_VERSION", "invite-test-v1");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", SITE);
  resetEnvCache();
  memorial.findUnique.mockResolvedValue({ id: MEMORIAL_ID });
  invite.createManyAndReturn.mockImplementation(async ({ data }) => {
    expect(inTransaction).toBe(true);
    return data.map(({ tokenHash }) => ({ tokenHash }));
  });
  invite.findMany.mockImplementation(async () => {
    expect(inTransaction).toBe(true);
    return [];
  });
  invite.findUnique.mockResolvedValue(null);
  invite.update.mockImplementation(async ({ data }) => {
    expect(inTransaction).toBe(true);
    return existing(0, data);
  });
  invite.updateMany.mockImplementation(async () => {
    expect(inTransaction).toBe(true);
    return { count: 1 };
  });
  log.info.mockImplementation(() => { expect(inTransaction).toBe(false); });
});
afterEach(() => { vi.unstubAllEnvs(); resetEnvCache(); });

describe("createInvites", () => {
  it("creates hash-only rows in one transaction and returns indexed links", async () => {
    const results = await createInvites(createInvitesInputSchema.parse({ invites: [rows[0], rows[2]] }));
    expect(results).toHaveLength(2);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(memorial.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: "invite-test" } }));
    const data = invite.createManyAndReturn.mock.calls[0][0].data;
    for (const [index, result] of results.entries()) {
      expect(result).toEqual({ index, status: "created", token: expect.any(String), shareUrl: `${SITE}/s/${result.token}` });
      expect(isInviteToken(result.token!)).toBe(true);
      expect(data[index]).toEqual({
        ...[rows[0], rows[2]][index], lastName: index === 0 ? "Example" : null,
        memorialId: MEMORIAL_ID, tokenHash: hashInviteToken(result.token!),
      });
      expect(JSON.stringify(data)).not.toContain(result.token);
    }
    expect(invite.createManyAndReturn).toHaveBeenCalledExactlyOnceWith({ data, skipDuplicates: true, select: { tokenHash: true } });
    expect(invite.findMany).not.toHaveBeenCalled();
    expect(invite.update).not.toHaveBeenCalled();
    expect(invite.updateMany).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledExactlyOnceWith({ action: "invites_created", created: 2, exists: 0, rotated: 0, revoked: 0 }, expect.any(String));
  });

  it("uses the shared transaction wait and timeout limits", async () => {
    await createInvites({ invites: [rows[0]] });
    expect(db.$transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), { maxWait: 5_000, timeout: 10_000 });
  });

  it.each([false, true])("rejects duplicate emails before accessing the database when rotate is %s", async (rotate) => {
    await expect(createInvites({ invites: [rows[0], { ...rows[1], email: rows[0].email }], rotate }))
      .rejects.toEqual(new Error("Duplicate email in invite batch"));
    expect(getDb).not.toHaveBeenCalled();
    expect(memorial.findUnique).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });

  it("returns exists without a token or URL for a previously imported email", async () => {
    invite.createManyAndReturn.mockResolvedValue([]);
    invite.findMany.mockResolvedValue([existing()]);
    expect(await createInvites({ invites: [rows[0]] })).toEqual([{ index: 0, status: "exists" }]);
    expect(invite.findMany).toHaveBeenCalledExactlyOnceWith({ where: { memorialId: MEMORIAL_ID, email: { in: [rows[0].email] } } });
    expect(invite.update).not.toHaveBeenCalled();
    expect(invite.updateMany).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledExactlyOnceWith({ action: "invites_created", created: 0, exists: 1, rotated: 0, revoked: 0 }, expect.any(String));
  });

  it("rotates only the stored hash and returns the new token and link", async () => {
    const previous = existing();
    invite.createManyAndReturn.mockResolvedValue([]);
    invite.findMany.mockResolvedValue([previous]);
    const [result] = await createInvites({ invites: [rows[0]], rotate: true });
    expect(result).toEqual({ index: 0, status: "rotated", token: expect.any(String), shareUrl: `${SITE}/s/${result.token}` });
    expect(isInviteToken(result.token!)).toBe(true);
    expect(hashInviteToken(result.token!)).not.toBe(previous.tokenHash);
    expect(invite.updateMany).toHaveBeenCalledExactlyOnceWith({ where: { id: previous.id, revokedAt: null }, data: { tokenHash: hashInviteToken(result.token!) } });
    expect(invite.update).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledExactlyOnceWith({ action: "invites_created", created: 0, exists: 0, rotated: 1, revoked: 0 }, expect.any(String));
  });

  it("reports revoked without credentials when revocation wins the rotation race", async () => {
    const previous = existing();
    invite.createManyAndReturn.mockResolvedValue([]);
    invite.findMany.mockResolvedValue([previous]);
    invite.updateMany.mockResolvedValueOnce({ count: 0 });
    const [result] = await createInvites({ invites: [rows[0]], rotate: true });
    expect(result.status).toBe("revoked");
    expect(result).toEqual({ index: 0, status: "revoked" });
    expect(invite.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: previous.id, revokedAt: null },
      data: { tokenHash: invite.createManyAndReturn.mock.calls[0][0].data[0].tokenHash },
    });
    expect(invite.update).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledExactlyOnceWith({ action: "invites_created", created: 0, exists: 0, rotated: 0, revoked: 1 }, expect.any(String));
  });

  it.each([false, true])("keeps a revoked row revoked when rotate is %s", async (rotate) => {
    invite.createManyAndReturn.mockResolvedValue([]);
    invite.findMany.mockResolvedValue([existing(0, { revokedAt: new Date() })]);
    expect(await createInvites({ invites: [rows[0]], rotate })).toEqual([{ index: 0, status: "revoked" }]);
    expect(invite.update).not.toHaveBeenCalled();
    expect(invite.updateMany).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledExactlyOnceWith({ action: "invites_created", created: 0, exists: 0, rotated: 0, revoked: 1 }, expect.any(String));
  });

  it("maps shuffled inserts by hash when the middle input already exists", async () => {
    invite.createManyAndReturn.mockImplementation(async ({ data }) => [data[2], data[0]].map(({ tokenHash }) => ({ tokenHash })));
    invite.findMany.mockResolvedValue([existing(1)]);
    const results = await createInvites({ invites: rows });
    expect(results.map(({ index, status }) => ({ index, status }))).toEqual([
      { index: 0, status: "created" }, { index: 1, status: "exists" }, { index: 2, status: "created" },
    ]);
    const data = invite.createManyAndReturn.mock.calls[0][0].data;
    for (const index of [0, 2]) {
      expect(hashInviteToken(results[index].token!)).toBe(data[index].tokenHash);
      expect(results[index].shareUrl).toBe(`${SITE}/s/${results[index].token}`);
    }
    expect(results[1]).toEqual({ index: 1, status: "exists" });
    expect(invite.findMany).toHaveBeenCalledExactlyOnceWith({ where: { memorialId: MEMORIAL_ID, email: { in: [rows[1].email] } } });
  });

  it("throws when the memorial has not been seeded", async () => {
    memorial.findUnique.mockResolvedValue(null);
    await expect(createInvites({ invites: [rows[0]] })).rejects.toThrow('Memorial "invite-test" is not seeded');
    expect(invite.createManyAndReturn).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });

  it("throws instead of omitting an input that was neither inserted nor found", async () => {
    invite.createManyAndReturn.mockResolvedValue([]);
    await expect(createInvites({ invites: [rows[0]] })).rejects.toThrow(/invariant/i);
    expect(log.info).not.toHaveBeenCalled();
  });

  it("propagates a rotation failure without logging a successful batch", async () => {
    invite.createManyAndReturn.mockResolvedValue([]);
    invite.findMany.mockResolvedValue([existing()]);
    invite.updateMany.mockRejectedValueOnce(new Error("database write failed"));
    await expect(createInvites({ invites: [rows[0]], rotate: true })).rejects.toThrow("database write failed");
    expect(log.info).not.toHaveBeenCalled();
  });

  it("keeps personal data out of results and all data except counts out of logs", async () => {
    invite.createManyAndReturn.mockImplementation(async ({ data }) => [{ tokenHash: data[0].tokenHash }]);
    invite.findMany.mockResolvedValue([existing(2, { revokedAt: new Date() }), existing(1)]);
    const results = await createInvites({ invites: rows, rotate: true });
    expect(results.map(({ status }) => status)).toEqual(["created", "rotated", "revoked"]);
    expect(log.info).toHaveBeenCalledExactlyOnceWith({ action: "invites_created", created: 1, exists: 0, rotated: 1, revoked: 1 }, expect.any(String));
    const serializedResults = JSON.stringify(results, (key, value) => key === "token" || key === "shareUrl" ? undefined : value);
    const serializedLogs = JSON.stringify([log.info.mock.calls, log.warn.mock.calls, log.error.mock.calls]);
    for (const row of rows) {
      for (const value of Object.values(row)) {
        expect(serializedResults).not.toContain(value);
        expect(serializedLogs).not.toContain(value);
      }
    }
    for (const { token, shareUrl } of results) {
      if (token) { expect(serializedLogs).not.toContain(token); }
      if (shareUrl) { expect(serializedLogs).not.toContain(shareUrl); }
    }
    for (const { tokenHash } of invite.createManyAndReturn.mock.calls[0][0].data) {
      expect(serializedLogs).not.toContain(tokenHash);
    }
    expect(serializedLogs).not.toContain(SITE);
  });
});

describe("getInvitePrefill", () => {
  afterEach(() => {
    expect(setUser).not.toHaveBeenCalled();
    expect(identifyContributor).not.toHaveBeenCalled();
    for (const write of [
      invite.create, invite.createMany, invite.createManyAndReturn, invite.update, invite.updateMany,
      invite.updateManyAndReturn, invite.delete, invite.deleteMany, invite.upsert,
      memorial.create, memorial.update, memorial.delete, memorial.upsert,
      tx.$executeRaw, tx.$executeRawUnsafe, tx.$queryRaw, tx.$queryRawUnsafe,
    ]) {
      expect(write).not.toHaveBeenCalled();
    }
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("returns null for a malformed token without accessing the database", async () => {
    expect(await getInvitePrefill("malformed")).toBeNull();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("returns null for an unknown token", async () => {
    expect(await getInvitePrefill(newInviteToken())).toBeNull();
    expect(invite.findUnique).toHaveBeenCalledTimes(1);
  });

  it("returns null for a revoked invite", async () => {
    invite.findUnique.mockResolvedValue(existing(0, { revokedAt: new Date() }));
    expect(await getInvitePrefill(newInviteToken())).toBeNull();
  });

  it("looks up only the hash and returns the joined name and email", async () => {
    const token = newInviteToken();
    invite.findUnique.mockResolvedValue(existing(0, { tokenHash: hashInviteToken(token) }));
    expect(await getInvitePrefill(token)).toEqual({ firstName: "Alice", name: "Alice Example", email: "alice@example.com" });
    expect(invite.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { tokenHash: hashInviteToken(token) },
      select: { firstName: true, lastName: true, email: true, revokedAt: true },
    });
  });

  it("uses just the first name when lastName is null", async () => {
    invite.findUnique.mockResolvedValue(existing(0, { lastName: null }));
    expect(await getInvitePrefill(newInviteToken())).toEqual({ firstName: "Alice", name: "Alice", email: "alice@example.com" });
  });
});
