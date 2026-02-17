-- Fix google_event_id column type from UUID to TEXT
-- Google Calendar event IDs are arbitrary strings, not valid UUIDs
ALTER TABLE guide_booking
  ALTER COLUMN google_event_id TYPE TEXT;
