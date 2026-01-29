-- Add google_calendar column to Chalets table to store Google Calendar IDs
-- This allows each chalet to have its own Google Calendar for managing bookings

-- Add the column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'Chalets' 
        AND column_name = 'google_calendar'
    ) THEN
        ALTER TABLE "Chalets" ADD COLUMN google_calendar TEXT;
        COMMENT ON COLUMN "Chalets".google_calendar IS 'Google Calendar ID for this chalet';
    END IF;
END $$;

-- Create an index for faster lookups by calendar ID
CREATE INDEX IF NOT EXISTS idx_chalets_google_calendar ON "Chalets"(google_calendar);
