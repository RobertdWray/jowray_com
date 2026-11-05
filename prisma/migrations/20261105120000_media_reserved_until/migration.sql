-- Upload budgets and retention (issue #44, item B of the 2026-11-05 public-repo review).
-- `reservedUntil` is the moment a PENDING row stops holding the daily byte budget and
-- can no longer receive bytes: set when the row is created and pushed out by every
-- ticket mint to now + UPLOAD_WINDOW_MS (ticket TTL 15 min + Blob client token 60 min).
-- Cron steps (a) and (f2) and the budget check read it instead of guessing from createdAt.
-- Expand-only: the running old code ignores the column and the new code treats NULL as
-- "unknown, fall back to createdAt". The backfill gives every live reservation a full
-- window from now, because the old code never recorded when its tokens were minted and
-- a token minted just before this deploy can still land bytes for up to 75 minutes.
ALTER TABLE "Media" ADD COLUMN "reservedUntil" TIMESTAMP(3);
CREATE INDEX "Media_status_reservedUntil_idx" ON "Media"("status", "reservedUntil");
UPDATE "Media" SET "reservedUntil" = NOW() + INTERVAL '75 minutes' WHERE "status" = 'PENDING' AND "reservedUntil" IS NULL;
