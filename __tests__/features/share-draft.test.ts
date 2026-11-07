import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/server/config/env";

const MEM = "00000000-0000-4000-8000-000000000001";
const T0 = new Date("2026-11-04T10:00:00.000Z");
const NOW = new Date("2026-11-07T03:00:00.000Z");
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ createLogger: () => log, logError: vi.fn() }));

interface MemoryRow {
  id: string;
  status: "DRAFT" | "PENDING" | "APPROVED" | "HIDDEN";
  deletedAt: Date | null;
  updatedAt: Date;
  consentedAt: Date | null;
  consentVersion: string;
  notifyWhenPosted: boolean;
  claimTokenHash: string;
}
interface Revision { memoryId: string; changedVia: string; before: Record<string, unknown>; after: Record<string, unknown> }
interface EmailRow { memoryId: string; emailType: string; status: string; errorMessage: string; recipientEmail: string; recipientKey: string }
let memory: MemoryRow | null;
let revisions: Revision[];
let emails: EmailRow[];
let inTransaction = false;
const calls: string[] = [];
const contributor = { contactOptIn: false, mailingListOptIn: true };
let onLock: (() => void) | undefined;

const tx = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    expect(inTransaction).toBe(true);
    expect(strings.join("?")).toContain('FROM "Memory"');
    expect(values).toEqual([MEM]);
    calls.push("lock");
    onLock?.();
    return memory ? [{ id: MEM }] : [];
  }),
  memory: {
    findUnique: vi.fn(async ({ where, select }: { where: { id: string }; select: Record<string, boolean> }) => {
      calls.push("read");
      if (!memory || where.id !== memory.id) { return null; }
      return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, memory![key as keyof MemoryRow]]));
    }),
    update: vi.fn(async ({ data }: { where: { id: string }; data: Partial<MemoryRow> }) => {
      expect(inTransaction).toBe(true);
      calls.push("update");
      if (!memory) { throw new Error("missing memory"); }
      Object.assign(memory, data, { updatedAt: NOW });
      return { ...memory };
    }),
  },
  contributor: { update: vi.fn() },
  memoryRevision: {
    count: vi.fn(async () => revisions.length),
    create: vi.fn(async ({ data }: { data: Revision }) => {
      expect(inTransaction).toBe(true);
      calls.push("revision");
      revisions.push(data);
      return data;
    }),
  },
  emailLog: {
    createMany: vi.fn(async ({ data, skipDuplicates }: { data: EmailRow; skipDuplicates: boolean }) => {
      expect(inTransaction).toBe(true);
      expect(skipDuplicates).toBe(true);
      calls.push("suppress");
      if (emails.some((row) => row.memoryId === data.memoryId && row.emailType === data.emailType)) { return { count: 0 }; }
      emails.push(data);
      return { count: 1 };
    }),
    findUnique: vi.fn(async () => emails[0] ?? null),
  },
};
const db = {
  $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => {
    expect(inTransaction).toBe(false);
    const before = structuredClone({ memory, revisions, emails });
    inTransaction = true;
    try {
      const result = await fn(tx);
      calls.push("commit");
      return result;
    } catch (error) {
      ({ memory, revisions, emails } = before);
      throw error;
    } finally {
      inTransaction = false;
    }
  }),
};
vi.mock("@/server/db/client", () => ({ getDb: () => db }));

import { shareDraftAsAdmin } from "@/features/admin/share-draft";
import { TX_OPTIONS } from "@/features/memories/create-memory";

const input = { memoryId: MEM, memoryVersion: T0.toISOString(), status: "PENDING" as const };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("MEMORIAL_SLUG", "share-draft-test");
  vi.stubEnv("CONSENT_VERSION", "share-test-v2");
  resetEnvCache();
  memory = { id: MEM, status: "DRAFT", deletedAt: null, updatedAt: T0, consentedAt: null, consentVersion: "draft-v1", notifyWhenPosted: true, claimTokenHash: "a".repeat(64) };
  revisions = [];
  emails = [];
  calls.length = 0;
  onLock = undefined;
  log.info.mockImplementation(() => { expect(inTransaction).toBe(false); });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); resetEnvCache(); });

function expectNoWrites() {
  expect(tx.memory.update).not.toHaveBeenCalled();
  expect(tx.contributor.update).not.toHaveBeenCalled();
  expect(revisions).toEqual([]);
  expect(emails).toEqual([]);
  expect(log.info).not.toHaveBeenCalled();
}

describe("shareDraftAsAdmin (A1, A2)", () => {
  it.each(["PENDING", "APPROVED"] as const)("A1: shares to %s with the sender's consent stamp, one ADMIN revision and a terminal row in one transaction", async (status) => {
    const before = structuredClone({ memory, contributor });
    expect(await shareDraftAsAdmin({ ...input, status })).toEqual({ ok: true, status, memoryVersion: NOW.toISOString() });
    expect(db.$transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), TX_OPTIONS);
    expect(calls).toEqual(["lock", "read", "update", "revision", "suppress", "commit"]);
    expect(tx.memory.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: MEM }, data: { status, consentedAt: NOW, consentVersion: "share-test-v2" } }));
    expect(memory).toEqual({ ...before.memory, status, consentedAt: NOW, consentVersion: "share-test-v2", updatedAt: NOW });
    expect(contributor).toEqual(before.contributor);
    expect(tx.contributor.update).not.toHaveBeenCalled();
    expect(revisions).toEqual([{ memoryId: MEM, changedVia: "ADMIN", before: { status: "DRAFT", consentedAt: null }, after: { status, consentedAt: NOW.toISOString(), consentVersion: "share-test-v2" } }]);
    expect(emails).toEqual([{ memoryId: MEM, emailType: "ADMIN_NEW_MEMORY", status: "SKIPPED", errorMessage: "admin_shared", recipientEmail: "", recipientKey: "" }]);
    expect(log.info).toHaveBeenCalledExactlyOnceWith({ action: "admin_draft_shared", memoryId: MEM, status }, expect.any(String));
  });

  it("A1: appends the exact consent snapshot after an existing draft revision", async () => {
    revisions.push({ memoryId: MEM, changedVia: "ADMIN", before: {}, after: { note: "original draft" } });
    await shareDraftAsAdmin(input);
    expect(revisions).toHaveLength(2);
    expect(revisions[1]).toEqual({ memoryId: MEM, changedVia: "ADMIN", before: { status: "DRAFT", consentedAt: null }, after: { status: "PENDING", consentedAt: NOW.toISOString() } });
  });

  it.each([null, { ...input, memoryId: "bad" }, { ...input, memoryVersion: "yesterday" }, { memoryId: MEM, status: "PENDING" }, { ...input, status: "DRAFT" }, { ...input, status: "HIDDEN" }])("A2: refuses invalid input without opening a transaction (%j)", async (raw) => {
    expect(await shareDraftAsAdmin(raw)).toEqual({ ok: false, code: "invalid" });
    expect(db.$transaction).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it.each(["missing", "deleted"])("A2: refuses a %s memory without writes", async (kind) => {
    if (kind === "missing") { memory = null; } else { memory!.deletedAt = NOW; }
    expect(await shareDraftAsAdmin(input)).toEqual({ ok: false, code: "not_found" });
    expectNoWrites();
  });

  it.each(["PENDING", "APPROVED", "HIDDEN"] as const)("A2: answers not_draft for %s before testing the stale version", async (status) => {
    onLock = () => { memory!.status = status; memory!.updatedAt = NOW; };
    expect(await shareDraftAsAdmin(input)).toEqual({ ok: false, code: "not_draft" });
    expectNoWrites();
  });

  it("A2: re-reads under the lock and answers stale with only the current draft version and status", async () => {
    onLock = () => { memory!.updatedAt = NOW; };
    expect(await shareDraftAsAdmin(input)).toEqual({ ok: false, code: "stale", current: { memoryVersion: NOW.toISOString(), status: "DRAFT" } });
    expectNoWrites();
  });

  it("A2: compares the version string exactly like update-memory, even for equivalent timestamps", async () => {
    expect(await shareDraftAsAdmin({ ...input, memoryVersion: "2026-11-04T10:00:00Z" })).toEqual({ ok: false, code: "stale", current: { memoryVersion: T0.toISOString(), status: "DRAFT" } });
    expectNoWrites();
  });

  it("A2: a second call answers not_draft and leaves the stamp, revision and terminal row unchanged", async () => {
    await shareDraftAsAdmin(input);
    const before = structuredClone({ memory, revisions, emails });
    vi.clearAllMocks();
    expect(await shareDraftAsAdmin(input)).toEqual({ ok: false, code: "not_draft" });
    expect({ memory, revisions, emails }).toEqual(before);
    expect(tx.memory.update).not.toHaveBeenCalled();
    expect(tx.memoryRevision.create).not.toHaveBeenCalled();
    expect(tx.emailLog.createMany).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });

  it("A1: preserves an unexpected existing alert and warns with ids only", async () => {
    emails.push({ memoryId: MEM, emailType: "ADMIN_NEW_MEMORY", status: "PENDING", errorMessage: "", recipientEmail: "admin@example.com", recipientKey: "admin@example.com" });
    const before = structuredClone(emails);
    expect(await shareDraftAsAdmin(input)).toMatchObject({ ok: true });
    expect(emails).toEqual(before);
    expect(log.warn).toHaveBeenCalledExactlyOnceWith({ action: "admin_share_alert_exists", memoryId: MEM, emailType: "ADMIN_NEW_MEMORY" }, expect.any(String));
  });

  it("A1: a failed suppression insert rolls back the consent and revision and never logs success", async () => {
    const before = structuredClone(memory);
    tx.emailLog.createMany.mockRejectedValueOnce(new Error("insert failed"));
    await expect(shareDraftAsAdmin(input)).rejects.toThrow("insert failed");
    expect(memory).toEqual(before);
    expect(revisions).toEqual([]);
    expect(emails).toEqual([]);
    expect(log.info).not.toHaveBeenCalled();
  });
});
