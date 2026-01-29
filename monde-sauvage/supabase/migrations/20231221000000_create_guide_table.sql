-- Create the guide table to store guide information and Google Calendar tokens
CREATE TABLE IF NOT EXISTS guide (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  email TEXT UNIQUE,
  google_refresh_token TEXT,
  google_token_created_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comments to document the columns
COMMENT ON TABLE guide IS 'Stores guide information and Google Calendar OAuth tokens';
COMMENT ON COLUMN guide.id IS 'Unique identifier for the guide';
COMMENT ON COLUMN guide.name IS 'Guide display name';
COMMENT ON COLUMN guide.email IS 'Guide email address (unique)';
COMMENT ON COLUMN guide.google_refresh_token IS 'Google OAuth refresh token for Calendar API access';
COMMENT ON COLUMN guide.google_token_created_at IS 'Timestamp when the Google refresh token was created/last refreshed';

-- Create an index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_guide_email ON guide(email);

-- Optional: Add index for queries by token age
CREATE INDEX IF NOT EXISTS idx_guide_token_created ON guide(google_token_created_at) WHERE google_refresh_token IS NOT NULL;

-- Add a trigger to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_guide_updated_at
  BEFORE UPDATE ON guide
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
