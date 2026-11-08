import { describe, expect, it } from "vitest";

import { PUBLIC_MEMORY_WHERE } from "@/features/memories/public";
import { MemoryStatus, Visibility } from "@/generated/prisma/enums";
import { isPublicMemory, PUBLIC_MEMORY_RULE } from "@/lib/memories/public-rule";

/**
 * D1 in one rule (debt rule M-E-14, TCR round 1 B2-2): the query constant the pages read with and the predicate the
 * media route checks must never disagree. `PUBLIC_MEMORY_WHERE` is flat equality, so it matches a row exactly when
 * every one of its fields equals the row's; the integration suite repeats the table against real Postgres.
 */
function matchesWhere(where: Record<string, unknown>, row: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

const DELETED_AT = [null, new Date("2026-11-08T12:00:00Z")] as const;
const combinations = Object.values(MemoryStatus).flatMap((status) =>
  Object.values(Visibility).flatMap((visibility) => DELETED_AT.map((deletedAt) => ({ status, visibility, deletedAt }))),
);

describe("isPublicMemory (plan 2026-11-08 D1)", () => {
  it("covers every status × visibility × deleted combination", () => {
    expect(combinations).toHaveLength(Object.values(MemoryStatus).length * Object.values(Visibility).length * 2);
  });

  it.each(combinations)("agrees with PUBLIC_MEMORY_WHERE for $status / $visibility / deleted $deletedAt", (row) => {
    expect(isPublicMemory(row)).toBe(matchesWhere(PUBLIC_MEMORY_WHERE, row));
  });

  it("is true for exactly one combination: APPROVED, PUBLIC, not deleted", () => {
    expect(combinations.filter(isPublicMemory)).toEqual([{ status: "APPROVED", visibility: "PUBLIC", deletedAt: null }]);
  });

  it("is the constant the query is built from", () => {
    expect(PUBLIC_MEMORY_WHERE).toEqual(PUBLIC_MEMORY_RULE);
    expect(PUBLIC_MEMORY_RULE).toEqual({ status: "APPROVED", visibility: "PUBLIC", deletedAt: null });
  });
});
