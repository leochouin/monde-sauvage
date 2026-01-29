-- Add status column to existing bookings table
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'bookings' 
        AND column_name = 'status'
    ) THEN
        ALTER TABLE bookings ADD COLUMN status TEXT NOT NULL DEFAULT 'blocked';
        COMMENT ON COLUMN bookings.status IS 'Booking status: blocked (pending), confirmed, cancelled';
    END IF;
END $$;

-- Create index on status
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
