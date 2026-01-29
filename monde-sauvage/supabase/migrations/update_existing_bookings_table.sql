-- Update existing bookings table to support Google Calendar sync
-- This adds missing columns if they don't exist

-- Add google_event_id column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'bookings' 
        AND column_name = 'google_event_id'
    ) THEN
        ALTER TABLE bookings ADD COLUMN google_event_id TEXT;
        COMMENT ON COLUMN bookings.google_event_id IS 'Google Calendar event ID for synced events';
    END IF;
END $$;

-- Add source column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'bookings' 
        AND column_name = 'source'
    ) THEN
        ALTER TABLE bookings ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
        COMMENT ON COLUMN bookings.source IS 'Booking source: google, manual, airbnb, etc.';
    END IF;
END $$;

-- Add customer_name column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'bookings' 
        AND column_name = 'customer_name'
    ) THEN
        ALTER TABLE bookings ADD COLUMN customer_name TEXT;
        COMMENT ON COLUMN bookings.customer_name IS 'Customer name (optional)';
    END IF;
END $$;

-- Add customer_email column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'bookings' 
        AND column_name = 'customer_email'
    ) THEN
        ALTER TABLE bookings ADD COLUMN customer_email TEXT;
        COMMENT ON COLUMN bookings.customer_email IS 'Customer email (optional)';
    END IF;
END $$;

-- Add notes column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'bookings' 
        AND column_name = 'notes'
    ) THEN
        ALTER TABLE bookings ADD COLUMN notes TEXT;
        COMMENT ON COLUMN bookings.notes IS 'Additional booking notes';
    END IF;
END $$;

-- Create index on google_event_id if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_bookings_google_event_id ON bookings(google_event_id);

-- Create index on source if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_bookings_source ON bookings(source);

-- Show the final structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'bookings'
ORDER BY ordinal_position;
