-- AlterTable
ALTER TABLE "Contributor" ADD COLUMN     "mailingListOptIn" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
-- Existing memories were shared before the "let me know when my story is posted"
-- checkbox existed, so they are backfilled as false; new rows default to true.
ALTER TABLE "Memory" ADD COLUMN     "notifyWhenPosted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Memory" ALTER COLUMN "notifyWhenPosted" SET DEFAULT true;
