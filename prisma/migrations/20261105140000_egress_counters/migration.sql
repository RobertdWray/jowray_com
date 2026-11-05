-- Egress allowance counters behind /api/media and /admin/media (issue #45,
-- features/media/egress.ts): one row per scope (`global` or `media:<id>`) per
-- UTC day, bumped by a single conditional upsert. Expand-only: a new table
-- that the running old code never reads or writes, so a build that fails
-- after `migrate deploy` leaves the previous deployment unaffected.

-- CreateTable
CREATE TABLE "EgressCounter" (
    "scope" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "bytes" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EgressCounter_pkey" PRIMARY KEY ("scope","day")
);

-- CreateIndex
CREATE INDEX "EgressCounter_day_idx" ON "EgressCounter"("day");
