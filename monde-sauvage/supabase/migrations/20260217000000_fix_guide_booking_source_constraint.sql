-- =============================================================================
-- Fix guide_booking source constraint to allow 'website' bookings
-- =============================================================================
-- The existing constraint only allows 'system' and 'google', but the
-- stripe-create-booking edge function inserts bookings with source = 'website'.
-- =============================================================================

-- Drop the old constraint
ALTER TABLE guide_booking DROP CONSTRAINT IF EXISTS check_valid_source;

-- Re-create with 'website' included
ALTER TABLE guide_booking
ADD CONSTRAINT check_valid_source
CHECK (source IN ('system', 'google', 'website'));
