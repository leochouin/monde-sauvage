-- Add profile fields to guide table that are used in guideModal.jsx
-- These fields were expected by the UI but missing from the database schema

-- Add experience field for guide's experience description
ALTER TABLE guide 
ADD COLUMN IF NOT EXISTS experience TEXT;

-- Add bio field for guide's biography
ALTER TABLE guide 
ADD COLUMN IF NOT EXISTS bio TEXT;

-- Add hourlyRate field (as hourly_rate for DB naming convention)
ALTER TABLE guide 
ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC;

-- Add phone field
ALTER TABLE guide 
ADD COLUMN IF NOT EXISTS phone TEXT;

-- Add user_id to link guide to auth user
ALTER TABLE guide 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- Add google_calendar_id for storing the guide's calendar ID
ALTER TABLE guide 
ADD COLUMN IF NOT EXISTS google_calendar_id TEXT;

-- Add comments
COMMENT ON COLUMN guide.experience IS 'Guide experience description';
COMMENT ON COLUMN guide.bio IS 'Guide biography';
COMMENT ON COLUMN guide.hourly_rate IS 'Hourly rate in dollars';
COMMENT ON COLUMN guide.phone IS 'Contact phone number';
COMMENT ON COLUMN guide.user_id IS 'Reference to auth.users table';
COMMENT ON COLUMN guide.google_calendar_id IS 'Google Calendar ID for this guide';

-- Create index for user_id lookups
CREATE INDEX IF NOT EXISTS idx_guide_user_id ON guide(user_id);
