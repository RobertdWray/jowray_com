import "server-only";

import { TX_OPTIONS } from "@/features/memories/create-memory";
import { lockMemory } from "@/features/memories/lock";
import { appendRevision } from "@/features/memories/media-state";
import { createLogger } from "@/lib/logger";
import { adminCoordinatesSchema } from "@/lib/validations/admin";
import { coordinatesOf, type Coordinates } from "@/lib/validations/memory";
import { getDb } from "@/server/db/client";

const log = createLogger({ category: "api" });

export type AdminCoordinatesResult =
  /** `changed: false` means the stored pair already equalled the request; nothing was written. */
  | { ok: true; changed: boolean }
  | { ok: false; code: "invalid" | "not_found" }
  /** The memory moved since `memoryVersion` was read: `current` opens the next attempt. */
  | { ok: false; code: "stale"; current: { memoryVersion: string; coordinates: Coordinates | null } };

function samePair(a: Coordinates | null, b: Coordinates | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.latitude === b.latitude && a.longitude === b.longitude;
}

/**
 * Set or clear a memory's coordinates (MCP `set_coordinates`; plan
 * 2026-11-06 §4.2). Lock the memory, re-read it, refuse a missing or deleted
 * one, answer `stale` when `memoryVersion` is not the row's `updatedAt` (as
 * update-memory.ts does), answer `changed: false` when the pair is already
 * equal, else write both columns with one ADMIN revision. `place` edits never
 * touch the coordinates and this never touches `place` (Rob, 2026-11-06).
 */
export async function setMemoryCoordinatesAsAdmin(raw: unknown): Promise<AdminCoordinatesResult> {
  const parsed = adminCoordinatesSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const { memoryId, memoryVersion, coordinates } = parsed.data;

  const result = await getDb().$transaction(async (tx) => {
    await lockMemory(tx, memoryId);
    const fresh = await tx.memory.findUnique({
      where: { id: memoryId },
      select: { id: true, deletedAt: true, updatedAt: true, latitude: true, longitude: true, consentVersion: true },
    });
    if (!fresh || fresh.deletedAt !== null) {
      return { code: "not_found" as const };
    }
    const current = { memoryVersion: fresh.updatedAt.toISOString(), coordinates: coordinatesOf(fresh) };
    if (current.memoryVersion !== memoryVersion) {
      return { code: "stale" as const, current };
    }
    if (samePair(current.coordinates, coordinates)) {
      return { code: "unchanged" as const };
    }
    await tx.memory.update({ where: { id: memoryId }, data: { latitude: coordinates?.latitude ?? null, longitude: coordinates?.longitude ?? null } });
    await appendRevision(tx, { memoryId, changedVia: "ADMIN", before: { coordinates: current.coordinates }, after: { coordinates }, consentVersion: fresh.consentVersion });
    return { code: "ok" as const };
  }, TX_OPTIONS);

  switch (result.code) {
    case "not_found":
      return { ok: false, code: "not_found" };
    case "stale":
      return { ok: false, code: "stale", current: result.current };
    case "unchanged":
      return { ok: true, changed: false };
    case "ok":
      log.info({ action: "admin_coordinates_set", memoryId }, "memory coordinates set");
      return { ok: true, changed: true };
  }
}
