import { describe, expect, it, vi } from "vitest";

import { lockMemory } from "@/features/memories/lock";

describe("lockMemory", () => {
  it("takes a FOR UPDATE row lock on the memory through the transaction client, with the id as a parameter", async () => {
    const queryRaw = vi.fn(async () => [{ id: "mem_1" }]);
    const tx = { $queryRaw: queryRaw } as unknown as Parameters<typeof lockMemory>[0];

    await lockMemory(tx, "mem_1");

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join("?");
    expect(sql).toContain('FROM "Memory"');
    expect(sql).toContain("FOR UPDATE");
    expect(sql).not.toContain("mem_1");
    expect(values).toEqual(["mem_1"]);
  });
});

describe("lockContributor", () => {
  it("takes a FOR UPDATE row lock on the contributor, id as a parameter (always after lockMemory)", async () => {
    const { lockContributor } = await import("@/features/memories/lock");
    const queryRaw = vi.fn(async () => [{ id: "con_1" }]);
    const tx = { $queryRaw: queryRaw } as unknown as Parameters<typeof lockContributor>[0];

    await lockContributor(tx, "con_1");

    const [strings, ...values] = queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join("?");
    expect(sql).toContain('FROM "Contributor"');
    expect(sql).toContain("FOR UPDATE");
    expect(sql).not.toContain("con_1");
    expect(values).toEqual(["con_1"]);
  });
});

describe("lockBudget", () => {
  /** The error Prisma 7 raises through a driver adapter for SQLSTATE 55P03, as observed against Postgres via @prisma/adapter-pg. */
  const lockTimeoutError = Object.assign(new Error("Raw query failed. Code: `55P03`. Message: `canceling statement due to lock timeout`"), {
    code: "P2010",
    meta: { driverAdapterError: { name: "DriverAdapterError", cause: { kind: "postgres", code: "55P03", originalCode: "55P03", message: "canceling statement due to lock timeout" } } },
  });

  it("sets a transaction-local lock_timeout, then takes a transaction-scoped advisory lock on one fixed key, key as a parameter", async () => {
    const { BUDGET_LOCK_KEY, BUDGET_LOCK_TIMEOUT, lockBudget } = await import("@/features/memories/lock");
    // The function returns void, so it must go through $executeRaw: $queryRaw cannot deserialise a void column (seen against real Postgres).
    const executeRaw = vi.fn(async () => 1);
    const queryRaw = vi.fn(async () => []);
    const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw } as unknown as Parameters<typeof lockBudget>[0];

    await lockBudget(tx);

    expect(queryRaw).not.toHaveBeenCalled();
    expect(executeRaw).toHaveBeenCalledTimes(2);
    // SET LOCAL first (transaction-scoped, never leaks through the pooler), the timeout spliced in as raw SQL, then the lock wait.
    const [setStrings, setValue] = executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, { sql?: string }];
    expect(setStrings.join("?")).toBe("SET LOCAL lock_timeout = '?'");
    expect(setValue).toMatchObject({ sql: BUDGET_LOCK_TIMEOUT });
    const [strings, ...values] = executeRaw.mock.calls[1] as unknown as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join("?");
    // Transaction scope (released at commit/rollback, safe behind a transaction-mode pooler), never the session variant.
    expect(sql).toContain("pg_advisory_xact_lock(");
    expect(sql).not.toContain("pg_advisory_lock(");
    expect(values).toEqual([BUDGET_LOCK_KEY]);
  });

  it("turns a lock wait that ran out (55P03) into BudgetBusyError and lets every other error through (TCR #4)", async () => {
    const { BudgetBusyError, isLockTimeout, lockBudget } = await import("@/features/memories/lock");
    // The SET LOCAL succeeds; the lock statement is what times out.
    const failLock = (error: unknown) => async (strings: TemplateStringsArray) => { if (strings.join("?").includes("pg_advisory_xact_lock")) { throw error; } return 1; };
    const executeRaw = vi.fn(failLock(lockTimeoutError));
    const tx = { $executeRaw: executeRaw } as unknown as Parameters<typeof lockBudget>[0];
    await expect(lockBudget(tx)).rejects.toBeInstanceOf(BudgetBusyError);

    const other = Object.assign(new Error("Raw query failed. Code: `42P01`. Message: `relation does not exist`"), { code: "P2010", meta: { driverAdapterError: { cause: { code: "42P01" } } } });
    executeRaw.mockImplementation(failLock(other));
    await expect(lockBudget(tx)).rejects.toBe(other);

    expect(isLockTimeout(lockTimeoutError)).toBe(true);
    expect(isLockTimeout({ meta: { code: "55P03" } })).toBe(true);
    expect(isLockTimeout(new Error("canceling statement due to lock timeout"))).toBe(true);
    expect(isLockTimeout(other)).toBe(false);
    expect(isLockTimeout(null)).toBe(false);
  });
});
