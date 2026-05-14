-- =============================================================================
-- Migration: Repair guide_booking time columns + clean corrupt zero-length rows
-- =============================================================================
-- Context: Three bookings (ids 204/205/206) were observed with
-- start_time = end_time = midnight UTC, which:
--   (a) bypasses the original CHECK (end_time > start_time) constraint
--   (b) yields zero-length intervals that the availability subtraction logic
--       cannot reliably handle at the search-range boundary
--       (.gt("end_time", startISO) excludes them when end_time == startISO)
--
-- This means the live schema has drifted from the original migration. Possible
-- causes: the table was recreated from the Supabase dashboard without all
-- constraints, or the columns are no longer TIMESTAMPTZ.
--
-- This migration is idempotent and defensive — it re-asserts the intended
-- shape regardless of how the table currently looks.
-- =============================================================================

-- 1. Make sure start_time / end_time are TIMESTAMPTZ.
--    If they're already TIMESTAMPTZ this is a no-op; if they were DATE,
--    Postgres will implicitly cast (date -> timestamptz at 00:00 UTC),
--    which is acceptable for the cleanup below.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'guide_booking'
      AND column_name = 'start_time'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    EXECUTE 'ALTER TABLE guide_booking ALTER COLUMN start_time TYPE TIMESTAMPTZ USING start_time::timestamptz';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'guide_booking'
      AND column_name = 'end_time'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    EXECUTE 'ALTER TABLE guide_booking ALTER COLUMN end_time TYPE TIMESTAMPTZ USING end_time::timestamptz';
  END IF;
END $$;

-- 2. Remove corrupt rows where start_time == end_time (zero-length bookings).
--    These were inserted with date-only values that lost their time-of-day.
--    They cannot represent a real reservation, so they're deleted outright.
DELETE FROM guide_booking
WHERE start_time = end_time;

-- 3. Re-assert the CHECK constraint so future inserts cannot store
--    zero-length intervals again. Drop first in case it exists with a
--    different definition or was previously removed.
ALTER TABLE guide_booking DROP CONSTRAINT IF EXISTS check_end_after_start;
ALTER TABLE guide_booking
  ADD CONSTRAINT check_end_after_start CHECK (end_time > start_time);

-- 4. Quick sanity comment for future debugging.
COMMENT ON CONSTRAINT check_end_after_start ON guide_booking IS
  'Bookings must have positive duration (end_time strictly after start_time). '
  'Prevents zero-length intervals that break availability subtraction.';
