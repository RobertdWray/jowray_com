-- Connector uploads (plan docs/plans/2026-11-06-mcp-attach-media.md §8.1, D4, D10).
-- Expand-only: two nullable columns and two CHECK constraints; the running old
-- code never reads or writes either column, so a build that fails after
-- `migrate deploy` leaves the previous deployment unaffected.

-- AlterTable
-- addedVia: null for site uploads (claim page, /share); ADMIN for a file the
-- family admin attached through the MCP connector (request_upload). recordMedia
-- runs the admin completion path (exact size, hash before READY, ADMIN revision)
-- for these rows, whoever completes them (finalize_upload or cron step (a)).
-- declaredSha256: the SHA-256 the session claimed for the file. checksumSha256
-- stays the verified hash; a verified checksum always wins in dedupe.
ALTER TABLE "Media" ADD COLUMN     "addedVia" "ChangedVia",
ADD COLUMN     "declaredSha256" TEXT;

-- A declared hash is 64 lowercase hex characters.
ALTER TABLE "Media" ADD CONSTRAINT "Media_declared_sha256_hex" CHECK ("declaredSha256" ~ '^[0-9a-f]{64}$');
-- Exactly the admin rows carry a declared hash. IS NOT DISTINCT FROM keeps the
-- check meaningful when addedVia is NULL (a plain = would yield NULL, and a
-- NULL CHECK passes).
ALTER TABLE "Media" ADD CONSTRAINT "Media_admin_declared_sha256" CHECK (("addedVia" IS NOT DISTINCT FROM 'ADMIN') = ("declaredSha256" IS NOT NULL));
