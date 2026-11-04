import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { adminListQuerySchema, type AdminListQuery, type AdminMemoryStatus } from "@/lib/validations/admin";
import { getDb } from "@/server/db/client";

/** Rows per page; paging is follow-up A2. */
export const ADMIN_LIST_TAKE = 200;
const EXCERPT_CHARS = 160;

export interface AdminListRow {
  id: string;
  status: AdminMemoryStatus;
  type: "VOICE" | "VIDEO" | "PHOTO" | "TEXT";
  source: "PHONE_CALL" | "SMS" | "WEB_UPLOAD" | "EMAIL" | "OTHER";
  visibility: "PUBLIC" | "FAMILY" | "PRIVATE";
  createdAt: Date;
  consentedAt: Date | null;
  deletedAt: Date | null;
  contributor: { name: string | null; email: string | null; relationship: string | null } | null;
  /** First 160 characters of the words, whitespace collapsed, with an ellipsis when cut. */
  excerpt: string;
  media: { ready: number; pending: number; failed: number; photos: number; videos: number; audios: number };
}

export interface AdminStatusCounts {
  DRAFT: number;
  PENDING: number;
  APPROVED: number;
  HIDDEN: number;
  deleted: number;
  /** Live rows of every status. */
  total: number;
}

export type AdminListResult =
  | { ok: true; query: AdminListQuery; rows: AdminListRow[]; shown: number; total: number }
  | { ok: false; code: "invalid" };

export function excerptOf(note: string | null): string {
  const collapsed = (note ?? "").replace(/\s+/g, " ").trim();
  return collapsed.length > EXCERPT_CHARS ? `${collapsed.slice(0, EXCERPT_CHARS)}…` : collapsed;
}

function listWhere(query: AdminListQuery): Prisma.MemoryWhereInput {
  const contains = query.q === undefined ? null : ({ contains: query.q, mode: "insensitive" } as const);
  return {
    deletedAt: query.deleted ? { not: null } : null,
    ...(query.status && { status: query.status }),
    ...(contains && { OR: [{ contributorNote: contains }, { place: contains }, { contributor: { name: contains } }, { contributor: { email: contains } }] }),
  };
}

/**
 * The admin list (plan §3.5): live rows by default, the Deleted toggle shows
 * soft-deleted ones, an optional status and a case-insensitive search over the
 * words, the place and the contributor's name and email. Newest first, 200 at
 * a time, with the total so the page can say "Showing 200 of N".
 */
export async function listMemoriesForAdmin(raw: unknown): Promise<AdminListResult> {
  const parsed = adminListQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const query = parsed.data;
  const where = listWhere(query);
  const db = getDb();
  const [rows, total] = await Promise.all([
    db.memory.findMany({
      where,
      include: {
        contributor: { select: { name: true, email: true, relationship: true } },
        media: { where: { deletedAt: null }, select: { id: true, status: true, mimeType: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: ADMIN_LIST_TAKE,
    }),
    db.memory.count({ where }),
  ]);
  return {
    ok: true,
    query,
    shown: rows.length,
    total,
    rows: rows.map((row) => ({
      id: row.id,
      status: row.status,
      type: row.type,
      source: row.source,
      visibility: row.visibility,
      createdAt: row.createdAt,
      consentedAt: row.consentedAt,
      deletedAt: row.deletedAt,
      contributor: row.contributor,
      excerpt: excerptOf(row.contributorNote),
      media: {
        ready: row.media.filter((m) => m.status === "READY").length,
        pending: row.media.filter((m) => m.status === "PENDING").length,
        failed: row.media.filter((m) => m.status === "FAILED").length,
        photos: row.media.filter((m) => m.mimeType.startsWith("image/")).length,
        videos: row.media.filter((m) => m.mimeType.startsWith("video/")).length,
        audios: row.media.filter((m) => m.mimeType.startsWith("audio/")).length,
      },
    })),
  };
}

/** How many live memories sit in each status, plus the deleted ones, for the filter chips. */
export async function adminStatusCounts(): Promise<AdminStatusCounts> {
  const db = getDb();
  const [groups, deleted] = await Promise.all([
    db.memory.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
    db.memory.count({ where: { deletedAt: { not: null } } }),
  ]);
  const counts: AdminStatusCounts = { DRAFT: 0, PENDING: 0, APPROVED: 0, HIDDEN: 0, deleted, total: 0 };
  for (const group of groups) {
    counts[group.status] = group._count._all;
    counts.total += group._count._all;
  }
  return counts;
}
