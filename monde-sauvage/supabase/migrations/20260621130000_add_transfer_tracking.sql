-- =============================================================================
-- Stripe Connect transfer tracking (combined "separate charges & transfers")
-- =============================================================================
-- In combined-booking mode the PaymentIntent is charged on the platform and the
-- webhook fans out one Transfer per vendor (guide + establishment). Until now a
-- failed transfer only left a free-text note on the booking, which made it
-- impossible to find or replay reliably.
--
-- These columns let the webhook record transfer outcomes structurally and let a
-- reconciliation path (stripe-reconcile-transfers) re-attempt the failed ones.
--   transfer_status: NULL = n/a (non-combined), 'paid', 'failed'
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- guide_booking (guide leg of a combined PI)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "guide_booking"
  ADD COLUMN IF NOT EXISTS "stripe_transfer_id" text,
  ADD COLUMN IF NOT EXISTS "transfer_status" text,
  ADD COLUMN IF NOT EXISTS "transfer_failed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "transfer_error" text;

CREATE INDEX IF NOT EXISTS idx_guide_booking_transfer_failed
  ON "guide_booking" ("transfer_status")
  WHERE "transfer_status" = 'failed';

-- ─────────────────────────────────────────────────────────────────────────────
-- bookings (chalet leg of a combined PI)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "stripe_transfer_id" text,
  ADD COLUMN IF NOT EXISTS "transfer_status" text,
  ADD COLUMN IF NOT EXISTS "transfer_failed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "transfer_error" text;

CREATE INDEX IF NOT EXISTS idx_bookings_transfer_failed
  ON "bookings" ("transfer_status")
  WHERE "transfer_status" = 'failed';
