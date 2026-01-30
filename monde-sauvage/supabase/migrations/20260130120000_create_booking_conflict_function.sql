-- Create a function to check for booking conflicts
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
      id,
      start_time,
      end_time,
      status,
      customer_name,
      google_event_id
    FROM guide_booking
    WHERE guide_id = p_guide_id
      AND status NOT IN ('cancelled', 'deleted')
      AND (id != p_exclude_booking_id OR p_exclude_booking_id IS NULL)
      AND (
        -- Check for overlap using date comparison
        -- Convert timestamps to dates for day-based overlap check
        (DATE(p_start_time) <= DATE(end_time) AND DATE(p_end_time) >= DATE(start_time))
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

COMMENT ON FUNCTION check_guide_booking_conflict IS 'Checks if a proposed booking time conflicts with existing bookings for a guide';
