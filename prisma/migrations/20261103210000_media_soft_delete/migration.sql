-- AlterTable
-- Soft delete for removed files, cancelled reservations and cancelled replacements
-- (blobs are purged by the reconcile cron); a PENDING replacement points at the
-- row it retires when READY (one-to-many so a FAILED attempt can be retried);
-- display order chosen by the contributor.
ALTER TABLE "Media" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "replacesMediaId" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill: existing files keep their upload order as distinct sort slots, so a
-- replacement (which copies its target's slot) stays where the original was.
UPDATE "Media" AS m
SET "sortOrder" = ranked.rn - 1
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "memoryId" ORDER BY "createdAt", "id") AS rn
  FROM "Media"
) AS ranked
WHERE m."id" = ranked."id";

-- CreateIndex
CREATE INDEX "Media_memoryId_deletedAt_idx" ON "Media"("memoryId", "deletedAt");

-- CreateIndex
CREATE INDEX "Media_replacesMediaId_idx" ON "Media"("replacesMediaId");

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_replacesMediaId_fkey" FOREIGN KEY ("replacesMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
