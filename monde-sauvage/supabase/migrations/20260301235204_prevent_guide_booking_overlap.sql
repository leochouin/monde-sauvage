-- =============================================================================
-- Migration: Prevent overlapping guide bookings at the database level
-- =============================================================================
-- Uses a BEFORE INSERT/UPDATE trigger to enforce that no two active bookings
-- for the same guide can overlap in time. This is the ultimate safety net
-- against race conditions — even if two concurrent requests pass the
-- application-level overlap check, the DB will reject the second one.
--
-- We use a trigger + advisory lock instead of an EXCLUDE constraint because
-- EXCLUDE with custom functions in WHERE clauses requires special handling.
-- The advisory lock serializes concurrent inserts for the same guide,
-- preventing TOCTOU race conditions.
-- =============================================================================

-- 1. Create the trigger function that prevents overlapping active bookings
CREATE OR REPLACE FUNCTION prevent_guide_booking_overlap()
RETURNS TRIGGER AS $$
DECLARE
  v_conflict_count INTEGER;
  v_active_statuses TEXT[] := ARRAY['pending', 'pending_payment', 'confirmed', 'booked'];
BEGIN
  -- Only check for active bookings (not cancelled/completed/deleted)
  IF NOT (NEW.status = ANY(v_active_statuses)) THEN
    RETURN NEW;
  END IF;

  -- Skip if soft-deleted
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Acquire an advisory lock on the guide_id to serialize concurrent inserts.
  -- This converts the check-then-insert into an atomic operation.
  -- The lock is automatically released at the end of the transaction.
  PERFORM pg_advisory_xact_lock(hashtext('guide_booking_' || NEW.guide_id::text));

  -- Check for overlapping active bookings
  SELECT COUNT(*) INTO v_conflict_count
  FROM guide_booking
  WHERE guide_id = NEW.guide_id
    AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND deleted_at IS NULL
    AND status = ANY(v_active_statuses)
    AND start_time < NEW.end_time
    AND end_time > NEW.start_time;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'guide_booking_no_overlap: Ce créneau chevauche une réservation existante pour ce guide.'
      USING ERRCODE = '23P01'; -- exclusion_violation
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Create the trigger
DROP TRIGGER IF EXISTS trg_prevent_guide_booking_overlap ON guide_booking;
CREATE TRIGGER trg_prevent_guide_booking_overlap
  BEFORE INSERT OR UPDATE ON guide_booking
  FOR EACH ROW
  EXECUTE FUNCTION prevent_guide_booking_overlap();

-- 3. Add a comment
COMMENT ON FUNCTION prevent_guide_booking_overlap() IS
  'Prevents overlapping active bookings for the same guide. '
  'Uses advisory lock on guide_id for serialization + overlap check. '
  'Raises exclusion_violation (23P01) if conflict detected.';

-- 4. Add an index to speed up the overlap check
CREATE INDEX IF NOT EXISTS idx_guide_booking_active_overlap
  ON guide_booking (guide_id, start_time, end_time)
  WHERE status IN ('pending', 'pending_payment', 'confirmed', 'booked')
    AND deleted_at IS NULL;
