import "server-only";

import { draftMemory, type MemoryStatus } from "@/features/memories/draft-memory";
import { otherSourceRef } from "@/lib/source-ref";
import { adminDraftFormSchema } from "@/lib/validations/admin";
import { getDb } from "@/server/db/client";

export type AdminDraftResult =
  | { ok: true; memoryId: string; claimLink: string }
  | { ok: false; code: "invalid" | "budget_exceeded" }
  | { ok: false; code: "duplicate"; memoryId: string; status: MemoryStatus; deletedAt: Date | null };

/**
 * Draft a memory from the admin page (plan §3.5). A browser form has no Gmail
 * message id or E.164 number, so every browser draft is `source: OTHER` with
 * `otherSourceRef(email, note)`: keyed on the sender's email and the full
 * text, so a re-paste answers `duplicate` rather than making a second draft.
 * Everything else is `draftMemory` unchanged (one Contributor, a DRAFT TEXT
 * memory with no consent stamp, a claim link the family sends by hand).
 */
export async function createDraftAsAdmin(raw: unknown): Promise<AdminDraftResult> {
  const parsed = adminDraftFormSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const form = parsed.data;
  // The schema already refused an empty email or note, the only inputs otherSourceRef throws on.
  const sourceRef = otherSourceRef(form.email, form.note);
  const result = await draftMemory({
    contributor: { name: form.name ?? null, email: form.email, relationship: form.relationship ?? null },
    note: form.note,
    approxDateText: form.approxDateText ?? null,
    place: form.place ?? null,
    source: "OTHER",
    sourceRef,
    visibility: form.visibility,
  });
  if (result.ok) {
    return { ok: true, memoryId: result.memoryId, claimLink: result.claimLink };
  }
  if (result.code === "duplicate") {
    const existing = await getDb().memory.findUnique({ where: { id: result.memoryId }, select: { deletedAt: true } });
    return { ok: false, code: "duplicate", memoryId: result.memoryId, status: result.status, deletedAt: existing?.deletedAt ?? null };
  }
  return { ok: false, code: result.code };
}
