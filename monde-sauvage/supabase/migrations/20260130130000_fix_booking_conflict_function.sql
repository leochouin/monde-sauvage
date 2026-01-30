-- First drop the old function with UUID parameter
DROP FUNCTION IF EXISTS check_guide_booking_conflict(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID);

-- Fix the booking conflict function - id is BIGINT not UUID
CREATE OR REPLACE FUNCTION check_guide_booking_conflict(
  p_guide_id UUID,
  p_start_time TIMESTAMPTZ,
  p_end_time TIMESTAMPTZ,
  p_exclude_booking_id BIGINT DEFAULT NULL
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
      AND gb.status NOT IN ('cancelled', 'deleted')
      AND (gb.id != p_exclude_booking_id OR p_exclude_booking_id IS NULL)
      AND (
        -- Check for overlap using date comparison
        -- Convert timestamps to dates for day-based overlap check
        (DATE(p_start_time) <= DATE(gb.end_time) AND DATE(p_end_time) >= DATE(gb.start_time))
      )
  )
  SELECT 
    EXISTS(SELECT 1 FROM conflicts) as has_conflict,
    COALESCE(
      (SELECT json_agg(row_to_json(conflicts.*)) FROM conflicts),
      '[]'::json
    ) as conflicting_bookings;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_guide_booking_conflict(UUID, TIMESTAMPTZ, TIMESTAMPTZ, BIGINT) IS 'Checks if a proposed booking time conflicts with existing bookings for a guide';
