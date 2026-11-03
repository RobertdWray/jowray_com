import "server-only";

import { z } from "zod";

import { hashClaimToken } from "@/lib/claim-token";
import { createLogger } from "@/lib/logger";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";

const log = createLogger({ category: "api" });

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

export const claimChangesSchema = z.object({
  name: optional(120),
  relationship: optional(120),
  approxDateText: optional(120),
  place: optional(200),
  note: z.string().max(10_000).nullable().optional(),
  visibility: z.enum(["PUBLIC", "FAMILY", "PRIVATE"]).optional(),
});
export type ClaimChanges = z.infer<typeof claimChangesSchema>;

export interface ClaimView {
  id: string;
  type: "VOICE" | "VIDEO" | "PHOTO" | "TEXT";
  approxDateText: string | null;
  place: string | null;
  contributorNote: string | null;
  visibility: "PUBLIC" | "FAMILY" | "PRIVATE";
  contributor: { name: string | null; relationship: string | null; email: string | null } | null;
  media: Array<{ id: string; mimeType: string; originalFilename: string | null }>;
}

/** The memory behind a claim token, with its READY media, or null. */
export async function getMemoryForClaim(claimToken: string): Promise<ClaimView | null> {
  const memory = await getDb().memory.findUnique({
    where: { claimTokenHash: hashClaimToken(claimToken) },
    include: {
      contributor: { select: { name: true, relationship: true, email: true } },
      media: { select: { id: true, status: true, mimeType: true, originalFilename: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!memory || memory.deletedAt !== null) {
    return null;
  }
  return {
    id: memory.id,
    type: memory.type,
    approxDateText: memory.approxDateText,
    place: memory.place,
    contributorNote: memory.contributorNote,
    visibility: memory.visibility,
    contributor: memory.contributor,
    media: memory.media.filter((m) => m.status === "READY").map(({ id, mimeType, originalFilename }) => ({ id, mimeType, originalFilename })),
  };
}

export type ClaimUpdateResult = { ok: true } | { ok: false; code: "invalid" | "not_found" };

/**
 * Apply an edit from the claim page and append a MemoryRevision with the
 * before/after snapshot (changedVia CLAIM_LINK). The first revision also
 * records the consent version in force. Soft-deleted memories are ignored.
 */
export async function updateMemoryFromClaim({ claimToken, changes }: { claimToken: string; changes: unknown }): Promise<ClaimUpdateResult> {
  const parsed = claimChangesSchema.safeParse(changes);
  if (!parsed.success) {
    return { ok: false, code: "invalid" };
  }
  const input = parsed.data;
  const claimTokenHash = hashClaimToken(claimToken);

  const result = await getDb().$transaction(async (tx) => {
    const memory = await tx.memory.findUnique({
      where: { claimTokenHash },
      include: { contributor: { select: { id: true, name: true, relationship: true } } },
    });
    if (!memory || memory.deletedAt !== null) {
      return "not_found" as const;
    }
    const before = {
      name: memory.contributor?.name ?? null,
      relationship: memory.contributor?.relationship ?? null,
      approxDateText: memory.approxDateText,
      place: memory.place,
      contributorNote: memory.contributorNote,
      visibility: memory.visibility,
    };
    const after = {
      name: input.name === undefined ? before.name : input.name,
      relationship: input.relationship === undefined ? before.relationship : input.relationship,
      approxDateText: input.approxDateText === undefined ? before.approxDateText : input.approxDateText,
      place: input.place === undefined ? before.place : input.place,
      contributorNote: input.note === undefined ? before.contributorNote : input.note,
      visibility: input.visibility ?? before.visibility,
    };
    await tx.memory.update({
      where: { id: memory.id },
      data: { approxDateText: after.approxDateText, place: after.place, contributorNote: after.contributorNote, visibility: after.visibility },
    });
    if (memory.contributor && (after.name !== before.name || after.relationship !== before.relationship)) {
      await tx.contributor.update({ where: { id: memory.contributor.id }, data: { name: after.name, relationship: after.relationship } });
    }
    const isFirst = (await tx.memoryRevision.count({ where: { memoryId: memory.id } })) === 0;
    await tx.memoryRevision.create({
      data: {
        memoryId: memory.id,
        changedVia: "CLAIM_LINK",
        before: before as Prisma.InputJsonValue,
        after: (isFirst ? { ...after, consentVersion: memory.consentVersion } : after) as Prisma.InputJsonValue,
      },
    });
    return "ok" as const;
  });

  if (result === "not_found") {
    return { ok: false, code: "not_found" };
  }
  log.info({ action: "claim_edit" }, "memory edited through its claim link");
  return { ok: true };
}
