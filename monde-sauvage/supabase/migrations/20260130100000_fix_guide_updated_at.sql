-- Fix: Add missing updated_at and created_at columns to guide table
-- The trigger update_guide_updated_at references these columns but they were missing

-- Add created_at column if not exists
ALTER TABLE guide 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Add updated_at column if not exists
ALTER TABLE guide 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add comments
COMMENT ON COLUMN guide.created_at IS 'Timestamp when the guide record was created';
COMMENT ON COLUMN guide.updated_at IS 'Timestamp when the guide record was last updated';
