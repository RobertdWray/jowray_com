-- Coordinates for a future map (WGS 84 decimal degrees). Set and read only through /api/mcp.
-- Expand-only: nullable columns, no backfill; the running app ignores them.
ALTER TABLE "Memory" ADD COLUMN "latitude" DOUBLE PRECISION, ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_coordinates_pair" CHECK (("latitude" IS NULL) = ("longitude" IS NULL));
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_latitude_range" CHECK ("latitude" BETWEEN -90 AND 90);
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_longitude_range" CHECK ("longitude" BETWEEN -180 AND 180);
