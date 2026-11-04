-- Per-file words (caption, rough date, place) and the submission lease that keeps the
-- reconcile cron from confirming (and rotating the link of) a memory still receiving files.


-- AlterTable
ALTER TABLE "Memory" ADD COLUMN     "uploadLeaseUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "approxDateText" TEXT,
ADD COLUMN     "caption" TEXT,
ADD COLUMN     "place" TEXT;

