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
  it("takes a transaction-scoped advisory lock on one fixed key through the transaction client, key as a parameter", async () => {
    const { BUDGET_LOCK_KEY, lockBudget } = await import("@/features/memories/lock");
    // The function returns void, so it must go through $executeRaw: $queryRaw cannot deserialise a void column (seen against real Postgres).
    const executeRaw = vi.fn(async () => 1);
    const queryRaw = vi.fn(async () => []);
    const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw } as unknown as Parameters<typeof lockBudget>[0];

    await lockBudget(tx);

    expect(queryRaw).not.toHaveBeenCalled();
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join("?");
    // Transaction scope (released at commit/rollback, safe behind a transaction-mode pooler), never the session variant.
    expect(sql).toContain("pg_advisory_xact_lock(");
    expect(sql).not.toContain("pg_advisory_lock(");
    expect(values).toEqual([BUDGET_LOCK_KEY]);
  });
});
