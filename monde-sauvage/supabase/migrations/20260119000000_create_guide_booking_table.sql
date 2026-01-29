-- Create guide_booking table to manage guide reservations
-- This table is the SOURCE OF TRUTH for all guide bookings
-- Google Calendar is synced bidirectionally with this table

CREATE TABLE IF NOT EXISTS guide_booking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_id UUID NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'system',
  google_event_id TEXT,
  customer_id UUID,
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  trip_type TEXT,
  number_of_people INTEGER,
  notes TEXT,
  is_paid BOOLEAN DEFAULT FALSE,
  payment_amount DECIMAL(10, 2),
  payment_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

-- Add comments to document the table and columns
COMMENT ON TABLE guide_booking IS 'Source of truth for all guide bookings - synced bidirectionally with Google Calendar';
COMMENT ON COLUMN guide_booking.id IS 'Unique identifier for the booking';
COMMENT ON COLUMN guide_booking.guide_id IS 'Foreign key to the guide table';
COMMENT ON COLUMN guide_booking.start_time IS 'Booking start date and time';
COMMENT ON COLUMN guide_booking.end_time IS 'Booking end date and time';
COMMENT ON COLUMN guide_booking.status IS 'Booking status: pending, confirmed, booked, cancelled, deleted';
COMMENT ON COLUMN guide_booking.source IS 'Booking source: system (created in app), google (synced from Google Calendar)';
COMMENT ON COLUMN guide_booking.google_event_id IS 'Google Calendar event ID for synced events - used to link DB and Calendar';
COMMENT ON COLUMN guide_booking.customer_id IS 'Foreign key to user/customer (optional)';
COMMENT ON COLUMN guide_booking.customer_name IS 'Customer name';
COMMENT ON COLUMN guide_booking.customer_email IS 'Customer email';
COMMENT ON COLUMN guide_booking.customer_phone IS 'Customer phone number';
COMMENT ON COLUMN guide_booking.trip_type IS 'Type of trip/activity booked';
COMMENT ON COLUMN guide_booking.number_of_people IS 'Number of people in the booking';
COMMENT ON COLUMN guide_booking.notes IS 'Additional booking notes';
COMMENT ON COLUMN guide_booking.is_paid IS 'Whether payment has been received';
COMMENT ON COLUMN guide_booking.payment_amount IS 'Payment amount in dollars';
COMMENT ON COLUMN guide_booking.payment_reference IS 'Payment reference/transaction ID';
COMMENT ON COLUMN guide_booking.synced_at IS 'Last time this booking was synced with Google Calendar';
COMMENT ON COLUMN guide_booking.deleted_at IS 'Soft delete timestamp - when booking was marked as deleted';

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_guide_booking_guide_id ON guide_booking(guide_id);
CREATE INDEX IF NOT EXISTS idx_guide_booking_times ON guide_booking(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_guide_booking_status ON guide_booking(status);
CREATE INDEX IF NOT EXISTS idx_guide_booking_google_event_id ON guide_booking(google_event_id) WHERE google_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guide_booking_customer_email ON guide_booking(customer_email);
CREATE INDEX IF NOT EXISTS idx_guide_booking_active ON guide_booking(guide_id, status) WHERE deleted_at IS NULL;

-- Add foreign key constraint to guide table
ALTER TABLE guide_booking 
ADD CONSTRAINT fk_guide_booking_guide 
FOREIGN KEY (guide_id) REFERENCES guide(id) 
ON DELETE CASCADE;

-- Add trigger to automatically update the updated_at timestamp
CREATE TRIGGER update_guide_booking_updated_at
  BEFORE UPDATE ON guide_booking
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add check constraints for data validity
ALTER TABLE guide_booking 
ADD CONSTRAINT check_end_after_start 
CHECK (end_time > start_time);

ALTER TABLE guide_booking 
ADD CONSTRAINT check_valid_status 
CHECK (status IN ('pending', 'confirmed', 'booked', 'cancelled', 'deleted'));

ALTER TABLE guide_booking 
ADD CONSTRAINT check_valid_source 
CHECK (source IN ('system', 'google'));

-- Create a view for active (non-deleted) bookings
CREATE OR REPLACE VIEW guide_booking_active AS
SELECT * FROM guide_booking
WHERE deleted_at IS NULL AND status NOT IN ('deleted', 'cancelled');

COMMENT ON VIEW guide_booking_active IS 'View showing only active (non-deleted, non-cancelled) guide bookings';

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
      AND deleted_at IS NULL
      AND status NOT IN ('cancelled', 'deleted')
      AND (id != p_exclude_booking_id OR p_exclude_booking_id IS NULL)
      AND (
        -- Check for overlap: new booking overlaps if:
        -- - it starts before existing ends AND
        -- - it ends after existing starts
        (p_start_time < end_time AND p_end_time > start_time)
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
