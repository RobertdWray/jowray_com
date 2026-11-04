-- Memories drafted by the family admin on someone's behalf (docs/plans/2026-11-03-draft-memory-on-behalf.md).
-- Expand-only: the running app keeps working against this schema during the deploy.
-- The CHECK constraint that references 'DRAFT' lives in the next migration: Postgres
-- refuses to use an enum value in the transaction that added it (SQLSTATE 55P04).

-- AlterEnum
ALTER TYPE "MemorySource" ADD VALUE 'EMAIL';
ALTER TYPE "MemorySource" ADD VALUE 'OTHER';

-- AlterEnum
ALTER TYPE "MemoryStatus" ADD VALUE 'DRAFT';

-- AlterTable
-- sourceRef: opaque, unique reference to where the words came from (gmail:<message id>, sms:<hash>, other:<hash>);
-- consentedAt: null only while status = DRAFT; stamped when the person presses Share.
ALTER TABLE "Memory" ADD COLUMN     "sourceRef" TEXT,
ALTER COLUMN "consentedAt" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Memory_sourceRef_key" ON "Memory"("sourceRef");
