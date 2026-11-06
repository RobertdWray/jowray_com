-- Photo GPS saved per photo, and the reverse-geocode cache and throttle behind
-- place suggestions (plan 2026-11-06-photo-gps-places, step B1). Generated with
-- `prisma migrate dev --create-only`; the CHECK constraints are added by hand.
-- Expand-only: nullable columns, a constant default (no table rewrite on
-- Postgres 11+) and two new tables; the running old code never reads or writes
-- any of them, so a build that fails after `migrate deploy` leaves the previous
-- deployment unaffected.

-- AlterTable
-- Coordinates are WGS 84 decimal degrees read from the stored original's EXIF;
-- never shown on the site, read only through /api/mcp. gpsCheckedAt null means
-- "not yet decided"; gpsAttempts counts claimed reads.
ALTER TABLE "Media" ADD COLUMN     "gpsAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gpsCheckedAt" TIMESTAMP(3),
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- Same pair and range checks as Memory (20261106120000_memory_coordinates),
-- plus: coordinates exist only on a row whose GPS outcome is decided.
ALTER TABLE "Media" ADD CONSTRAINT "Media_coordinates_pair" CHECK (("latitude" IS NULL) = ("longitude" IS NULL));
ALTER TABLE "Media" ADD CONSTRAINT "Media_latitude_range" CHECK ("latitude" BETWEEN -90 AND 90);
ALTER TABLE "Media" ADD CONSTRAINT "Media_longitude_range" CHECK ("longitude" BETWEEN -180 AND 180);
ALTER TABLE "Media" ADD CONSTRAINT "Media_coordinates_checked" CHECK ("latitude" IS NULL OR "gpsCheckedAt" IS NOT NULL);

-- CreateTable
-- One row per provider and point (degrees x 1e6, rounded). "result" is the
-- trimmed response; SQL NULL means the provider had no result.
CREATE TABLE "PlaceLookup" (
    "provider" TEXT NOT NULL,
    "latE6" INTEGER NOT NULL,
    "lonE6" INTEGER NOT NULL,
    "result" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaceLookup_pkey" PRIMARY KEY ("provider","latE6","lonE6")
);

-- CreateTable
-- Site-wide lease and fence per provider: real sends are at least 1.1 s apart.
CREATE TABLE "PlaceLookupThrottle" (
    "provider" TEXT NOT NULL,
    "nextAllowedAt" TIMESTAMP(3) NOT NULL,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),

    CONSTRAINT "PlaceLookupThrottle_pkey" PRIMARY KEY ("provider")
);
