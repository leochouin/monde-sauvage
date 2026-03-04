-- Migration: Add booking_calendar_id column to guide table
-- Separates the availability calendar from the reservations calendar.
--
-- availability_calendar_id → "Monde Sauvage | Disponibilités" (guide availability input)
-- booking_calendar_id     → "Monde Sauvage | Réservations"   (confirmed customer bookings)

ALTER TABLE guide
ADD COLUMN IF NOT EXISTS booking_calendar_id TEXT;

COMMENT ON COLUMN guide.booking_calendar_id IS 'Google Calendar ID for the "Monde Sauvage | Réservations" calendar (confirmed bookings only)';
