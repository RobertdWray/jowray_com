/**
 * The in-memory twin of `readBudgetStats` (features/memories/create-memory.ts):
 * the budget reads one SQL statement (one snapshot), which the mocks cannot
 * interpret, so every budget test answers that statement from its tables with
 * these rules. Keep them identical to the SQL; the integration suite proves the
 * SQL against real Postgres.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BudgetTables {
  memories: Array<{ createdAt: Date }>;
  media: Array<{ status: string; maxBytes: number; sizeBytes?: number | null; createdAt: Date; reservedUntil?: Date | null }>;
  derived: Array<{ status: string; sizeBytes: number | null }>;
}

export interface BudgetStatsRow {
  memoriesToday: number;
  bytesToday: number;
  storedBytes: number;
  derivedBytes: number;
  openBytes: number;
}

/** A PENDING row still holds its bytes while its window is ahead; a row with no window yet (old code) for a day from creation. Cancelled rows count too: their token is still live. */
function open(row: BudgetTables["media"][number], now: Date, since: Date): boolean {
  if (row.status !== "PENDING") {
    return false;
  }
  const window = row.reservedUntil ?? null;
  return window !== null ? window.getTime() > now.getTime() : row.createdAt.getTime() > since.getTime();
}

export function budgetStats(tables: BudgetTables, now = new Date()): BudgetStatsRow {
  const since = new Date(now.getTime() - DAY_MS);
  const sum = <T>(rows: T[], pick: (row: T) => number | null | undefined): number => rows.reduce((s, r) => s + (pick(r) ?? 0), 0);
  return {
    memoriesToday: tables.memories.filter((m) => m.createdAt.getTime() > since.getTime()).length,
    bytesToday: sum(tables.media.filter((m) => (m.status === "READY" && m.createdAt.getTime() > since.getTime()) || open(m, now, since)), (m) => m.maxBytes),
    storedBytes: sum(tables.media.filter((m) => m.status === "READY"), (m) => m.sizeBytes),
    derivedBytes: sum(tables.derived.filter((d) => d.status === "READY"), (d) => d.sizeBytes),
    openBytes: sum(tables.media.filter((m) => open(m, now, since)), (m) => m.maxBytes),
  };
}

/** True for the budget's one statement (it names its own columns). */
export function isBudgetStatsQuery(strings: TemplateStringsArray): boolean {
  return strings.join("?").includes('"memoriesToday"');
}
