-- AlterTable
ALTER TABLE "Contributor" ADD COLUMN     "mailingListOptIn" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Memory" ADD COLUMN     "notifyWhenPosted" BOOLEAN NOT NULL DEFAULT true;

