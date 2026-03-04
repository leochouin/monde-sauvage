-- Fix: Remove COALESCE('...uuid') that causes type mismatch when id is bigint.
-- NEW.id is always set in a BEFORE trigger (PostgreSQL applies defaults first),
-- so the COALESCE fallback was unnecessary.

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

  -- Check for overlapping active bookings (exclude self for UPDATE)
  SELECT COUNT(*) INTO v_conflict_count
  FROM guide_booking
  WHERE guide_id = NEW.guide_id
    AND id IS DISTINCT FROM NEW.id
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