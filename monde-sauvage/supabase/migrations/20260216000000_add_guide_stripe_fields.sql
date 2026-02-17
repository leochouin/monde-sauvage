-- =============================================================================
-- Add Stripe Connect fields to guide table + payment fields to guide_booking
-- =============================================================================
-- Enables guides to accept payments via Stripe Connect (same as establishments)
-- =============================================================================

-- 1. Add Stripe fields to guide table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'guide' AND column_name = 'stripe_account_id'
    ) THEN
        ALTER TABLE guide ADD COLUMN stripe_account_id TEXT;
        COMMENT ON COLUMN guide.stripe_account_id IS 'Stripe Connect Express account ID (acct_xxx)';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'guide' AND column_name = 'stripe_onboarding_complete'
    ) THEN
        ALTER TABLE guide ADD COLUMN stripe_onboarding_complete BOOLEAN DEFAULT FALSE;
        COMMENT ON COLUMN guide.stripe_onboarding_complete IS 'Whether guide has completed Stripe onboarding';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'guide' AND column_name = 'stripe_charges_enabled'
    ) THEN
        ALTER TABLE guide ADD COLUMN stripe_charges_enabled BOOLEAN DEFAULT FALSE;
        COMMENT ON COLUMN guide.stripe_charges_enabled IS 'Whether Stripe account can accept charges';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'guide' AND column_name = 'stripe_payouts_enabled'
    ) THEN
        ALTER TABLE guide ADD COLUMN stripe_payouts_enabled BOOLEAN DEFAULT FALSE;
        COMMENT ON COLUMN guide.stripe_payouts_enabled IS 'Whether Stripe account can receive payouts';
    END IF;
END $$;

-- Index for looking up guides by Stripe account (used in webhooks)
CREATE INDEX IF NOT EXISTS idx_guide_stripe_account
    ON guide(stripe_account_id)
    WHERE stripe_account_id IS NOT NULL;

-- 2. Add Stripe payment fields to guide_booking table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'guide_booking' AND column_name = 'stripe_payment_intent_id'
    ) THEN
        ALTER TABLE guide_booking ADD COLUMN stripe_payment_intent_id TEXT;
        COMMENT ON COLUMN guide_booking.stripe_payment_intent_id IS 'Stripe PaymentIntent ID (pi_xxx)';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'guide_booking' AND column_name = 'payment_status'
    ) THEN
        ALTER TABLE guide_booking ADD COLUMN payment_status TEXT DEFAULT 'unpaid';
        COMMENT ON COLUMN guide_booking.payment_status IS 'Payment status: unpaid/processing/paid/refunded/failed';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'guide_booking' AND column_name = 'application_fee'
    ) THEN
        ALTER TABLE guide_booking ADD COLUMN application_fee NUMERIC(10,2);
        COMMENT ON COLUMN guide_booking.application_fee IS 'Platform application fee (10%)';
    END IF;
END $$;

-- Index for looking up guide bookings by payment intent (used in webhooks)
CREATE INDEX IF NOT EXISTS idx_guide_booking_payment_intent
    ON guide_booking(stripe_payment_intent_id)
    WHERE stripe_payment_intent_id IS NOT NULL;
