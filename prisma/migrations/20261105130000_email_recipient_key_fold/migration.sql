-- Issue #46, review finding #10: the first backfill (20261105120000) only
-- lower-cased existing rows, so a recent "First.Last+tag@gmail.com" delivery
-- would not be counted against "firstlast@gmail.com" for the first day.
-- Fold single-address rows the way services/email/recipient-key.ts does:
-- lower-case, drop the +tag, treat googlemail.com as gmail.com and drop the
-- dots there. Admin rows are comma-joined lists and are never counted by key,
-- so they keep the lower-cased form. Idempotent and expand-only.
UPDATE "EmailLog"
SET "recipientKey" = (
  CASE
    WHEN split_part(lower("recipientEmail"), '@', 2) IN ('gmail.com', 'googlemail.com')
      THEN replace(regexp_replace(split_part(lower("recipientEmail"), '@', 1), '\+.*$', ''), '.', '') || '@gmail.com'
    ELSE regexp_replace(split_part(lower("recipientEmail"), '@', 1), '\+.*$', '') || '@' || split_part(lower("recipientEmail"), '@', 2)
  END
)
WHERE position(',' in "recipientEmail") = 0
  AND position('@' in "recipientEmail") > 0;
