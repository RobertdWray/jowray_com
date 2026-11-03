-- Server-made copies of originals (web image, email thumbnail; POSTER reserved).
-- A row is created when a worker claims the work, with its blob pathname, so a
-- crash or a lost race never leaves an untracked blob. Rows are caches: the
-- reconcile purge deletes them with the blob.


-- CreateEnum
CREATE TYPE "DerivedKind" AS ENUM ('WEB_IMAGE', 'THUMBNAIL', 'POSTER');

-- CreateEnum
CREATE TYPE "DerivedStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "DerivedMedia" (
    "id" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "kind" "DerivedKind" NOT NULL,
    "status" "DerivedStatus" NOT NULL DEFAULT 'PENDING',
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DerivedMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DerivedMedia_storageKey_key" ON "DerivedMedia"("storageKey");

-- CreateIndex
CREATE INDEX "DerivedMedia_status_updatedAt_idx" ON "DerivedMedia"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DerivedMedia_mediaId_kind_key" ON "DerivedMedia"("mediaId", "kind");

-- AddForeignKey
ALTER TABLE "DerivedMedia" ADD CONSTRAINT "DerivedMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

