-- Invite links (plan docs/plans/2026-11-07-notify-correspondents.md §8.1, D9; issue #59).
-- Additive only: one new table. Running code never reads it, so a build that fails
-- after `migrate deploy` leaves the previous deployment unaffected. Generated offline
-- with `prisma migrate diff --from-schema <origin/main schema> --to-schema prisma/schema.prisma`.
-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "memorialId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_memorialId_email_key" ON "Invite"("memorialId", "email");

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_memorialId_fkey" FOREIGN KEY ("memorialId") REFERENCES "Memorial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
