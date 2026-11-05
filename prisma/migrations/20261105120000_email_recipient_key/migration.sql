-- Issue #46 (public-repo audit A): the per-recipient email cap counts one
-- inbox once, by a canonical key (+tag and Gmail dots folded), and the new
-- global ceilings count by type, status and last state change.
-- Expand-only: nullable column, backfilled for the rows that exist, two
-- indexes. The running old code never reads or writes the column.
ALTER TABLE "EmailLog" ADD COLUMN "recipientKey" TEXT;
UPDATE "EmailLog" SET "recipientKey" = lower("recipientEmail") WHERE "recipientKey" IS NULL;
CREATE INDEX "EmailLog_recipientKey_updatedAt_idx" ON "EmailLog"("recipientKey", "updatedAt");
CREATE INDEX "EmailLog_emailType_status_updatedAt_idx" ON "EmailLog"("emailType", "status", "updatedAt");
