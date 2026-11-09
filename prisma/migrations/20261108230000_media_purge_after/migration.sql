-- MCP photo tools (plan 2026-11-08-mcp-media-tools D6): a READY file removed through set_media_deleted keeps its
-- bytes until `purgeAfter` (removal + 30 days) and can be restored until cron step (f) claims it. NULL keeps today's
-- rule (purge once the upload window has closed) for claim-page removals, cancellations and replaced files.
-- Generated with `prisma migrate diff`; `IF NOT EXISTS`, the lock timeout and the CHECK constraint are added by hand.
--
-- Expand-only: one nullable column, no default, no table rewrite. The running old code never reads or writes it;
-- every existing row stays NULL, which is today's rule.
--
-- Production runs with lock_timeout = 0, so the ALTER TABLE could otherwise queue behind a long transaction on
-- "Media" and make every later statement on the table queue behind it with no bound. A short lock_timeout fails this
-- migration fast instead (as in 20261105140000_media_reserved_until). Recovery if that ever happens: the deploy fails
-- before the new code serves; run
--   npx prisma migrate resolve --rolled-back 20261108230000_media_purge_after
-- and redeploy (the script runs as one transaction, so nothing here needs undoing).
SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "purgeAfter" TIMESTAMP(3);

-- The grace describes a removal, so it exists only on a removed row.
ALTER TABLE "Media" ADD CONSTRAINT "Media_purge_after_removed" CHECK ("purgeAfter" IS NULL OR "deletedAt" IS NOT NULL);
