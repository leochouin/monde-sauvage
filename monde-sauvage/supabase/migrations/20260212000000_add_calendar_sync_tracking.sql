-- Migration: Add calendar sync failure tracking and fix conflict function
-- 
-- Changes:
-- 1. Add calendar_sync_failed flag to track failed Google Calendar syncs
-- 2. Add calendar_sync_attempts counter for retry logic
-- 3. Add calendar_sync_error to store last error message
-- 4. Fix check_guide_booking_conflict: restore UUID type and timestamp-precise overlap
-- 5. Add index on calendar_sync_failed for retry queries

-- ============================================================
-- 1. Add sync tracking columns (or fix type if already TEXT)
-- ============================================================

ALTER TABLE guide_booking 
ADD COLUMN IF NOT EXISTS calendar_sync_failed TEXT;

-- Cast TEXT → BOOLEAN if the column already existed as TEXT
ALTER TABLE guide_booking 
  ALTER COLUMN calendar_sync_failed TYPE BOOLEAN
  USING CASE 
    WHEN calendar_sync_failed IS NULL THEN FALSE
    WHEN calendar_sync_failed::text = 'true' THEN TRUE
    ELSE FALSE
  END;

ALTER TABLE guide_booking 
  ALTER COLUMN calendar_sync_failed SET DEFAULT FALSE;

ALTER TABLE guide_booking 
ADD COLUMN IF NOT EXISTS calendar_sync_attempts INTEGER DEFAULT 0;

ALTER TABLE guide_booking 
ADD COLUMN IF NOT EXISTS calendar_sync_error TEXT;

COMMENT ON COLUMN guide_booking.calendar_sync_failed IS 'True if Google Calendar sync failed for this booking. Used by retry logic.';
COMMENT ON COLUMN guide_booking.calendar_sync_attempts IS 'Number of Google Calendar sync attempts. Used for exponential backoff.';
COMMENT ON COLUMN guide_booking.calendar_sync_error IS 'Last error message from failed Google Calendar sync attempt.';

-- Index for efficiently querying failed syncs (for retry batch jobs)
CREATE INDEX IF NOT EXISTS idx_guide_booking_sync_failed 
ON guide_booking(guide_id, calendar_sync_failed) 
WHERE calendar_sync_failed = TRUE AND deleted_at IS NULL;

-- ============================================================
-- 2. Fix check_guide_booking_conflict function
--    - Restore UUID type for p_exclude_booking_id (table PK is UUID)
--    - Restore timestamp-precise overlap detection (DATE() loses hours)
-- ============================================================

-- Drop both overloaded variants to avoid ambiguity
DROP FUNCTION IF EXISTS check_guide_booking_conflict(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID);
DROP FUNCTION IF EXISTS check_guide_booking_conflict(UUID, TIMESTAMPTZ, TIMESTAMPTZ, BIGINT);

CREATE OR REPLACE FUNCTION check_guide_booking_conflict(
  p_guide_id UUID,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ,
  p_exclude_booking_id UUID DEFAULT NULL
)
RETURNS TABLE(
  has_conflict BOOLEAN,
  conflicting_bookings JSON
) AS $$
BEGIN
  RETURN QUERY
  WITH conflicts AS (
    SELECT 
      gb.id,
      gb.start_time,
      gb.end_time,
      gb.status,
      gb.customer_name,
      gb.google_event_id
    FROM guide_booking gb
    WHERE gb.guide_id = p_guide_id
      AND gb.deleted_at IS NULL
      AND gb.status NOT IN ('cancelled', 'deleted')
      AND (gb.id != p_exclude_booking_id OR p_exclude_booking_id IS NULL)
      AND (
        -- Precise timestamp-based overlap:
        -- Two intervals [A_start, A_end) and [B_start, B_end) overlap iff
        -- A_start < B_end AND A_end > B_start
        p_start_time < gb.end_time AND p_end_time > gb.start_time
      )
  )
  SELECT 
    EXISTS(SELECT 1 FROM conflicts) AS has_conflict,
    COALESCE(
      (SELECT json_agg(row_to_json(conflicts.*)) FROM conflicts),
      '[]'::json
    ) AS conflicting_bookings;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_guide_booking_conflict(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) 
IS 'Checks if a proposed booking time conflicts with existing bookings for a guide. Uses precise timestamp overlap, not date-only comparison.';
