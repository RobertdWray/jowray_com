-- See memories, TCR round 1 B1-1 (plan 2026-11-08 D16): whether an MP4-family file's location scan parsed the whole
-- movie box. Generated with `prisma migrate diff`; the CHECK constraint is added by hand.
-- Expand-only: one nullable column, no default, no table rewrite. Rows decided before it stay null and so do not play
-- on See memories until a later rescan sets it (TCR round 1 bucket 4); the running old code never reads or writes it.

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "gpsScanComplete" BOOLEAN;

-- The flag describes a decision, so it exists only on a row whose GPS outcome is decided.
ALTER TABLE "Media" ADD CONSTRAINT "Media_gps_scan_decided" CHECK ("gpsScanComplete" IS NULL OR "gpsCheckedAt" IS NOT NULL);
