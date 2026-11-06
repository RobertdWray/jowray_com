-- Photo GPS: a real lease on the GPS read, and time-zone-aware throttle times
-- (plan 2026-11-06-photo-gps-places, final review fix wave, items 2 and 8).
-- Generated with `prisma migrate dev --create-only`; the USING clauses and the
-- comments are added by hand. 20261106200000_photo_gps_places is already
-- applied on the PR's Preview database, so this is a new, append-only step.
-- Safe for the running code: a new nullable column it never reads, and a type
-- change on two columns that code only touches through SQL that compares them
-- with now(), which works the same on either type.

-- AlterTable
-- gpsClaimedAt is the GPS read's lease, following deriveMedia's claimedAt: set
-- together with each claimed attempt, cleared by the decision write (and by the
-- purge), left on a failure so it expires; a claim older than the stale window
-- (GPS_STALE_CLAIM_MS in features/media/extract-photo-gps.ts) may be taken over.
ALTER TABLE "Media" ADD COLUMN     "gpsClaimedAt" TIMESTAMP(3);

-- AlterTable
-- The claim, fence and wait SQL in features/places/lookup-place.ts compare these
-- with the database's now(), a timestamptz. As TIMESTAMP(3) the comparison went
-- through the session's TimeZone setting; as TIMESTAMPTZ(3) it does not. The
-- existing values were written by now() in UTC sessions (Neon's default), so
-- they are read as UTC.
ALTER TABLE "PlaceLookupThrottle" ALTER COLUMN "nextAllowedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "nextAllowedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "leaseUntil" SET DATA TYPE TIMESTAMPTZ(3) USING "leaseUntil" AT TIME ZONE 'UTC';
