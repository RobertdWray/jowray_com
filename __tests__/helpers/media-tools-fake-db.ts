/**
 * An in-memory stand-in for the Prisma calls the MCP photo tools make (plan 2026-11-08-mcp-media-tools S3–S6):
 * `Memory`, `Media` and `MemoryRevision` rows, row locks logged in call order, `where` clauses through the shared
 * `matchesWhere` interpreter (SQL NULL semantics), `orderBy` lists and `select`.
 *
 * Unlike the stub in admin-memories.test.ts, `@updatedAt` behaves as Prisma's does: an update that supplies
 * `updatedAt` stores that value, one that does not stores the clock's now, and an empty `data` leaves it alone, so
 * `touchMemory`'s explicit timestamp is what the tests observe.
 */
import { vi } from "vitest";

import { matchesWhere, type Where } from "./prisma-where";

export interface FakeMemory {
  id: string;
  deletedAt: Date | null;
  updatedAt: Date;
  consentVersion: string;
  contributorNote: string | null;
  type: "VOICE" | "VIDEO" | "PHOTO" | "TEXT";
  status: "DRAFT" | "PENDING" | "APPROVED" | "HIDDEN";
  visibility: "PUBLIC" | "FAMILY" | "PRIVATE";
}

export interface FakeMedia {
  id: string;
  memoryId: string;
  status: "PENDING" | "READY" | "FAILED";
  mimeType: string;
  originalFilename: string | null;
  caption: string | null;
  approxDateText: string | null;
  place: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  purgeAfter: Date | null;
  purgedAt: Date | null;
  replacesMediaId: string | null;
}

export interface FakeRevision {
  id: string;
  memoryId: string;
  changedVia: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt: Date;
}

type OrderBy = Array<Record<string, "asc" | "desc">> | Record<string, "asc" | "desc">;

function project<T extends object>(row: T, select?: Record<string, boolean>): Partial<T> {
  if (!select) {
    return { ...row };
  }
  return Object.fromEntries(Object.entries(select).filter(([, wanted]) => wanted).map(([k]) => [k, (row as Record<string, unknown>)[k]])) as Partial<T>;
}

function compare(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  if (x === y) { return 0; }
  if (x === null || x === undefined) { return 1; }
  if (y === null || y === undefined) { return -1; }
  return (x as number | string) < (y as number | string) ? -1 : 1;
}

function sorted<T extends object>(rows: T[], orderBy?: OrderBy): T[] {
  if (!orderBy) {
    return rows;
  }
  const keys = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const [field, direction] = Object.entries(key)[0]!;
      const c = compare((a as Record<string, unknown>)[field], (b as Record<string, unknown>)[field]);
      if (c !== 0) { return direction === "desc" ? -c : c; }
    }
    return 0;
  });
}

/** Prisma's `@updatedAt`: supplied wins, otherwise now, and an empty update leaves it alone. */
function applyUpdate<T extends { updatedAt: Date }>(row: T, data: Record<string, unknown>): void {
  if (Object.keys(data).length === 0) {
    return;
  }
  Object.assign(row, data);
  if (!("updatedAt" in data)) {
    row.updatedAt = new Date();
  }
}

export function createMediaToolsFakeDb() {
  const memories: FakeMemory[] = [];
  const media: FakeMedia[] = [];
  const revisions: FakeRevision[] = [];
  /** Every statement, in call order: `lock:<id>`, `memory.update:<id>`, `media.update:<id>`, `media.updateMany`, `revision:<memoryId>`. */
  const calls: string[] = [];
  let revisionSeq = 0;

  const memoryRow = (id: string) => memories.find((m) => m.id === id);

  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(`${strings.join("?").includes("FOR UPDATE") ? "lock" : "raw"}:${String(values[0])}`);
      return [{ id: values[0] }];
    }),
    memory: {
      findUnique: vi.fn(async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
        const row = memoryRow(where.id);
        return row ? project(row, select) : null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
        const row = memoryRow(where.id);
        if (!row) { throw Object.assign(new Error("No Memory found"), { code: "P2025" }); }
        return project(row, select);
      }),
      update: vi.fn(async ({ where, data, select }: { where: { id: string }; data: Record<string, unknown>; select?: Record<string, boolean> }) => {
        calls.push(`memory.update:${where.id}:${Object.keys(data).sort().join(",")}`);
        const row = memoryRow(where.id);
        if (!row) { throw Object.assign(new Error("No Memory found"), { code: "P2025" }); }
        applyUpdate(row, data);
        return project(row, select);
      }),
    },
    media: {
      findFirst: vi.fn(async ({ where, select, orderBy }: { where: Where; select?: Record<string, boolean>; orderBy?: OrderBy }) => {
        const row = sorted(media.filter((m) => matchesWhere(m as unknown as Record<string, unknown>, where)), orderBy)[0];
        return row ? project(row, select) : null;
      }),
      findMany: vi.fn(async ({ where, select, orderBy }: { where: Where; select?: Record<string, boolean>; orderBy?: OrderBy }) =>
        sorted(media.filter((m) => matchesWhere(m as unknown as Record<string, unknown>, where)), orderBy).map((m) => project(m, select))),
      count: vi.fn(async ({ where }: { where: Where }) => media.filter((m) => matchesWhere(m as unknown as Record<string, unknown>, where)).length),
      update: vi.fn(async ({ where, data, select }: { where: { id: string }; data: Record<string, unknown>; select?: Record<string, boolean> }) => {
        calls.push(`media.update:${where.id}:${Object.keys(data).sort().join(",")}`);
        const row = media.find((m) => m.id === where.id);
        if (!row) { throw Object.assign(new Error("No Media found"), { code: "P2025" }); }
        applyUpdate(row, data);
        return project(row, select);
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
        const rows = media.filter((m) => matchesWhere(m as unknown as Record<string, unknown>, where));
        calls.push(`media.updateMany:${rows.map((r) => r.id).join(",")}:${Object.keys(data).sort().join(",")}`);
        for (const row of rows) { applyUpdate(row, data); }
        return { count: rows.length };
      }),
    },
    memoryRevision: {
      count: vi.fn(async ({ where }: { where: { memoryId: string } }) => revisions.filter((r) => r.memoryId === where.memoryId).length),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: Omit<FakeRevision, "id" | "createdAt"> }) => {
        calls.push(`revision:${data.memoryId}`);
        const row = { ...data, id: `rev_${++revisionSeq}`, createdAt: new Date() };
        revisions.push(row);
        return row;
      }),
    },
  };
  const db = { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };

  function reset(): void {
    memories.length = 0;
    media.length = 0;
    revisions.length = 0;
    calls.length = 0;
    revisionSeq = 0;
  }

  return { db, tx, memories, media, revisions, calls, reset };
}

export function fakeMemory(over: Partial<FakeMemory> & { id: string }): FakeMemory {
  return {
    deletedAt: null,
    updatedAt: new Date("2026-11-08T14:36:08.673Z"),
    consentVersion: "2026-11-v2",
    contributorNote: null,
    type: "PHOTO",
    status: "APPROVED",
    visibility: "PUBLIC",
    ...over,
  };
}

export function fakeMedia(over: Partial<FakeMedia> & { id: string; memoryId: string }): FakeMedia {
  return {
    status: "READY",
    mimeType: "image/jpeg",
    originalFilename: `${over.id}.jpg`,
    caption: null,
    approxDateText: null,
    place: null,
    sortOrder: 0,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: new Date("2026-11-01T00:00:00.000Z"),
    deletedAt: null,
    purgeAfter: null,
    purgedAt: null,
    replacesMediaId: null,
    ...over,
  };
}
