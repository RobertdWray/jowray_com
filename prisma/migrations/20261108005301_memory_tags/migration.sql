-- See memories (plan 2026-11-08 D3): the "patches" a memory carries, normalised by lib/memories/tags.ts.
-- NOT NULL with an empty-array default: existing rows get '{}' and Prisma's String[] never reads null.
-- AlterTable
ALTER TABLE "Memory" ADD COLUMN     "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
