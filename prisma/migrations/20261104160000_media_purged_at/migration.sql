-- Durable purge intent (docs/plans/2026-11-04-admin-page.md §3.6): cron step (f)
-- sets purgedAt under the memory lock before deleting the first byte, so a
-- crash, a timeout or a Restore can never leave a READY row pointing at
-- missing bytes. Expand-only: the running old code ignores the column.
ALTER TABLE "Media" ADD COLUMN "purgedAt" TIMESTAMP(3);
