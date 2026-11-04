-- AlterEnum
-- A whole send of several memories gets one receipt, logged on the anchor memory.
-- The value is only used by application code, never inside this migration.
ALTER TYPE "EmailType" ADD VALUE 'SUBMISSION_CONFIRMATION';

-- AlterTable
-- Memories sent together from /share share a submissionId and are numbered
-- 0..N-1; index 0 is the anchor that carries the upload lease
-- ("uploadLeaseUntil", added by 20261103233000_media_words_lease) and the
-- email row. Legacy rows keep NULLs. No unique constraint: the columns are
-- nullable, and one transaction assigns the indexes.
ALTER TABLE "Memory" ADD COLUMN     "submissionId" TEXT,
ADD COLUMN     "submissionIndex" INTEGER;

-- CreateIndex
CREATE INDEX "Memory_submissionId_submissionIndex_idx" ON "Memory"("submissionId", "submissionIndex");
