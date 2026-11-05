/**
 * A small interpreter for the subset of Prisma `where` clauses the budget
 * queries use, so the in-memory mocks in several test files agree with each
 * other and with SQL semantics (a comparison against NULL is never true).
 */
export type Where = Record<string, unknown>;

type Comparison = { lt?: Date | number; lte?: Date | number; gt?: Date | number; gte?: Date | number; not?: unknown; in?: unknown[]; startsWith?: string };

export function matchesWhere(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") {
      return (condition as Where[]).some((w) => matchesWhere(row, w));
    }
    if (key === "AND") {
      return (condition as Where[]).every((w) => matchesWhere(row, w));
    }
    if (key === "NOT") {
      return !matchesWhere(row, condition as Where);
    }
    const actual = row[key];
    if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
      if ("memory" === key || "contributor" === key) {
        return matchesWhere((actual ?? {}) as Record<string, unknown>, condition as Where);
      }
      const c = condition as Comparison;
      if (c.in !== undefined && !c.in.includes(actual)) {
        return false;
      }
      const ordered = c.lt !== undefined || c.lte !== undefined || c.gt !== undefined || c.gte !== undefined;
      if (ordered && (actual === null || actual === undefined)) {
        return false;
      }
      const value = actual as Date | number;
      if (c.lt !== undefined && !(value < c.lt)) {
        return false;
      }
      if (c.lte !== undefined && !(value <= c.lte)) {
        return false;
      }
      if (c.gt !== undefined && !(value > c.gt)) {
        return false;
      }
      if (c.gte !== undefined && !(value >= c.gte)) {
        return false;
      }
      if ("not" in c && actual === c.not) {
        return false;
      }
      if (c.startsWith !== undefined && !(typeof actual === "string" && actual.startsWith(c.startsWith))) {
        return false;
      }
      return true;
    }
    // Prisma treats an omitted optional column as null; fixtures may omit it.
    return (actual ?? null) === condition;
  });
}

/** `_sum` over one numeric column of the matching rows, null when nothing matched (as Prisma answers). */
export function sumWhere<T extends Record<string, unknown>>(rows: T[], where: Where, column: keyof T & string): number | null {
  const matched = rows.filter((r) => matchesWhere(r, where));
  if (matched.length === 0) {
    return null;
  }
  return matched.reduce((sum, r) => sum + (typeof r[column] === "number" ? (r[column] as number) : 0), 0);
}

/** A Prisma-shaped `aggregate` mock over an in-memory table: honours `where` and every `_sum` column asked for. */
export function aggregateMock<T extends Record<string, unknown>>(rows: () => T[]) {
  return async ({ where, _sum }: { where?: Where; _sum: Partial<Record<keyof T & string, boolean>> }) => {
    const sums: Record<string, number | null> = {};
    for (const [column, wanted] of Object.entries(_sum)) {
      if (wanted) {
        sums[column] = sumWhere(rows(), where ?? {}, column as keyof T & string);
      }
    }
    return { _sum: sums };
  };
}
