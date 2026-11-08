import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetEnvCache } from "@/server/config/env";

import { budgetStats, isBudgetStatsQuery } from "../helpers/budget-stats";

/**
 * In-memory Prisma stub for the admin features (plan §6 V6–V11). Enough of
 * `findMany`/`count`/`groupBy` for the list, a lockable memory + contributor
 * for the writers, and the create path `draftMemory` needs. The lock calls are
 * logged so the lock order (memory → contributor) can be asserted.
 */

const MEM = "00000000-0000-4000-8000-000000000001";
const MEM2 = "00000000-0000-4000-8000-000000000002";
const CON = "00000000-0000-4000-8000-00000000000c";
const T0 = new Date("2026-11-04T10:00:00.000Z");
const T1 = new Date("2026-11-04T11:00:00.000Z");

type ContributorRow = { id: string; name: string | null; email: string | null; relationship: string | null; phone: string | null; contactOptIn: boolean; mailingListOptIn: boolean; updatedAt: Date }
type MemoryRow = { id: string; memorialId: string; contributorId: string | null; type: string; source: string; sourceRef: string | null; visibility: string; approxDateText: string | null; place: string | null; contributorNote: string | null; notifyWhenPosted: boolean; consentVersion: string; consentedAt: Date | null; status: string; claimTokenHash: string; submissionId: string | null; submissionIndex: number | null; createdAt: Date; updatedAt: Date; deletedAt: Date | null; latitude: number | null; longitude: number | null; tags: string[]; approxYear: number | null; approxMonth: number | null }
type MediaRow = { id: string; memoryId: string; status: string; mimeType: string; originalFilename: string | null; durationSeconds: number | null; width: number | null; height: number | null; caption: string | null; approxDateText: string | null; place: string | null; sortOrder: number; deletedAt: Date | null; purgedAt: Date | null; createdAt: Date; blobUrl: string | null; storageKey: string; exif: unknown; replacesMediaId: string | null; derivatives: Array<{ kind: string; status: string }>; latitude: number | null; longitude: number | null }
interface Rev { memoryId: string; changedVia: string; before: Record<string, unknown>; after: Record<string, unknown>; createdAt?: Date; id?: string }
interface EmailRow { memoryId: string; emailType: string; status: string; sentAt: Date | null; attempts: number; createdAt: Date; recipientEmail: string }

let memories: MemoryRow[] = [];
let contributors: ContributorRow[] = [];
let media: MediaRow[] = [];
let revisions: Rev[] = [];
let emails: EmailRow[] = [];
const lockCalls: string[] = [];
let memorial: { id: string; slug: string } | null = { id: "memorial_1", slug: "jo" };

function contributorOf(m: MemoryRow): ContributorRow | null {
  return contributors.find((c) => c.id === m.contributorId) ?? null;
}
function matchesScalar(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") { return (v as Record<string, unknown>[]).some((w) => matchesScalar(row, w)); }
    if (k === "contributor") {
      const c = row.contributor as Record<string, unknown> | null;
      return c !== null && matchesScalar(c, v as Record<string, unknown>);
    }
    const actual = row[k];
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      const cond = v as { not?: unknown; contains?: string; mode?: string; in?: unknown[] };
      if ("not" in cond) { return actual !== cond.not; }
      if ("in" in cond) { return (cond.in ?? []).includes(actual); }
      if ("contains" in cond) { return typeof actual === "string" && actual.toLowerCase().includes((cond.contains ?? "").toLowerCase()); }
      return true;
    }
    return actual === v;
  });
}
function withRelations(m: MemoryRow) {
  return { ...m, contributor: contributorOf(m), media: media.filter((x) => x.memoryId === m.id && x.deletedAt === null), revisions: revisions.filter((r) => r.memoryId === m.id), emails: emails.filter((e) => e.memoryId === m.id) };
}

const tx = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    // The budget's one read (issue #44) is answered from the memories table; every other raw query is a row lock.
    if (isBudgetStatsQuery(strings)) {
      return [budgetStats({ memories: memories.filter((m): m is typeof m & { createdAt: Date } => (m as { createdAt?: unknown }).createdAt instanceof Date), media: [], derived: [] })];
    }
    lockCalls.push(`${strings.join("?")}|${String(values[0])}`);
    return [{ id: values[0] }];
  }),
  // The budget's advisory lock (issue #44) goes through $executeRaw after a SET LOCAL; the admin draft path is one of its callers.
  $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => { lockCalls.push(`${strings.join("?")}|${String(values[0])}`); return 1; }),
  memorial: { findUnique: vi.fn(async () => memorial) },
  memory: {
    findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) => memories.map(withRelations).filter((r) => matchesScalar(r, where)).slice(0, take ?? 1000)),
    count: vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => memories.map(withRelations).filter((r) => !where || matchesScalar(r, where)).length),
    groupBy: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const out = new Map<string, number>();
      for (const m of memories.filter((r) => matchesScalar(r, where))) { out.set(m.status, (out.get(m.status) ?? 0) + 1); }
      return [...out].map(([status, n]) => ({ status, _count: { _all: n } }));
    }),
    findUnique: vi.fn(async ({ where }: { where: { id?: string; sourceRef?: string } }) => {
      const m = memories.find((r) => (where.id !== undefined ? r.id === where.id : r.sourceRef === where.sourceRef));
      return m ? withRelations(m) : null;
    }),
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
      const m = memories.find((r) => r.id === where.id);
      if (!m) { throw Object.assign(new Error("not found"), { code: "P2025" }); }
      return withRelations(m);
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { const m = memories.find((r) => r.id === where.id)!; Object.assign(m, data, { updatedAt: new Date(m.updatedAt.getTime() + 1000) }); return m; }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `mem_${memories.length + 1}`, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, submissionId: null, submissionIndex: null, ...data } as MemoryRow; memories.push(row); return row; }),
  },
  contributor: {
    findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => { const c = contributors.find((r) => r.id === where.id); if (!c) { throw new Error("not found"); } return c; }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { const c = contributors.find((r) => r.id === where.id)!; Object.assign(c, data, { updatedAt: new Date(c.updatedAt.getTime() + 1000) }); return c; }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `con_${contributors.length + 1}`, updatedAt: new Date(), ...data } as ContributorRow; contributors.push(row); return row; }),
  },
  media: {
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => media.filter((r) => matchesScalar(r, where)).length),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => media.filter((r) => matchesScalar(r, where))),
    aggregate: vi.fn(async () => ({ _sum: { maxBytes: null } })),
  },
  memoryRevision: {
    count: vi.fn(async ({ where }: { where: { memoryId: string } }) => revisions.filter((r) => r.memoryId === where.memoryId).length),
    create: vi.fn(async ({ data }: { data: Rev }) => { const row = { id: `rev_${revisions.length + 1}`, createdAt: new Date(), ...data }; revisions.push(row); return row; }),
  },
};
const dbStub = { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
vi.mock("@/server/db/client", () => ({ getDb: () => dbStub }));

import { createDraftAsAdmin } from "@/features/admin/create-draft";
import { getMemoryForAdmin } from "@/features/admin/get-memory";
import { adminStatusCounts, listMemoriesForAdmin } from "@/features/admin/list-memories";
import { setMemoryDeletedAsAdmin } from "@/features/admin/set-deleted";
import { setMemoryStatusAsAdmin } from "@/features/admin/set-status";
import { updateMemoryAsAdmin } from "@/features/admin/update-memory";

function memoryRow(over: Partial<MemoryRow>): MemoryRow {
  return { id: MEM, memorialId: "memorial_1", contributorId: CON, type: "PHOTO", source: "WEB_UPLOAD", sourceRef: null, visibility: "FAMILY", approxDateText: "Summer 1998", place: null, contributorNote: "old note", notifyWhenPosted: true, consentVersion: "2026-11-v2", consentedAt: T0, status: "PENDING", claimTokenHash: "h".repeat(64), submissionId: null, submissionIndex: null, createdAt: T0, updatedAt: T0, deletedAt: null, latitude: null, longitude: null, tags: [], approxYear: null, approxMonth: null, ...over };
}
function mediaRow(over: Partial<MediaRow>): MediaRow {
  return { id: "med_1", memoryId: MEM, status: "READY", mimeType: "image/jpeg", originalFilename: "a.jpg", durationSeconds: null, width: 10, height: 10, caption: null, approxDateText: null, place: null, sortOrder: 0, deletedAt: null, purgedAt: null, createdAt: T0, blobUrl: "https://blob/x", storageKey: "originals/x/a.jpg", exif: { gps: 1 }, replacesMediaId: null, derivatives: [{ kind: "WEB_IMAGE", status: "READY" }, { kind: "THUMBNAIL", status: "READY" }], latitude: null, longitude: null, ...over };
}
const versions = () => ({ memoryVersion: memories.find((m) => m.id === MEM)!.updatedAt.toISOString(), contributorVersion: contributors[0]!.updatedAt.toISOString() });

beforeEach(() => {
  memories = [memoryRow({})];
  contributors = [{ id: CON, name: "Joyce", email: "joyce@example.com", relationship: "friend", phone: null, contactOptIn: true, mailingListOptIn: false, updatedAt: T0 }];
  media = [mediaRow({})];
  revisions = [];
  emails = [];
  lockCalls.length = 0;
  memorial = { id: "memorial_1", slug: "jo" };
  for (const fn of [tx.memory.findMany, tx.memory.count, tx.memory.groupBy, tx.memory.create, tx.memoryRevision.create]) { fn.mockClear(); }
  process.env.UPLOAD_TICKET_SECRET = "s".repeat(32);
  process.env.DAILY_MEMORY_BUDGET = "3";
  process.env.MEMORIAL_SLUG = "jo";
  process.env.CONSENT_VERSION = "2026-11-v2";
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.jowray.com";
  resetEnvCache();
});

describe("listMemoriesForAdmin (V6)", () => {
  it("lists live memories newest first, 200 at a time, with contributor and media summary and no token hash", async () => {
    media.push(mediaRow({ id: "med_2", status: "PENDING", mimeType: "video/mp4" }), mediaRow({ id: "med_3", status: "FAILED", mimeType: "audio/mp4" }), mediaRow({ id: "med_4", deletedAt: T1 }));
    memories.push(memoryRow({ id: MEM2, deletedAt: T1, contributorNote: "gone" }));
    const result = await listMemoriesForAdmin({});
    expect(result.ok).toBe(true);
    if (!result.ok) { return; }
    expect(tx.memory.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { deletedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200 }));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: MEM, status: "PENDING", contributor: { name: "Joyce", email: "joyce@example.com", relationship: "friend" }, excerpt: "old note", media: { ready: 1, pending: 1, failed: 1, photos: 1, videos: 1, audios: 1 } });
    expect(JSON.stringify(result)).not.toContain("h".repeat(64));
    expect(result.total).toBe(1);
    expect(result.shown).toBe(1);
  });

  it("filters by status and by deleted, and searches four fields case-insensitively", async () => {
    await listMemoriesForAdmin({ status: "APPROVED" });
    expect(tx.memory.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { deletedAt: null, status: "APPROVED" } }));
    await listMemoriesForAdmin({ deleted: "on" });
    expect(tx.memory.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { deletedAt: { not: null } } }));
    await listMemoriesForAdmin({ q: "Joyce" });
    const contains = { contains: "Joyce", mode: "insensitive" };
    expect(tx.memory.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { deletedAt: null, OR: [{ contributorNote: contains }, { place: contains }, { contributor: { name: contains } }, { contributor: { email: contains } }] },
    }));
    expect(tx.memory.count).toHaveBeenLastCalledWith({ where: { deletedAt: null, OR: [{ contributorNote: contains }, { place: contains }, { contributor: { name: contains } }, { contributor: { email: contains } }] } });
  });

  it("collapses whitespace and cuts the excerpt at 160 characters", async () => {
    memories[0]!.contributorNote = `  a \n\n  b ${"x".repeat(200)}`;
    const result = await listMemoriesForAdmin({});
    if (!result.ok) { throw new Error("setup"); }
    expect(result.rows[0]!.excerpt).toBe(`a b ${"x".repeat(156)}…`);
    expect(result.rows[0]!.excerpt.length).toBe(161);
  });

  it("reports total and shown when the list is truncated, and refuses a bad query", async () => {
    tx.memory.count.mockResolvedValueOnce(450);
    const result = await listMemoriesForAdmin({});
    if (!result.ok) { throw new Error("setup"); }
    expect(result.total).toBe(450);
    expect(result.shown).toBe(1);
    expect(await listMemoriesForAdmin({ status: "NOPE" })).toEqual({ ok: false, code: "invalid" });
  });

  it("leaves coordinates out of every row by default and adds them only when asked (plan 2026-11-06 §4.2)", async () => {
    memories[0] = memoryRow({ latitude: 39.4815, longitude: -76.6447 });
    memories.push(memoryRow({ id: MEM2, createdAt: T1 }));
    const plain = await listMemoriesForAdmin({});
    if (!plain.ok) { throw new Error("setup"); }
    for (const row of plain.rows) { expect(row).not.toHaveProperty("coordinates"); }
    expect(JSON.stringify(plain)).not.toMatch(/coordinates|latitude|longitude|39\.4815/);
    const withCoordinates = await listMemoriesForAdmin({}, { includeCoordinates: true });
    if (!withCoordinates.ok) { throw new Error("setup"); }
    expect(withCoordinates.rows.map((r) => [r.id, r.coordinates])).toEqual([[MEM, { latitude: 39.4815, longitude: -76.6447 }], [MEM2, null]]);
  });

  it("counts by status over live rows, plus the deleted ones", async () => {
    memories.push(memoryRow({ id: MEM2, status: "APPROVED" }), memoryRow({ id: "m3", status: "DRAFT", deletedAt: T1 }));
    expect(await adminStatusCounts()).toEqual({ DRAFT: 0, PENDING: 1, APPROVED: 1, HIDDEN: 0, deleted: 1, total: 2 });
    expect(tx.memory.groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ["status"], where: { deletedAt: null } }));
  });
});

describe("getMemoryForAdmin", () => {
  it("returns the detail view with versions, media flags, revisions and emails, and never the token hash, blob url, storage key or exif", async () => {
    revisions.push({ id: "r1", memoryId: MEM, changedVia: "CLAIM_LINK", before: { place: null }, after: { place: "x" }, createdAt: T1 });
    emails.push({ memoryId: MEM, emailType: "MEMORY_CONFIRMATION", status: "SENT", sentAt: T1, attempts: 1, createdAt: T0, recipientEmail: "joyce@example.com" });
    media.push(mediaRow({ id: "med_p", purgedAt: T1, status: "FAILED", derivatives: [] }));
    const view = await getMemoryForAdmin(MEM);
    expect(view).toMatchObject({
      id: MEM, status: "PENDING", memoryVersion: T0.toISOString(),
      contributor: { id: CON, name: "Joyce", email: "joyce@example.com", contactOptIn: true, mailingListOptIn: false, contributorVersion: T0.toISOString() },
      revisions: [{ id: "r1", changedVia: "CLAIM_LINK", before: { place: null }, after: { place: "x" } }],
      emails: [{ emailType: "MEMORY_CONFIRMATION", status: "SENT", attempts: 1 }],
    });
    expect(view!.media.map((m) => [m.id, m.webReady, m.thumbReady, m.purged])).toEqual([["med_1", true, true, false], ["med_p", false, false, true]]);
    const json = JSON.stringify(view);
    for (const secret of ["h".repeat(64), "https://blob/x", "originals/x/a.jpg", "gps", "recipientEmail"]) {
      expect(json).not.toContain(secret);
    }
  });

  describe("coordinates (plan 2026-11-06 §4.2: set through /api/mcp and the admin draft API, read only through /api/mcp)", () => {
    const BROADMEAD = { latitude: 39.4815, longitude: -76.6447 };
    beforeEach(() => {
      memories[0] = memoryRow({ place: "Broadmead", latitude: BROADMEAD.latitude, longitude: BROADMEAD.longitude });
      revisions.push(
        // The draft's creation revision: coordinates beside everything else it wrote.
        { id: "r_create", memoryId: MEM, changedVia: "ADMIN", before: {}, after: { note: "old note", place: "Broadmead", coordinates: null, consentVersion: "2026-11-v2" }, createdAt: T0 },
        // A set_coordinates revision: nothing but coordinates.
        { id: "r_coords", memoryId: MEM, changedVia: "ADMIN", before: { coordinates: null }, after: { coordinates: BROADMEAD }, createdAt: T1 },
        // A place edit: no coordinates involved.
        { id: "r_place", memoryId: MEM, changedVia: "ADMIN", before: { place: null }, after: { place: "Broadmead" }, createdAt: T1 },
        // An empty pair that never held coordinates is left as it was.
        { id: "r_empty", memoryId: MEM, changedVia: "ADMIN", before: {}, after: {}, createdAt: T1 },
      );
    });

    it("the default view (the admin page) has no coordinates anywhere, drops coordinate-only revisions and keeps the rest", async () => {
      const view = await getMemoryForAdmin(MEM);
      expect(view).not.toBeNull();
      expect(view).not.toHaveProperty("coordinates");
      expect(JSON.stringify(view)).not.toMatch(/coordinates|latitude|longitude|39\.4815|-76\.6447/);
      expect(view!.revisions.map((r) => r.id)).toEqual(["r_create", "r_place", "r_empty"]);
      expect(view!.revisions[0]).toMatchObject({ before: {}, after: { note: "old note", place: "Broadmead", consentVersion: "2026-11-v2" } });
      expect(view!.revisions[1]).toMatchObject({ before: { place: null }, after: { place: "Broadmead" } });
    });

    it("the opt-in view carries the pair and every revision unchanged", async () => {
      const view = await getMemoryForAdmin(MEM, { includeCoordinates: true });
      expect(view!.coordinates).toEqual(BROADMEAD);
      expect(view!.revisions.map((r) => r.id)).toEqual(["r_create", "r_coords", "r_place", "r_empty"]);
      expect(view!.revisions[0]!.after).toHaveProperty("coordinates", null);
      expect(view!.revisions[1]).toMatchObject({ before: { coordinates: null }, after: { coordinates: BROADMEAD } });
    });

    it("the opt-in view says coordinates: null for a memory without them", async () => {
      memories[0] = memoryRow({});
      expect((await getMemoryForAdmin(MEM, { includeCoordinates: true }))!.coordinates).toBeNull();
    });

    describe("per-photo coordinates (plan 2026-11-06-photo-gps-places B7, C39)", () => {
      const LIBERTY = { latitude: 40.689247, longitude: -74.044502 };
      beforeEach(() => {
        media = [mediaRow({ latitude: LIBERTY.latitude, longitude: LIBERTY.longitude }), mediaRow({ id: "med_2", originalFilename: "b.jpg", sortOrder: 1 })];
      });

      it("the admin page's view: no photo carries coordinates, and the photo's point appears nowhere in it", async () => {
        const view = await getMemoryForAdmin(MEM);
        expect(view!.media).toHaveLength(2);
        for (const item of view!.media) {
          expect(item).not.toHaveProperty("coordinates");
        }
        expect(JSON.stringify(view)).not.toMatch(/40\.68|74\.04|latitude|longitude/);
      });

      it("the opt-in view (the MCP tools): each photo carries its pair, or null without GPS", async () => {
        const view = await getMemoryForAdmin(MEM, { includeCoordinates: true });
        expect(view!.media.map((item) => [item.id, item.coordinates])).toEqual([["med_1", LIBERTY], ["med_2", null]]);
      });
    });

    it("does not change the revisions it was given (stripping works on copies)", async () => {
      await getMemoryForAdmin(MEM);
      expect(revisions.find((r) => r.id === "r_create")!.after).toHaveProperty("coordinates", null);
    });
  });

  it("returns a deleted memory with its deletedAt, and null for an unknown id", async () => {
    memories[0]!.deletedAt = T1;
    expect((await getMemoryForAdmin(MEM))?.deletedAt).toEqual(T1);
    expect(await getMemoryForAdmin(MEM2)).toBeNull();
  });
});

describe("updateMemoryAsAdmin (V7)", () => {
  it("locks memory then contributor, writes only the dirty keys and one ADMIN revision with exactly those keys", async () => {
    const before = versions();
    const result = await updateMemoryAsAdmin({ memoryId: MEM, ...before, changes: { name: "Joyce G", place: "Baltimore" } });
    // The post-write versions come back so the form can keep its typed values and save again without a reload.
    // The committed snapshot comes back (every editable value plus both post-write versions) so the form can
    // keep its typed values, refresh what it did not touch, and save again without a reload.
    expect(result).toEqual({ ok: true, written: ["name", "place"], current: { name: "Joyce G", relationship: "friend", approxDateText: "Summer 1998", place: "Baltimore", note: "old note", visibility: "FAMILY", tags: [], approxYear: null, approxMonth: null, memoryVersion: memories[0]!.updatedAt.toISOString(), contributorVersion: contributors[0]!.updatedAt.toISOString() } });
    if (!result.ok) { return; }
    expect(result.current.memoryVersion).not.toBe(before.memoryVersion);
    expect(result.current.contributorVersion).not.toBe(before.contributorVersion);
    expect(lockCalls.map((c) => c.split("|")[0]!.includes('"Memory"') ? "memory" : "contributor")).toEqual(["memory", "contributor"]);
    expect(memories[0]).toMatchObject({ place: "Baltimore", contributorNote: "old note", approxDateText: "Summer 1998" });
    expect(contributors[0]).toMatchObject({ name: "Joyce G", relationship: "friend" });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ memoryId: MEM, changedVia: "ADMIN", before: { name: "Joyce", place: null }, after: { name: "Joyce G", place: "Baltimore", consentVersion: "2026-11-v2" } });
    expect(Object.keys(revisions[0]!.before)).toEqual(["name", "place"]);
    // The returned versions open the next save without a reload.
    expect(await updateMemoryAsAdmin({ memoryId: MEM, memoryVersion: result.current.memoryVersion, contributorVersion: result.current.contributorVersion, changes: { place: "Ocean City" } })).toMatchObject({ ok: true, written: ["place"] });
  });

  it("takes only the memory lock when no contributor key is dirty", async () => {
    const result = await updateMemoryAsAdmin({ memoryId: MEM, ...versions(), changes: { visibility: "PUBLIC" } });
    expect(result).toMatchObject({ ok: true, written: ["visibility"], current: { visibility: "PUBLIC", contributorVersion: T0.toISOString() } });
    expect(lockCalls).toHaveLength(1);
    expect(lockCalls[0]).toContain('"Memory"');
    expect(memories[0]!.visibility).toBe("PUBLIC");
  });

  it("answers stale with the current editable values when the memory version is old, and a second save with those versions succeeds", async () => {
    const stale = versions();
    memories[0]!.place = "changed elsewhere";
    memories[0]!.updatedAt = T1;
    const result = await updateMemoryAsAdmin({ memoryId: MEM, ...stale, changes: { note: "my words" } });
    expect(result).toMatchObject({ ok: false, code: "stale", current: { name: "Joyce", relationship: "friend", approxDateText: "Summer 1998", place: "changed elsewhere", note: "old note", visibility: "FAMILY", memoryVersion: T1.toISOString(), contributorVersion: T0.toISOString() } });
    expect(memories[0]!.contributorNote).toBe("old note");
    expect(revisions).toHaveLength(0);
    if (result.ok || result.code !== "stale") { throw new Error("setup"); }
    const again = await updateMemoryAsAdmin({ memoryId: MEM, memoryVersion: result.current.memoryVersion, contributorVersion: result.current.contributorVersion, changes: { note: "my words" } });
    expect(again).toMatchObject({ ok: true, written: ["note"] });
    expect(memories[0]!.contributorNote).toBe("my words");
  });

  it("checks the contributor version only when a contributor key is dirty", async () => {
    const v = versions();
    contributors[0]!.updatedAt = T1;
    expect(await updateMemoryAsAdmin({ memoryId: MEM, ...v, changes: { place: "x" } })).toMatchObject({ ok: true, written: ["place"] });
    expect(await updateMemoryAsAdmin({ memoryId: MEM, memoryVersion: memories[0]!.updatedAt.toISOString(), contributorVersion: v.contributorVersion, changes: { name: "y" } })).toMatchObject({ ok: false, code: "stale" });
  });

  it("drops keys equal to the fresh value; nothing left means ok with no revision", async () => {
    expect(await updateMemoryAsAdmin({ memoryId: MEM, ...versions(), changes: { place: "", approxDateText: "Summer 1998", name: "Joyce" } })).toEqual({ ok: true, written: [], current: { name: "Joyce", relationship: "friend", approxDateText: "Summer 1998", place: null, note: "old note", visibility: "FAMILY", tags: [], approxYear: null, approxMonth: null, ...versions() } });
    expect(revisions).toHaveLength(0);
    expect(lockCalls).toHaveLength(2);
  });

  it("refuses to clear the last words when no READY file remains, and allows it when one does (type recomputed)", async () => {
    media[0]!.status = "PENDING";
    expect(await updateMemoryAsAdmin({ memoryId: MEM, ...versions(), changes: { note: "" } })).toEqual({ ok: false, code: "last_words" });
    expect(memories[0]!.contributorNote).toBe("old note");
    // A READY file already marked for purge is gone or going: it cannot hold the memory up.
    media[0]!.status = "READY";
    media[0]!.purgedAt = T1;
    expect(await updateMemoryAsAdmin({ memoryId: MEM, ...versions(), changes: { note: "" } })).toEqual({ ok: false, code: "last_words" });
    media[0]!.purgedAt = null;
    media[0]!.status = "READY";
    memories[0]!.type = "TEXT";
    expect(await updateMemoryAsAdmin({ memoryId: MEM, ...versions(), changes: { note: "" } })).toMatchObject({ ok: true, written: ["note"] });
    expect(memories[0]!.contributorNote).toBeNull();
    expect(memories[0]!.type).toBe("PHOTO");
  });

  it("answers not_found for a deleted or missing memory, invalid for a bad body, and never writes", async () => {
    expect(await updateMemoryAsAdmin({ memoryId: MEM, ...versions(), changes: { email: "x@y.z" } })).toEqual({ ok: false, code: "invalid" });
    expect(await updateMemoryAsAdmin({ memoryId: MEM2, ...versions(), changes: { place: "x" } })).toEqual({ ok: false, code: "not_found" });
    memories[0]!.deletedAt = T1;
    expect(await updateMemoryAsAdmin({ memoryId: MEM, ...versions(), changes: { place: "x" } })).toEqual({ ok: false, code: "not_found" });
    expect(revisions).toHaveLength(0);
    expect(memories[0]!.place).toBeNull();
  });

  it("edits a memory without a contributor (memory keys only; a contributor key is ignored as nothing to write)", async () => {
    memories[0]!.contributorId = null;
    expect(await updateMemoryAsAdmin({ memoryId: MEM, memoryVersion: T0.toISOString(), contributorVersion: null, changes: { place: "x", name: "nobody" } })).toMatchObject({ ok: true, written: ["place"], current: { name: null, place: "x", contributorVersion: null } });
    expect(lockCalls).toHaveLength(1);
  });
});

describe("sibling memories sharing one contributor (V8)", () => {
  beforeEach(() => { memories.push(memoryRow({ id: MEM2, submissionId: "sub", submissionIndex: 1 })); memories[0]!.submissionId = "sub"; memories[0]!.submissionIndex = 0; });

  it("the second admin to change any contributor key after the first committed sees stale", async () => {
    const a = versions();
    const b = { memoryVersion: memories[1]!.updatedAt.toISOString(), contributorVersion: contributors[0]!.updatedAt.toISOString() };
    expect(await updateMemoryAsAdmin({ memoryId: MEM, ...a, changes: { name: "A" } })).toMatchObject({ ok: true, written: ["name"] });
    expect(await updateMemoryAsAdmin({ memoryId: MEM2, ...b, changes: { relationship: "cousin" } })).toMatchObject({ ok: false, code: "stale", current: { name: "A" } });
    expect(contributors[0]!.relationship).toBe("friend");
  });

  it("a second save that changes only memory keys succeeds", async () => {
    const a = versions();
    const b = { memoryVersion: memories[1]!.updatedAt.toISOString(), contributorVersion: contributors[0]!.updatedAt.toISOString() };
    await updateMemoryAsAdmin({ memoryId: MEM, ...a, changes: { name: "A" } });
    expect(await updateMemoryAsAdmin({ memoryId: MEM2, ...b, changes: { place: "Ocean City" } })).toMatchObject({ ok: true, written: ["place"] });
  });
});

describe("setMemoryStatusAsAdmin (V9)", () => {
  it("moves between PENDING, APPROVED and HIDDEN with one ADMIN revision each; a no-op writes nothing", async () => {
    expect(await setMemoryStatusAsAdmin({ memoryId: MEM, status: "APPROVED" })).toEqual({ ok: true });
    expect(memories[0]!.status).toBe("APPROVED");
    expect(revisions[0]).toMatchObject({ changedVia: "ADMIN", before: { status: "PENDING" }, after: { status: "APPROVED", consentVersion: "2026-11-v2" } });
    expect(await setMemoryStatusAsAdmin({ memoryId: MEM, status: "APPROVED" })).toEqual({ ok: true });
    expect(revisions).toHaveLength(1);
    expect(await setMemoryStatusAsAdmin({ memoryId: MEM, status: "HIDDEN" })).toEqual({ ok: true });
    expect(await setMemoryStatusAsAdmin({ memoryId: MEM, status: "PENDING" })).toEqual({ ok: true });
    expect(memories[0]!.status).toBe("PENDING");
    expect(revisions).toHaveLength(3);
    expect(lockCalls.every((c) => c.includes('"Memory"'))).toBe(true);
  });

  it("refuses a DRAFT (only Share leaves it), a deleted memory, a missing one and DRAFT as a target", async () => {
    memories[0]!.status = "DRAFT";
    memories[0]!.consentedAt = null;
    expect(await setMemoryStatusAsAdmin({ memoryId: MEM, status: "APPROVED" })).toEqual({ ok: false, code: "draft" });
    expect(await setMemoryStatusAsAdmin({ memoryId: MEM, status: "PENDING" })).toEqual({ ok: false, code: "draft" });
    memories[0]!.status = "PENDING";
    expect(await setMemoryStatusAsAdmin({ memoryId: MEM, status: "DRAFT" })).toEqual({ ok: false, code: "invalid" });
    memories[0]!.deletedAt = T1;
    expect(await setMemoryStatusAsAdmin({ memoryId: MEM, status: "APPROVED" })).toEqual({ ok: false, code: "not_found" });
    expect(await setMemoryStatusAsAdmin({ memoryId: MEM2, status: "APPROVED" })).toEqual({ ok: false, code: "not_found" });
    expect(revisions).toHaveLength(0);
    expect(memories[0]!.status).toBe("PENDING");
  });
});

describe("setMemoryDeletedAsAdmin (V10)", () => {
  it("soft-deletes and restores under the lock with a revision each; repeating is a no-op", async () => {
    expect(await setMemoryDeletedAsAdmin({ memoryId: MEM, deleted: true })).toEqual({ ok: true, purgedFiles: 0 });
    expect(memories[0]!.deletedAt).toBeInstanceOf(Date);
    expect(revisions[0]).toMatchObject({ changedVia: "ADMIN", before: { deletedAt: null } });
    expect((revisions[0]!.after.deletedAt as string)).toMatch(/^2026-/);
    expect(await setMemoryDeletedAsAdmin({ memoryId: MEM, deleted: true })).toEqual({ ok: true, purgedFiles: 0 });
    expect(revisions).toHaveLength(1);
    expect(await setMemoryDeletedAsAdmin({ memoryId: MEM, deleted: false })).toEqual({ ok: true, purgedFiles: 0 });
    expect(memories[0]!.deletedAt).toBeNull();
    expect(revisions[1]).toMatchObject({ after: { deletedAt: null } });
    expect(lockCalls).toHaveLength(3);
  });

  it("restore reports how many live files were purged (purgedAt set), and a missing memory is not_found", async () => {
    media.push(mediaRow({ id: "med_p", purgedAt: T1, status: "FAILED" }), mediaRow({ id: "med_p_removed", purgedAt: T1, deletedAt: T1 }));
    memories[0]!.deletedAt = T1;
    expect(await setMemoryDeletedAsAdmin({ memoryId: MEM, deleted: false })).toEqual({ ok: true, purgedFiles: 1 });
    expect(await setMemoryDeletedAsAdmin({ memoryId: MEM2, deleted: false })).toEqual({ ok: false, code: "not_found" });
    expect(await setMemoryDeletedAsAdmin({ memoryId: MEM, deleted: "yes" })).toEqual({ ok: false, code: "invalid" });
  });
});

describe("createDraftAsAdmin (V11)", () => {
  const form = { name: "Bridget", email: "Bridget@Example.org", relationship: "Church", note: "Jo sang in the choir.\n\nWe loved her.", approxDateText: "", place: "", visibility: "PUBLIC" };

  it("drafts through the real draftMemory as source OTHER with an other: reference and returns the id and claim link", async () => {
    memories = [];
    const result = await createDraftAsAdmin(form);
    expect(result).toMatchObject({ ok: true, memoryId: "mem_1" });
    if (!result.ok) { return; }
    expect(result.claimLink).toMatch(/^https:\/\/www\.jowray\.com\/m\/[A-Za-z0-9_-]{43}$/);
    expect(Object.keys(result)).toEqual(["ok", "memoryId", "claimLink"]);
    expect(memories[0]).toMatchObject({ status: "DRAFT", source: "OTHER", type: "TEXT", contributorNote: form.note, visibility: "PUBLIC", consentedAt: null });
    expect(memories[0]!.sourceRef).toMatch(/^other:[0-9a-f]{32}$/);
    expect(contributors.at(-1)).toMatchObject({ name: "Bridget", email: "bridget@example.org", relationship: "Church" });
  });

  it("answers duplicate with the existing row's id, status and deletedAt (a re-paste never makes a second draft)", async () => {
    memories = [];
    const first = await createDraftAsAdmin(form);
    if (!first.ok) { throw new Error("setup"); }
    memories[0]!.status = "PENDING";
    memories[0]!.deletedAt = T1;
    expect(await createDraftAsAdmin({ ...form, email: " bridget@example.org ", note: `${form.note}\n` })).toEqual({ ok: false, code: "duplicate", memoryId: "mem_1", status: "PENDING", deletedAt: T1 });
    expect(memories).toHaveLength(1);
  });

  it("refuses invalid input before anything is written, and passes budget_exceeded through", async () => {
    expect(await createDraftAsAdmin({ ...form, email: "" })).toEqual({ ok: false, code: "invalid" });
    expect(await createDraftAsAdmin({ ...form, note: " " })).toEqual({ ok: false, code: "invalid" });
    expect(await createDraftAsAdmin({ ...form, source: "EMAIL" })).toEqual({ ok: false, code: "invalid" });
    expect(tx.memory.create).not.toHaveBeenCalled();
    // The budget counts the last 24 h (issue #44); the seeded memory must be today's to spend the one slot.
    for (const row of memories) { row.createdAt = new Date(); }
    process.env.DAILY_MEMORY_BUDGET = "1";
    resetEnvCache();
    expect(await createDraftAsAdmin(form)).toEqual({ ok: false, code: "budget_exceeded" });
  });
});

describe("updateMemoryAsAdmin: patches, year and month (plan 2026-11-08 D3, D4)", () => {
  it("writes normalised tags, the year and the month with one ADMIN revision naming exactly those keys", async () => {
    const result = await updateMemoryAsAdmin({ memoryId: MEM, ...versions(), changes: { tags: [" quilting ", "Café", "cafe", "Ocean  City"], approxYear: 1985, approxMonth: 7 } });
    expect(result).toMatchObject({ ok: true, written: ["tags", "approxYear", "approxMonth"], current: { tags: ["quilting", "Café", "Ocean City"], approxYear: 1985, approxMonth: 7 } });
    expect(memories[0]).toMatchObject({ tags: ["quilting", "Café", "Ocean City"], approxYear: 1985, approxMonth: 7 });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ changedVia: "ADMIN", before: { tags: [], approxYear: null, approxMonth: null }, after: { tags: ["quilting", "Café", "Ocean City"], approxYear: 1985, approxMonth: 7 } });
    expect(Object.keys(revisions[0]!.before)).toEqual(["tags", "approxYear", "approxMonth"]);
  });

  it("treats the same tags in the same order as unchanged, and a new order as a change", async () => {
    memories[0]!.tags = ["quilting", "church"];
    expect(await updateMemoryAsAdmin({ memoryId: MEM, ...versions(), changes: { tags: ["quilting", "church"] } })).toMatchObject({ ok: true, written: [] });
    expect(revisions).toHaveLength(0);
    expect(await updateMemoryAsAdmin({ memoryId: MEM, ...versions(), changes: { tags: ["church", "quilting"] } })).toMatchObject({ ok: true, written: ["tags"] });
  });

  it("clears tags with [] and the year and month with null", async () => {
    Object.assign(memories[0]!, { tags: ["quilting"], approxYear: 1985, approxMonth: 7 });
    expect(await updateMemoryAsAdmin({ memoryId: MEM, ...versions(), changes: { tags: [], approxYear: null, approxMonth: null } })).toMatchObject({ ok: true, written: ["tags", "approxYear", "approxMonth"] });
    expect(memories[0]).toMatchObject({ tags: [], approxYear: null, approxMonth: null });
  });

  it("refuses a month without a year, judging the stored year when the save does not send one", async () => {
    expect(await updateMemoryAsAdmin({ memoryId: MEM, ...versions(), changes: { approxMonth: 3 } })).toEqual({ ok: false, code: "invalid" });
    expect(memories[0]!.approxMonth).toBeNull();
    memories[0]!.approxYear = 1960;
    expect(await updateMemoryAsAdmin({ memoryId: MEM, ...versions(), changes: { approxMonth: 3 } })).toMatchObject({ ok: true, written: ["approxMonth"] });
    // Clearing the year while a month is stored is refused too: the month would be left without a year.
    expect(await updateMemoryAsAdmin({ memoryId: MEM, ...versions(), changes: { approxYear: null } })).toEqual({ ok: false, code: "invalid" });
    expect(memories[0]).toMatchObject({ approxYear: 1960, approxMonth: 3 });
    expect(revisions).toHaveLength(1);
  });

  it("refuses a punctuation-only patch, a 41-character patch, 21 patches and a year outside 1900 to this year", async () => {
    for (const changes of [{ tags: ["!!!"] }, { tags: ["x".repeat(41)] }, { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, { approxYear: 1899 }, { approxYear: new Date().getUTCFullYear() + 1 }, { approxMonth: 13 }]) {
      expect(await updateMemoryAsAdmin({ memoryId: MEM, ...versions(), changes })).toEqual({ ok: false, code: "invalid" });
    }
    expect(revisions).toHaveLength(0);
  });

  it("returns the tags and the year and month in the admin view", async () => {
    Object.assign(memories[0]!, { tags: ["quilting"], approxYear: 1985, approxMonth: null });
    expect(await getMemoryForAdmin(MEM)).toMatchObject({ tags: ["quilting"], approxYear: 1985, approxMonth: null });
  });
});
