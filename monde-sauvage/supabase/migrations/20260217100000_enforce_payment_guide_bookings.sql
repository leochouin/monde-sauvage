-- =============================================================================
-- Migration: Payment enforcement for guide bookings
-- =============================================================================
-- 1. Add 'pending_payment' to guide_booking status constraint
-- 2. Add payment_link_url and payment_link_expires_at columns
-- 3. Add database trigger to prevent confirming unpaid bookings
-- 4. Add constraint: confirmed bookings for paid guides must have is_paid=true
-- =============================================================================

-- 1. Drop and recreate the status check constraint to include 'pending_payment'
ALTER TABLE guide_booking DROP CONSTRAINT IF EXISTS guide_booking_status_check;
ALTER TABLE guide_booking ADD CONSTRAINT guide_booking_status_check 
  CHECK (status IN ('pending', 'pending_payment', 'confirmed', 'cancelled', 'completed', 'booked', 'deleted'));

-- 2. Add payment link columns
ALTER TABLE guide_booking ADD COLUMN IF NOT EXISTS payment_link_url TEXT;
ALTER TABLE guide_booking ADD COLUMN IF NOT EXISTS payment_link_expires_at TIMESTAMPTZ;

-- 3. Create trigger function to enforce payment before confirmation
--    For guides with Stripe enabled (hourly_rate > 0 AND stripe_charges_enabled),
--    bookings cannot transition to 'confirmed' unless is_paid = true.
CREATE OR REPLACE FUNCTION enforce_payment_on_confirm()
RETURNS TRIGGER AS $$
DECLARE
  v_guide RECORD;
BEGIN
  -- Only check when status is being set to 'confirmed'
  IF NEW.status = 'confirmed' AND (OLD.status IS NULL OR OLD.status != 'confirmed') THEN
    -- Fetch the guide's payment configuration
    SELECT hourly_rate, stripe_charges_enabled, stripe_account_id
    INTO v_guide
    FROM guide
    WHERE id = NEW.guide_id;

    -- If guide has Stripe enabled and hourly rate > 0, payment is required
    IF v_guide.stripe_charges_enabled = true AND v_guide.hourly_rate > 0 THEN
      -- Exception: webhook updates (service role) set is_paid=true simultaneously
      IF NEW.is_paid IS NOT TRUE THEN
        RAISE EXCEPTION 'Cannot confirm booking: payment is required for this guide. Booking must be paid via Stripe before confirmation.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists and create the trigger
DROP TRIGGER IF EXISTS trg_enforce_payment_on_confirm ON guide_booking;
CREATE TRIGGER trg_enforce_payment_on_confirm
  BEFORE INSERT OR UPDATE ON guide_booking
  FOR EACH ROW
  EXECUTE FUNCTION enforce_payment_on_confirm();

-- 4. Add index for payment link expiry cleanup (used by cron job)
CREATE INDEX IF NOT EXISTS idx_guide_booking_pending_payment_expiry
  ON guide_booking (payment_link_expires_at)
  WHERE status = 'pending_payment' AND is_paid = false;

-- 5. Add RLS policy for payment link access
-- Guides can see their own payment link URLs
DROP POLICY IF EXISTS "Guides can view own booking payment links" ON guide_booking;
-- (Existing RLS policies already allow guides to read their own bookings)
