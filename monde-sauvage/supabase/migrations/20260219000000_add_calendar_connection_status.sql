-- Migration: Bulletproof Google Calendar Connectivity
--
-- Adds fields for:
-- 1. Calendar connection status tracking (connected / disconnected / pending_reauth)
-- 2. Token encryption support (encrypted_refresh_token, token_encryption_iv)
-- 3. Observability (last_validated_at, disconnected_at, disconnect_reason, token_refresh_failures)
-- 4. Access token caching in DB (cached_access_token, access_token_expires_at)

-- ============================================================
-- 1. Connection status tracking
-- ============================================================

-- Calendar connection status enum-like column
-- Values: 'connected', 'disconnected', 'pending_reauth', 'never_connected'
ALTER TABLE guide
  ADD COLUMN IF NOT EXISTS calendar_connection_status TEXT DEFAULT 'never_connected';

-- Timestamp when calendar was disconnected (for alerting/display)
ALTER TABLE guide
  ADD COLUMN IF NOT EXISTS calendar_disconnected_at TIMESTAMPTZ;

-- Reason for disconnection (for diagnostics)
ALTER TABLE guide
  ADD COLUMN IF NOT EXISTS calendar_disconnect_reason TEXT;

-- Last time the token was validated by health-check
ALTER TABLE guide
  ADD COLUMN IF NOT EXISTS calendar_last_validated_at TIMESTAMPTZ;

-- Consecutive token refresh failure count (for alerting thresholds)
ALTER TABLE guide
  ADD COLUMN IF NOT EXISTS token_refresh_failure_count INTEGER DEFAULT 0;

-- ============================================================
-- 2. Token encryption support
-- ============================================================

-- Encrypted version of refresh token (AES-256-GCM)
ALTER TABLE guide
  ADD COLUMN IF NOT EXISTS encrypted_refresh_token TEXT;

-- Initialization vector for AES-256-GCM decryption
ALTER TABLE guide
  ADD COLUMN IF NOT EXISTS token_encryption_iv TEXT;

-- ============================================================
-- 3. Access token caching (avoids unnecessary Google API calls)
-- ============================================================

ALTER TABLE guide
  ADD COLUMN IF NOT EXISTS cached_access_token TEXT;

ALTER TABLE guide
  ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ;

-- ============================================================
-- 4. Backfill existing guides with proper status
-- ============================================================

-- Guides with a refresh token are 'connected'
UPDATE guide
  SET calendar_connection_status = 'connected',
      calendar_last_validated_at = NOW()
  WHERE google_refresh_token IS NOT NULL
    AND calendar_connection_status = 'never_connected';

-- Guides without a refresh token stay 'never_connected'
-- (no-op, just documenting the intent)

-- ============================================================
-- 5. Indexes for operational queries
-- ============================================================

-- Fast lookup of disconnected guides (for health-check and admin dashboards)
CREATE INDEX IF NOT EXISTS idx_guide_calendar_status
  ON guide(calendar_connection_status)
  WHERE calendar_connection_status != 'never_connected';

-- Fast lookup of guides needing token validation
CREATE INDEX IF NOT EXISTS idx_guide_last_validated
  ON guide(calendar_last_validated_at)
  WHERE google_refresh_token IS NOT NULL;

-- ============================================================
-- 6. Comments
-- ============================================================

COMMENT ON COLUMN guide.calendar_connection_status IS 'Current Google Calendar connectivity: connected | disconnected | pending_reauth | never_connected';
COMMENT ON COLUMN guide.calendar_disconnected_at IS 'Timestamp when the guide was marked as calendar_disconnected';
COMMENT ON COLUMN guide.calendar_disconnect_reason IS 'Reason for disconnection: token_revoked | token_expired | refresh_failed | user_revoked | health_check_failed';
COMMENT ON COLUMN guide.calendar_last_validated_at IS 'Last time a health-check confirmed the refresh token works';
COMMENT ON COLUMN guide.token_refresh_failure_count IS 'Consecutive refresh failures. Reset to 0 on success.';
COMMENT ON COLUMN guide.encrypted_refresh_token IS 'AES-256-GCM encrypted Google refresh token';
COMMENT ON COLUMN guide.token_encryption_iv IS 'Initialization vector for decrypting encrypted_refresh_token';
COMMENT ON COLUMN guide.cached_access_token IS 'Cached Google access token to avoid redundant refreshes';
COMMENT ON COLUMN guide.access_token_expires_at IS 'Expiry time of the cached access token';

-- ============================================================
-- 7. View for admin observability
-- ============================================================

CREATE OR REPLACE VIEW guide_calendar_health AS
SELECT
  g.id,
  g.name,
  g.email,
  g.calendar_connection_status,
  g.calendar_last_validated_at,
  g.calendar_disconnected_at,
  g.calendar_disconnect_reason,
  g.token_refresh_failure_count,
  g.google_token_created_at,
  CASE
    WHEN g.google_refresh_token IS NULL THEN 'no_token'
    WHEN g.calendar_connection_status = 'disconnected' THEN 'action_required'
    WHEN g.calendar_last_validated_at < NOW() - INTERVAL '24 hours' THEN 'stale'
    ELSE 'healthy'
  END AS health_status,
  NOW() - g.calendar_last_validated_at AS time_since_validation
FROM guide g
WHERE g.google_refresh_token IS NOT NULL
   OR g.calendar_connection_status != 'never_connected'
ORDER BY
  CASE g.calendar_connection_status
    WHEN 'disconnected' THEN 1
    WHEN 'pending_reauth' THEN 2
    WHEN 'connected' THEN 3
    ELSE 4
  END,
  g.calendar_last_validated_at ASC NULLS FIRST;
