-- =============================================================================
-- Owner (Etablissement) QuickBooks integration + invoice traceability
-- =============================================================================
-- 1. Mirrors the QuickBooks OAuth fields from `guide` onto `Etablissement` so
--    Owners (Hébergement / Pourvoirie) can connect their own QBO account.
-- 2. Adds quickbooks_invoice_id + quickbooks_invoice_synced_at to both
--    booking tables (chalet `bookings` and `guide_booking`) so each paid
--    booking can be linked back to the QBO invoice it produced.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Etablissement: add QuickBooks OAuth columns (mirror of guide)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "Etablissement"
  ADD COLUMN IF NOT EXISTS "quickbooks_connected" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "quickbooks_access_token" text,
  ADD COLUMN IF NOT EXISTS "quickbooks_refresh_token" text,
  ADD COLUMN IF NOT EXISTS "quickbooks_realm_id" text,
  ADD COLUMN IF NOT EXISTS "quickbooks_token_created_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "quickbooks_access_token_expires_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "quickbooks_refresh_token_expires_at" timestamptz;

CREATE INDEX IF NOT EXISTS idx_etablissement_quickbooks_connected
  ON "Etablissement" ("quickbooks_connected")
  WHERE "quickbooks_connected" = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. bookings (chalet): invoice traceability
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "quickbooks_invoice_id" text,
  ADD COLUMN IF NOT EXISTS "quickbooks_invoice_synced_at" timestamptz;

CREATE INDEX IF NOT EXISTS idx_bookings_quickbooks_invoice
  ON "bookings" ("quickbooks_invoice_id")
  WHERE "quickbooks_invoice_id" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. guide_booking: invoice traceability
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "guide_booking"
  ADD COLUMN IF NOT EXISTS "quickbooks_invoice_id" text,
  ADD COLUMN IF NOT EXISTS "quickbooks_invoice_synced_at" timestamptz;

CREATE INDEX IF NOT EXISTS idx_guide_booking_quickbooks_invoice
  ON "guide_booking" ("quickbooks_invoice_id")
  WHERE "quickbooks_invoice_id" IS NOT NULL;
