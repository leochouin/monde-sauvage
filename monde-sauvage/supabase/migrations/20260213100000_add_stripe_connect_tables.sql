-- =============================================================================
-- Stripe Connect Integration for Multi-Vendor Booking Platform
-- =============================================================================
-- This migration adds:
--   1. stripe_account_id + onboarding_complete to Etablissement (vendors)
--   2. stripe_payment_intent_id + total_price + payment columns to bookings
--   3. pricing_rules table for seasonal/weekend pricing
--   4. stripe_webhook_events table for idempotent webhook processing
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add Stripe fields to Etablissement (vendor) table
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Etablissement' AND column_name = 'stripe_account_id'
    ) THEN
        ALTER TABLE "Etablissement" ADD COLUMN stripe_account_id TEXT;
        COMMENT ON COLUMN "Etablissement".stripe_account_id IS 'Stripe Connect Express account ID (acct_xxx)';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Etablissement' AND column_name = 'stripe_onboarding_complete'
    ) THEN
        ALTER TABLE "Etablissement" ADD COLUMN stripe_onboarding_complete BOOLEAN DEFAULT FALSE;
        COMMENT ON COLUMN "Etablissement".stripe_onboarding_complete IS 'Whether vendor has completed Stripe onboarding';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Etablissement' AND column_name = 'stripe_charges_enabled'
    ) THEN
        ALTER TABLE "Etablissement" ADD COLUMN stripe_charges_enabled BOOLEAN DEFAULT FALSE;
        COMMENT ON COLUMN "Etablissement".stripe_charges_enabled IS 'Whether Stripe account can accept charges';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Etablissement' AND column_name = 'stripe_payouts_enabled'
    ) THEN
        ALTER TABLE "Etablissement" ADD COLUMN stripe_payouts_enabled BOOLEAN DEFAULT FALSE;
        COMMENT ON COLUMN "Etablissement".stripe_payouts_enabled IS 'Whether Stripe account can receive payouts';
    END IF;
END $$;

-- Index for looking up establishments by Stripe account (used in webhooks)
CREATE INDEX IF NOT EXISTS idx_etablissement_stripe_account
    ON "Etablissement"(stripe_account_id)
    WHERE stripe_account_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Add payment fields to bookings table
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bookings' AND column_name = 'stripe_payment_intent_id'
    ) THEN
        ALTER TABLE bookings ADD COLUMN stripe_payment_intent_id TEXT;
        COMMENT ON COLUMN bookings.stripe_payment_intent_id IS 'Stripe PaymentIntent ID (pi_xxx)';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bookings' AND column_name = 'total_price'
    ) THEN
        ALTER TABLE bookings ADD COLUMN total_price NUMERIC(10,2);
        COMMENT ON COLUMN bookings.total_price IS 'Total price in CAD for the booking';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bookings' AND column_name = 'nights'
    ) THEN
        ALTER TABLE bookings ADD COLUMN nights INTEGER;
        COMMENT ON COLUMN bookings.nights IS 'Number of nights for the stay';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bookings' AND column_name = 'price_per_night'
    ) THEN
        ALTER TABLE bookings ADD COLUMN price_per_night NUMERIC(10,2);
        COMMENT ON COLUMN bookings.price_per_night IS 'Snapshot of the nightly rate at time of booking';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bookings' AND column_name = 'application_fee'
    ) THEN
        ALTER TABLE bookings ADD COLUMN application_fee NUMERIC(10,2);
        COMMENT ON COLUMN bookings.application_fee IS 'Platform fee (10%) in CAD';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bookings' AND column_name = 'payment_status'
    ) THEN
        ALTER TABLE bookings ADD COLUMN payment_status TEXT DEFAULT 'unpaid';
        COMMENT ON COLUMN bookings.payment_status IS 'Payment status: unpaid, processing, paid, refunded, partially_refunded, failed';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bookings' AND column_name = 'refund_amount'
    ) THEN
        ALTER TABLE bookings ADD COLUMN refund_amount NUMERIC(10,2);
        COMMENT ON COLUMN bookings.refund_amount IS 'Amount refunded (if any)';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bookings' AND column_name = 'stripe_refund_id'
    ) THEN
        ALTER TABLE bookings ADD COLUMN stripe_refund_id TEXT;
        COMMENT ON COLUMN bookings.stripe_refund_id IS 'Stripe Refund ID (re_xxx)';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'bookings' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE bookings ADD COLUMN user_id UUID REFERENCES auth.users(id);
        COMMENT ON COLUMN bookings.user_id IS 'Authenticated user who made the booking';
    END IF;
END $$;

-- Indexes for payment queries
CREATE INDEX IF NOT EXISTS idx_bookings_stripe_pi ON bookings(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id) WHERE user_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Pricing rules table (optional seasonal/weekend pricing)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chalet_id UUID NOT NULL,
    name TEXT NOT NULL,                          -- e.g. "Summer Peak", "Weekend Rate"
    rule_type TEXT NOT NULL DEFAULT 'seasonal',  -- 'seasonal', 'weekend', 'holiday'
    price_per_night NUMERIC(10,2) NOT NULL,      -- Override price
    start_date DATE,                             -- For seasonal rules
    end_date DATE,                               -- For seasonal rules
    days_of_week INTEGER[],                      -- For weekend rules: {5,6} = Fri, Sat (0=Sun)
    priority INTEGER DEFAULT 0,                  -- Higher priority wins if multiple match
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE pricing_rules IS 'Override pricing for specific dates/seasons/weekends';

-- Try to add FK constraint to chalets
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_pricing_rules_chalet'
    ) THEN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chalets') THEN
            ALTER TABLE pricing_rules
                ADD CONSTRAINT fk_pricing_rules_chalet
                FOREIGN KEY (chalet_id) REFERENCES chalets(key) ON DELETE CASCADE;
        END IF;
    END IF;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_pricing_rules_chalet ON pricing_rules(chalet_id);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_dates ON pricing_rules(start_date, end_date) WHERE rule_type = 'seasonal';

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_pricing_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_pricing_rules_updated_at ON pricing_rules;
CREATE TRIGGER trigger_pricing_rules_updated_at
    BEFORE UPDATE ON pricing_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_pricing_rules_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Webhook events table (for idempotent webhook processing)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    id TEXT PRIMARY KEY,                    -- Stripe event ID (evt_xxx)
    type TEXT NOT NULL,                     -- Event type (payment_intent.succeeded, etc.)
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    payload JSONB                           -- Full event data for debugging
);

COMMENT ON TABLE stripe_webhook_events IS 'Tracks processed Stripe webhook events for idempotency';

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_type ON stripe_webhook_events(type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS Policies
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable RLS on new tables
ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- pricing_rules: vendors can manage their own chalet pricing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Vendors can view their pricing rules') THEN
        CREATE POLICY "Vendors can view their pricing rules"
            ON pricing_rules FOR SELECT
            USING (
                chalet_id IN (
                    SELECT c.key FROM chalets c
                    JOIN "Etablissement" e ON c.etablishment_id = e.key
                    WHERE e.owner_id = auth.uid()
                )
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Vendors can insert pricing rules') THEN
        CREATE POLICY "Vendors can insert pricing rules"
            ON pricing_rules FOR INSERT
            WITH CHECK (
                chalet_id IN (
                    SELECT c.key FROM chalets c
                    JOIN "Etablissement" e ON c.etablishment_id = e.key
                    WHERE e.owner_id = auth.uid()
                )
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Vendors can update pricing rules') THEN
        CREATE POLICY "Vendors can update pricing rules"
            ON pricing_rules FOR UPDATE
            USING (
                chalet_id IN (
                    SELECT c.key FROM chalets c
                    JOIN "Etablissement" e ON c.etablishment_id = e.key
                    WHERE e.owner_id = auth.uid()
                )
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Vendors can delete pricing rules') THEN
        CREATE POLICY "Vendors can delete pricing rules"
            ON pricing_rules FOR DELETE
            USING (
                chalet_id IN (
                    SELECT c.key FROM chalets c
                    JOIN "Etablissement" e ON c.etablishment_id = e.key
                    WHERE e.owner_id = auth.uid()
                )
            );
    END IF;

    -- Anyone can read pricing rules (needed for calculating prices on checkout)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can view active pricing rules') THEN
        CREATE POLICY "Anyone can view active pricing rules"
            ON pricing_rules FOR SELECT
            USING (is_active = TRUE);
    END IF;

    -- stripe_webhook_events: only service role can access
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role manages webhook events') THEN
        CREATE POLICY "Service role manages webhook events"
            ON stripe_webhook_events FOR ALL
            USING (FALSE); -- Only accessible via service role key (bypasses RLS)
    END IF;

    -- Bookings: users can view their own bookings
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view their own bookings') THEN
        CREATE POLICY "Users can view their own bookings"
            ON bookings FOR SELECT
            USING (user_id = auth.uid());
    END IF;
END $$;

-- Grant anon access for checkout flow (edge functions use service role)
GRANT SELECT ON pricing_rules TO anon;
GRANT SELECT ON pricing_rules TO authenticated;
GRANT ALL ON pricing_rules TO service_role;
GRANT ALL ON stripe_webhook_events TO service_role;
