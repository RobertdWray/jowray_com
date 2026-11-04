import "server-only";

import { TX_OPTIONS } from "@/features/memories/create-memory";
import { lockContributor, lockMemory } from "@/features/memories/lock";
import { appendRevision, hasWords, recomputeMemoryType } from "@/features/memories/media-state";
import { createLogger } from "@/lib/logger";
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
  memoryVersion: string;
  contributorVersion: string | null;
}

export type AdminUpdateResult =
  | { ok: true; written: Array<keyof AdminMemoryChanges> }
  | { ok: false; code: "invalid" | "not_found" | "last_words" }
  | { ok: false; code: "stale"; current: AdminMemoryEditable };

const MEMORY_KEYS = ["approxDateText", "place", "note", "visibility"] as const;
const CONTRIBUTOR_KEYS = ["name", "relationship"] as const;
type MemoryKey = (typeof MEMORY_KEYS)[number];
type ContributorKey = (typeof CONTRIBUTOR_KEYS)[number];

/** Revision snapshots use the column names, like the claim page's revisions, so the history reads the same for both. */
const REVISION_KEY: Record<keyof AdminMemoryChanges, string> = { name: "name", relationship: "relationship", approxDateText: "approxDateText", place: "place", note: "contributorNote", visibility: "visibility" };

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
      select: { id: true, contributorId: true, deletedAt: true, updatedAt: true, consentVersion: true, approxDateText: true, place: true, contributorNote: true, visibility: true },
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
      memoryVersion: memory.updatedAt.toISOString(),
      contributorVersion: contributor?.updatedAt.toISOString() ?? null,
    };
    if (dirtyMemoryKeys.length > 0 && current.memoryVersion !== memoryVersion) {
      return { code: "stale" as const, current };
    }
    if (wantsContributor && current.contributorVersion !== contributorVersion) {
      return { code: "stale" as const, current };
    }
    const memoryWrites = dirtyMemoryKeys.filter((key) => changes[key] !== current[key]);
    const contributorWrites = wantsContributor ? dirtyContributorKeys.filter((key) => changes[key] !== current[key]) : [];
    const written: Array<MemoryKey | ContributorKey> = [...contributorWrites, ...memoryWrites];
    if (written.length === 0) {
      return { code: "ok" as const, written };
    }
    const note = memoryWrites.includes("note") ? (changes.note ?? null) : current.note;
    if (hasWords(current.note) && !hasWords(note)) {
      const readyFiles = await tx.media.count({ where: { memoryId, deletedAt: null, status: "READY" } });
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
    return { code: "ok" as const, written };
  }, TX_OPTIONS);

  if (result.code === "ok") {
    if (result.written.length > 0) {
      log.info({ action: "admin_memory_updated", memoryId, keys: result.written }, "memory edited from the admin page");
    }
    return { ok: true, written: result.written };
  }
  if (result.code === "stale") {
    return { ok: false, code: "stale", current: result.current };
  }
  return { ok: false, code: result.code };
}
