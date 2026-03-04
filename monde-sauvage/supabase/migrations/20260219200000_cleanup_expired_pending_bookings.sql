-- =============================================================================
-- Migration: Auto-cleanup expired pending guide bookings
-- =============================================================================
-- 1. Create function to cancel expired pending bookings
-- 2. Schedule pg_cron job to run every 5 minutes
-- =============================================================================

-- 1. Function: cancel_expired_pending_bookings
--    Cancels (soft-deletes) pending/pending_payment bookings whose
--    payment_link_expires_at has passed without payment.
CREATE OR REPLACE FUNCTION cancel_expired_pending_bookings()
RETURNS INTEGER AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE guide_booking
  SET
    status = 'cancelled',
    notes = COALESCE(notes, '') || E'\n\n[Auto-cancelled: payment expired]',
    updated_at = NOW()
  WHERE
    status IN ('pending', 'pending_payment')
    AND is_paid = false
    AND payment_link_expires_at IS NOT NULL
    AND payment_link_expires_at < NOW()
    AND deleted_at IS NULL;

  GET DIAGNOSTICS affected = ROW_COUNT;

  IF affected > 0 THEN
    RAISE NOTICE 'Cancelled % expired pending booking(s)', affected;
  END IF;

  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Also add an index for faster lookups of user's pending bookings (cart)
CREATE INDEX IF NOT EXISTS idx_guide_booking_pending_by_email
  ON guide_booking (customer_email, status)
  WHERE status IN ('pending', 'pending_payment') AND is_paid = false AND deleted_at IS NULL;

-- 3. Schedule cron job (every 5 minutes) — requires pg_cron extension
--    If pg_cron is not available, the function can be called by an edge function
--    or external scheduler. The getUserPendingBookings query also filters by
--    expires_at > now(), so expired rows are hidden from users immediately.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.unschedule('cleanup-expired-pending-bookings');
  PERFORM cron.schedule(
    'cleanup-expired-pending-bookings',
    '*/5 * * * *',
    'SELECT cancel_expired_pending_bookings();'
  );
  RAISE NOTICE 'pg_cron job scheduled successfully';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available — skipping cron schedule. Use an external scheduler instead.';
END;
$$;
