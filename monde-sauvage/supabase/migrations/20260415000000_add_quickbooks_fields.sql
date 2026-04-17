-- Add QuickBooks Online OAuth fields to the guide table
ALTER TABLE "guide"
  ADD COLUMN IF NOT EXISTS "quickbooks_connected" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "quickbooks_access_token" text,
  ADD COLUMN IF NOT EXISTS "quickbooks_refresh_token" text,
  ADD COLUMN IF NOT EXISTS "quickbooks_realm_id" text,
  ADD COLUMN IF NOT EXISTS "quickbooks_token_created_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "quickbooks_access_token_expires_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "quickbooks_refresh_token_expires_at" timestamptz;

CREATE INDEX IF NOT EXISTS idx_guide_quickbooks_connected
  ON "guide" ("quickbooks_connected")
  WHERE "quickbooks_connected" = true;
