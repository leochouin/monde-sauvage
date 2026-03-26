-- =============================================================================
-- Booking origin + platform fee policy tracking
-- =============================================================================
-- Separates:
--   1) whether a booking requires payment
--   2) whether platform fee applies
--
-- Adds auditable fields to both booking tables and backfills legacy rows.
-- =============================================================================

-- ---------------------------
-- guide_booking
-- ---------------------------
ALTER TABLE guide_booking
  ADD COLUMN IF NOT EXISTS booking_origin TEXT,
  ADD COLUMN IF NOT EXISTS platform_fee_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS platform_fee_waived BOOLEAN;

-- Backfill booking_origin from legacy source semantics.
UPDATE guide_booking
SET booking_origin = CASE
  WHEN source = 'system' THEN 'guide_manual'
  ELSE 'platform'
END
WHERE booking_origin IS NULL;

UPDATE guide_booking
SET platform_fee_amount = COALESCE(application_fee, 0)
WHERE platform_fee_amount IS NULL;

UPDATE guide_booking
SET platform_fee_waived = CASE
  WHEN COALESCE(platform_fee_amount, 0) = 0 AND booking_origin = 'guide_manual' THEN TRUE
  ELSE FALSE
END
WHERE platform_fee_waived IS NULL;

ALTER TABLE guide_booking
  ALTER COLUMN booking_origin SET DEFAULT 'platform',
  ALTER COLUMN booking_origin SET NOT NULL,
  ALTER COLUMN platform_fee_amount SET DEFAULT 0,
  ALTER COLUMN platform_fee_amount SET NOT NULL,
  ALTER COLUMN platform_fee_waived SET DEFAULT FALSE,
  ALTER COLUMN platform_fee_waived SET NOT NULL;

ALTER TABLE guide_booking DROP CONSTRAINT IF EXISTS guide_booking_booking_origin_check;
ALTER TABLE guide_booking
  ADD CONSTRAINT guide_booking_booking_origin_check
  CHECK (booking_origin IN ('platform', 'guide_manual'));

COMMENT ON COLUMN guide_booking.booking_origin IS 'Business booking origin: platform or guide_manual';
COMMENT ON COLUMN guide_booking.platform_fee_amount IS 'Monde Sauvage fee amount for this booking in CAD';
COMMENT ON COLUMN guide_booking.platform_fee_waived IS 'True when platform fee is intentionally waived';

CREATE INDEX IF NOT EXISTS idx_guide_booking_booking_origin ON guide_booking(booking_origin);
CREATE INDEX IF NOT EXISTS idx_guide_booking_platform_fee_waived ON guide_booking(platform_fee_waived);

-- ---------------------------
-- bookings (chalet)
-- ---------------------------
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS booking_origin TEXT,
  ADD COLUMN IF NOT EXISTS platform_fee_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS platform_fee_waived BOOLEAN;

UPDATE bookings
SET booking_origin = 'platform'
WHERE booking_origin IS NULL;

UPDATE bookings
SET platform_fee_amount = COALESCE(application_fee, 0)
WHERE platform_fee_amount IS NULL;

UPDATE bookings
SET platform_fee_waived = CASE
  WHEN COALESCE(platform_fee_amount, 0) = 0 THEN TRUE
  ELSE FALSE
END
WHERE platform_fee_waived IS NULL;

ALTER TABLE bookings
  ALTER COLUMN booking_origin SET DEFAULT 'platform',
  ALTER COLUMN booking_origin SET NOT NULL,
  ALTER COLUMN platform_fee_amount SET DEFAULT 0,
  ALTER COLUMN platform_fee_amount SET NOT NULL,
  ALTER COLUMN platform_fee_waived SET DEFAULT FALSE,
  ALTER COLUMN platform_fee_waived SET NOT NULL;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_booking_origin_check;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_booking_origin_check
  CHECK (booking_origin IN ('platform', 'guide_manual'));

COMMENT ON COLUMN bookings.booking_origin IS 'Business booking origin: platform or guide_manual';
COMMENT ON COLUMN bookings.platform_fee_amount IS 'Monde Sauvage fee amount for this booking in CAD';
COMMENT ON COLUMN bookings.platform_fee_waived IS 'True when platform fee is intentionally waived';

CREATE INDEX IF NOT EXISTS idx_bookings_booking_origin ON bookings(booking_origin);
CREATE INDEX IF NOT EXISTS idx_bookings_platform_fee_waived ON bookings(platform_fee_waived);
