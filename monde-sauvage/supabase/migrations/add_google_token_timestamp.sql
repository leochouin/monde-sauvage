-- Add google_token_created_at column to track when refresh tokens were issued
-- This helps identify old tokens that may need refresh

ALTER TABLE guide 
ADD COLUMN IF NOT EXISTS google_token_created_at TIMESTAMPTZ;

-- Add a comment to document the column
COMMENT ON COLUMN guide.google_token_created_at IS 'Timestamp when the Google refresh token was created/last refreshed';

-- Optional: Add index if you plan to query by token age
-- CREATE INDEX IF NOT EXISTS idx_guide_token_created ON guide(google_token_created_at) WHERE google_refresh_token IS NOT NULL;
