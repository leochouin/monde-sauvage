-- Fix google_event_id column: remove UUID default and clear bogus values
-- The column was getting auto-populated with gen_random_uuid() values,
-- which prevented the create-guide-booking-event edge function from
-- creating actual Google Calendar events (idempotency check saw non-null
-- and skipped creation).

-- 1. Remove the DEFAULT if it exists
ALTER TABLE guide_booking
  ALTER COLUMN google_event_id DROP DEFAULT;

-- 2. Clear all google_event_id values that are UUIDs (not real Google Calendar IDs)
-- Real Google Calendar event IDs are long alphanumeric strings (e.g. "abc123def456")
-- or contain characters like underscore. They are NEVER valid UUIDs.
UPDATE guide_booking
  SET google_event_id = NULL,
      calendar_sync_failed = true,
      calendar_sync_error = 'google_event_id was a bogus UUID default, needs re-sync'
  WHERE google_event_id IS NOT NULL
    AND google_event_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 3. Also fix the bookings table if it has the same problem
ALTER TABLE bookings
  ALTER COLUMN google_event_id DROP DEFAULT;

UPDATE bookings
  SET google_event_id = NULL
  WHERE google_event_id IS NOT NULL
    AND google_event_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
