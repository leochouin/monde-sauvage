-- Create bookings table to manage chalet reservations
-- This table stores both manual bookings and synced Google Calendar events

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chalet_id UUID NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'blocked',
  source TEXT NOT NULL DEFAULT 'manual',
  google_event_id TEXT,
  customer_name TEXT,
  customer_email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comments to document the table and columns
COMMENT ON TABLE bookings IS 'Stores chalet booking reservations from multiple sources';
COMMENT ON COLUMN bookings.id IS 'Unique identifier for the booking';
COMMENT ON COLUMN bookings.chalet_id IS 'Foreign key to the chalet';
COMMENT ON COLUMN bookings.start_date IS 'Booking start date and time';
COMMENT ON COLUMN bookings.end_date IS 'Booking end date and time';
COMMENT ON COLUMN bookings.status IS 'Booking status: blocked (pending), confirmed, cancelled';
COMMENT ON COLUMN bookings.source IS 'Booking source: google, manual, airbnb, etc.';
COMMENT ON COLUMN bookings.google_event_id IS 'Google Calendar event ID for synced events';
COMMENT ON COLUMN bookings.customer_name IS 'Customer name (optional)';
COMMENT ON COLUMN bookings.customer_email IS 'Customer email (optional)';
COMMENT ON COLUMN bookings.notes IS 'Additional booking notes';

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_bookings_chalet_id ON bookings(chalet_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_google_event_id ON bookings(google_event_id);

-- Add foreign key constraint to Chalets table (try both table name variants)
DO $$ 
BEGIN
    -- Try with capital C first
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Chalets') THEN
        ALTER TABLE bookings 
        ADD CONSTRAINT fk_bookings_chalet 
        FOREIGN KEY (chalet_id) REFERENCES "Chalets"(key) 
        ON DELETE CASCADE;
    ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chalets') THEN
        ALTER TABLE bookings 
        ADD CONSTRAINT fk_bookings_chalet 
        FOREIGN KEY (chalet_id) REFERENCES chalets(key) 
        ON DELETE CASCADE;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN
        -- Constraint already exists, do nothing
        NULL;
END $$;

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_bookings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_bookings_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION update_bookings_updated_at();
