/**
 * What "public" means on See memories (plan docs/plans/2026-11-08-see-memories.md, D1), written once (debt rule
 * M-E-14, TCR round 1 B2-2): the family approved it, the contributor chose "Everyone", and it is not deleted.
 *
 * `PUBLIC_MEMORY_RULE` is the shape `features/memories/public.ts` turns into its Prisma `where`
 * (`PUBLIC_MEMORY_WHERE`); `isPublicMemory` is the same rule for a row already loaded, used by the media route's
 * `authorize` and by `serveMedia`'s own public gate. `__tests__/lib/memories-public-rule.test.ts` and the
 * public-memories integration suite pin that the two agree for every status × visibility × deleted combination.
 */
export const PUBLIC_MEMORY_RULE = { status: "APPROVED", visibility: "PUBLIC", deletedAt: null } as const;

/** The memory fields the rule reads. */
export interface PublicRuleFacts {
  status: string;
  visibility: string;
  deletedAt: Date | null;
}

/** Whether a loaded memory is on See memories (D1). */
export function isPublicMemory(memory: PublicRuleFacts): boolean {
  return memory.status === PUBLIC_MEMORY_RULE.status && memory.visibility === PUBLIC_MEMORY_RULE.visibility && memory.deletedAt === PUBLIC_MEMORY_RULE.deletedAt;
}
