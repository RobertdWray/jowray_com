import "server-only";

import { TX_OPTIONS } from "@/features/memories/create-memory";
import { lockContributor, lockMemory } from "@/features/memories/lock";
import { appendRevision, hasWords, recomputeMemoryType } from "@/features/memories/media-state";
import { createLogger } from "@/lib/logger";
import { tagsEqual } from "@/lib/memories/tags";
import { adminMemoryChangesSchema, type AdminMemoryChanges } from "@/lib/validations/admin";
import { getDb } from "@/server/db/client";

const log = createLogger({ category: "api" });

/** What the edit form holds, returned on `stale` so the form can show what changed and retry with fresh versions. */
export interface AdminMemoryEditable {
  name: string | null;
  relationship: string | null;
  approxDateText: string | null;
  place: string | null;
  note: string | null;
  visibility: "PUBLIC" | "FAMILY" | "PRIVATE";
  /** The memory's patches, as stored (plan 2026-11-08 D3). */
  tags: string[];
  /** The year and month the family set; null = read the year from `approxDateText` (D4). */
  approxYear: number | null;
  approxMonth: number | null;
  memoryVersion: string;
  contributorVersion: string | null;
}

export type AdminUpdateResult =
  /** `current` is the committed snapshot after the write (every editable value and both versions): the form keeps what it typed, refreshes what it did not touch, and saves again without a reload. */
  | { ok: true; written: Array<keyof AdminMemoryChanges>; current: AdminMemoryEditable }
  | { ok: false; code: "invalid" | "not_found" | "last_words" }
  | { ok: false; code: "stale"; current: AdminMemoryEditable };

const MEMORY_KEYS = ["approxDateText", "place", "note", "visibility", "tags", "approxYear", "approxMonth"] as const;
const CONTRIBUTOR_KEYS = ["name", "relationship"] as const;
type MemoryKey = (typeof MEMORY_KEYS)[number];
type ContributorKey = (typeof CONTRIBUTOR_KEYS)[number];

/** Revision snapshots use the column names, like the claim page's revisions, so the history reads the same for both. */
const REVISION_KEY: Record<keyof AdminMemoryChanges, string> = {
  name: "name",
  relationship: "relationship",
  approxDateText: "approxDateText",
  place: "place",
  note: "contributorNote",
  visibility: "visibility",
  tags: "tags",
  approxYear: "approxYear",
  approxMonth: "approxMonth",
};

/** Whether a dirty key's value differs from the stored one (`tags` is a list, compared in order). */
function differs(key: MemoryKey | ContributorKey, changes: AdminMemoryChanges, current: AdminMemoryEditable): boolean {
  if (key === "tags") {
    return changes.tags !== undefined && !tagsEqual(changes.tags, current.tags);
  }
  return changes[key] !== current[key];
}

/**
 * An admin save (plan §4.3): only dirty keys arrive, with the versions the
 * form was opened with. Lock memory, then (if a contributor key is dirty) the
 * contributor; re-read; `stale` when either relevant version moved, carrying
 * the current values; drop keys already equal; refuse clearing the last words;
 * write the rest with one ADMIN revision naming exactly the written keys.
 */
export async function updateMemoryAsAdmin(raw: unknown): Promise<AdminUpdateResult> {
  const parsed = adminMemoryChangesSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const { memoryId, memoryVersion, contributorVersion, changes } = parsed.data;
  const dirtyMemoryKeys = MEMORY_KEYS.filter((key) => changes[key] !== undefined);
  const dirtyContributorKeys = CONTRIBUTOR_KEYS.filter((key) => changes[key] !== undefined);

  const result = await getDb().$transaction(async (tx) => {
    await lockMemory(tx, memoryId);
    const memory = await tx.memory.findUnique({
      where: { id: memoryId },
      select: { id: true, contributorId: true, deletedAt: true, updatedAt: true, consentVersion: true, approxDateText: true, place: true, contributorNote: true, visibility: true, tags: true, approxYear: true, approxMonth: true },
    });
    if (!memory || memory.deletedAt !== null) {
      return { code: "not_found" as const };
    }
    const contributorId = memory.contributorId;
    const wantsContributor = dirtyContributorKeys.length > 0 && contributorId !== null;
    if (wantsContributor) {
      await lockContributor(tx, contributorId);
    }
    const contributor = contributorId === null ? null : await tx.contributor.findUniqueOrThrow({ where: { id: contributorId }, select: { id: true, name: true, relationship: true, updatedAt: true } });
    const current: AdminMemoryEditable = {
      name: contributor?.name ?? null,
      relationship: contributor?.relationship ?? null,
      approxDateText: memory.approxDateText,
      place: memory.place,
      note: memory.contributorNote,
      visibility: memory.visibility,
      tags: memory.tags,
      approxYear: memory.approxYear,
      approxMonth: memory.approxMonth,
      memoryVersion: memory.updatedAt.toISOString(),
      contributorVersion: contributor?.updatedAt.toISOString() ?? null,
    };
    if (dirtyMemoryKeys.length > 0 && current.memoryVersion !== memoryVersion) {
      return { code: "stale" as const, current };
    }
    if (wantsContributor && current.contributorVersion !== contributorVersion) {
      return { code: "stale" as const, current };
    }
    const memoryWrites = dirtyMemoryKeys.filter((key) => differs(key, changes, current));
    const contributorWrites = wantsContributor ? dirtyContributorKeys.filter((key) => differs(key, changes, current)) : [];
    const written: Array<MemoryKey | ContributorKey> = [...contributorWrites, ...memoryWrites];
    if (written.length === 0) {
      return { code: "ok" as const, written, current };
    }
    // A month needs a year, judged on the values the memory would hold after this save (the schema only sees what was sent).
    const yearAfter = memoryWrites.includes("approxYear") ? (changes.approxYear ?? null) : current.approxYear;
    const monthAfter = memoryWrites.includes("approxMonth") ? (changes.approxMonth ?? null) : current.approxMonth;
    if (monthAfter !== null && yearAfter === null) {
      return { code: "invalid" as const };
    }
    const note = memoryWrites.includes("note") ? (changes.note ?? null) : current.note;
    if (hasWords(current.note) && !hasWords(note)) {
      // A file marked for purge is gone or going, whatever its status still says: it cannot hold the memory up.
      const readyFiles = await tx.media.count({ where: { memoryId, deletedAt: null, status: "READY", purgedAt: null } });
      if (readyFiles === 0) {
        return { code: "last_words" as const };
      }
    }
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of written) {
      before[REVISION_KEY[key]] = current[key];
      after[REVISION_KEY[key]] = changes[key];
    }
    if (memoryWrites.length > 0) {
      await tx.memory.update({
        where: { id: memoryId },
        data: {
          ...(memoryWrites.includes("approxDateText") && { approxDateText: changes.approxDateText ?? null }),
          ...(memoryWrites.includes("place") && { place: changes.place ?? null }),
          ...(memoryWrites.includes("note") && { contributorNote: note }),
          ...(memoryWrites.includes("visibility") && { visibility: changes.visibility }),
          ...(memoryWrites.includes("tags") && { tags: changes.tags }),
          ...(memoryWrites.includes("approxYear") && { approxYear: changes.approxYear ?? null }),
          ...(memoryWrites.includes("approxMonth") && { approxMonth: changes.approxMonth ?? null }),
        },
      });
    }
    if (contributorWrites.length > 0 && contributorId !== null) {
      await tx.contributor.update({
        where: { id: contributorId },
        data: {
          ...(contributorWrites.includes("name") && { name: changes.name ?? null }),
          ...(contributorWrites.includes("relationship") && { relationship: changes.relationship ?? null }),
        },
      });
    }
    if (hasWords(current.note) !== hasWords(note)) {
      await recomputeMemoryType(tx, memoryId, note);
    }
    await appendRevision(tx, { memoryId, changedVia: "ADMIN", before, after, consentVersion: memory.consentVersion });
    // The committed snapshot (`@updatedAt` moved the versions), read inside the same transaction.
    const memoryAfter = await tx.memory.findUniqueOrThrow({ where: { id: memoryId }, select: { updatedAt: true, approxDateText: true, place: true, contributorNote: true, visibility: true, tags: true, approxYear: true, approxMonth: true } });
    const contributorAfter = contributorId === null ? null : await tx.contributor.findUniqueOrThrow({ where: { id: contributorId }, select: { updatedAt: true, name: true, relationship: true } });
    const committed: AdminMemoryEditable = {
      name: contributorAfter?.name ?? null,
      relationship: contributorAfter?.relationship ?? null,
      approxDateText: memoryAfter.approxDateText,
      place: memoryAfter.place,
      note: memoryAfter.contributorNote,
      visibility: memoryAfter.visibility,
      tags: memoryAfter.tags,
      approxYear: memoryAfter.approxYear,
      approxMonth: memoryAfter.approxMonth,
      memoryVersion: memoryAfter.updatedAt.toISOString(),
      contributorVersion: contributorAfter?.updatedAt.toISOString() ?? null,
    };
    return { code: "ok" as const, written, current: committed };
  }, TX_OPTIONS);

  if (result.code === "ok") {
    if (result.written.length > 0) {
      log.info({ action: "admin_memory_updated", memoryId, keys: result.written }, "memory edited from the admin page");
    }
    return { ok: true, written: result.written, current: result.current };
  }
  if (result.code === "stale") {
    return { ok: false, code: "stale", current: result.current };
  }
  return { ok: false, code: result.code };
}
