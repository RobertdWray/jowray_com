-- Upload budgets and retention (issue #44, item B of the 2026-11-05 public-repo review).
-- `reservedUntil` is the moment a PENDING row stops holding the daily byte budget and
-- can no longer receive bytes: set when the row is created and pushed out by every
-- ticket mint to now + UPLOAD_WINDOW_MS (ticket TTL 15 min + Blob client token 60 min).
-- Cron steps (a) and (f2) and the budget check read it instead of guessing from createdAt.
--
-- Expand-only and idempotent: the running old code ignores the column, the new code
-- treats NULL as "unknown, fall back to createdAt", and every statement can be re-run.
--
-- Production runs with lock_timeout = 0, so the ALTER TABLE could otherwise queue behind
-- a long transaction on "Media" and make every later statement on the table queue behind
-- it with no bound. A short lock_timeout fails this migration fast instead (TCR #7/#16).
-- Recovery if that ever happens: the deploy fails before the new code serves; run
--   npx prisma migrate resolve --rolled-back 20261105140000_media_reserved_until
-- and redeploy (nothing here needs undoing: the statements are idempotent).
SET lock_timeout = '5s';

ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "reservedUntil" TIMESTAMP(3);

-- Backfill before the index so the index is built once, over the final values. The old
-- deployment keeps minting tickets for these rows until it is replaced (the build runs
-- this migration minutes before promotion; a rollback could keep it serving for longer),
-- and it never writes this column. A reservation may be re-ticketed until it is 24 h old
-- and that ticket's bytes may land 75 min later, so 25 h from now is the longest any
-- pre-existing reservation can legitimately stay open; until then it counts as it always
-- did and the cron leaves it alone (TCR #13).
UPDATE "Media" SET "reservedUntil" = NOW() + INTERVAL '25 hours' WHERE "status" = 'PENDING' AND "reservedUntil" IS NULL;

CREATE INDEX IF NOT EXISTS "Media_status_reservedUntil_idx" ON "Media"("status", "reservedUntil");
