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
