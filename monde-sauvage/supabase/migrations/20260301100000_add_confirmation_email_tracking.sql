-- Add confirmation_email_sent_at column to both booking tables
-- Used to prevent duplicate confirmation emails on retries / webhook replays.

-- Guide bookings
ALTER TABLE guide_booking
  ADD COLUMN IF NOT EXISTS confirmation_email_sent_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN guide_booking.confirmation_email_sent_at
  IS 'Timestamp when the confirmation email was sent. NULL = not yet sent. Used for deduplication.';

-- Chalet bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS confirmation_email_sent_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN bookings.confirmation_email_sent_at
  IS 'Timestamp when the confirmation email was sent. NULL = not yet sent. Used for deduplication.';
