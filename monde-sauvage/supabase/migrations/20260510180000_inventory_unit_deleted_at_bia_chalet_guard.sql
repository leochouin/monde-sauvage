-- Soft-delete audit + garantir qu'une unité assignée à un chalet ne s'attribue pas à une autre réservation.

ALTER TABLE public.inventory_unit
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.inventory_unit.deleted_at IS
  'Horodatage du retrait par le propriétaire ; NULL si l’unité est encore en service. Les allocations historiques conservent leur FK.';

CREATE OR REPLACE FUNCTION public.inventory_unit_sync_deleted_at_from_active()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_active IS NOT TRUE THEN
    NEW.deleted_at := COALESCE(NEW.deleted_at, now());
  ELSE
    NEW.deleted_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_unit_sync_deleted_at ON public.inventory_unit;
CREATE TRIGGER trg_inventory_unit_sync_deleted_at
  BEFORE INSERT OR UPDATE ON public.inventory_unit
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_unit_sync_deleted_at_from_active();

CREATE OR REPLACE FUNCTION public.enforce_bia_inventory_unit_chalet_booking_match()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_unit_chalet uuid;
  v_booking_chalet uuid;
BEGIN
  SELECT iu.chalet_id INTO v_unit_chalet
  FROM public.inventory_unit iu
  WHERE iu.id = NEW.inventory_unit_id;

  IF v_unit_chalet IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT b.chalet_id INTO v_booking_chalet
  FROM public.bookings b
  WHERE b.id = NEW.chalet_booking_id;

  IF v_booking_chalet IS NULL THEN
    RAISE EXCEPTION 'bia_chalet_match: réservation introuvable (booking_id=%)', NEW.chalet_booking_id;
  END IF;

  IF v_unit_chalet IS DISTINCT FROM v_booking_chalet THEN
    RAISE EXCEPTION 'bia_chalet_match: l''unité est réservée au chalet % mais la réservation concerne le chalet %',
      v_unit_chalet, v_booking_chalet
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bia_inventory_unit_chalet_booking_match ON public.booking_inventory_allocation;
CREATE TRIGGER trg_bia_inventory_unit_chalet_booking_match
  BEFORE INSERT OR UPDATE OF chalet_booking_id, inventory_unit_id
  ON public.booking_inventory_allocation
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_bia_inventory_unit_chalet_booking_match();

COMMENT ON FUNCTION public.enforce_bia_inventory_unit_chalet_booking_match() IS
  'Si inventory_unit.chalet_id est défini, seule une réservation sur ce même chalet peut recevoir l''allocation.';

-- Allocation : ignorer unités soft-supprimées
CREATE OR REPLACE FUNCTION public.allocate_inventory_for_booking(
  p_booking_id bigint,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chalet_id uuid;
  v_est uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_booking_status text;
  v_line jsonb;
  v_kind_id uuid;
  v_slug text;
  v_qty int;
  v_got int;
  v_unit_id uuid;
  v_alloc_id uuid;
  v_allocation_ids uuid[] := ARRAY[]::uuid[];
  v_unit_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT b.chalet_id, c.etablishment_id, b.start_date, b.end_date, b.status
  INTO v_chalet_id, v_est, v_start, v_end, v_booking_status
  FROM public.bookings b
  INNER JOIN public.chalets c ON c.key = b.chalet_id
  WHERE b.id = p_booking_id;

  IF v_chalet_id IS NULL THEN
    RAISE EXCEPTION 'allocate_inventory: réservation ou chalet introuvable pour booking_id=%',
      p_booking_id USING ERRCODE = 'P0001';
  END IF;

  IF v_booking_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'allocate_inventory: la réservation doit être en pending (booking_id=% statut=%)',
      p_booking_id, v_booking_status USING ERRCODE = 'P0001';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object(
      'allocation_ids', '[]'::jsonb,
      'unit_ids', '[]'::jsonb,
      'count_allocations', 0
    );
  END IF;

  FOR v_line IN SELECT elem FROM jsonb_array_elements(p_lines) AS elem
  LOOP
    v_kind_id := NULL;
    v_slug := NULL;
    IF v_line ? 'equipment_kind_id'
       AND NULLIF(trim(v_line->>'equipment_kind_id'), '') IS NOT NULL THEN
      v_kind_id := (v_line->>'equipment_kind_id')::uuid;
    ELSIF v_line ? 'slug'
       AND NULLIF(trim(v_line->>'slug'), '') IS NOT NULL THEN
      v_slug := trim(v_line->>'slug');
      SELECT ek.id INTO v_kind_id
      FROM public.equipment_kind ek
      WHERE ek.establishment_id = v_est
        AND ek.slug = v_slug
        AND ek.is_active = TRUE;
      IF v_kind_id IS NULL THEN
        RAISE EXCEPTION 'allocate_inventory: type d''équipement slug=% introuvable ou inactif',
          v_slug USING ERRCODE = 'P0001';
      END IF;
    END IF;

    v_qty := COALESCE(NULLIF(trim(v_line->>'quantity'), '')::int, 0);
    IF v_kind_id IS NULL OR v_qty < 1 OR v_qty > 50 THEN
      RAISE EXCEPTION 'allocate_inventory: chaque ligne requiert equipment_kind_id ou slug et quantity entre 1 et 50'
        USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.equipment_kind ek
      WHERE ek.id = v_kind_id AND ek.establishment_id = v_est AND ek.is_active = TRUE
    ) THEN
      RAISE EXCEPTION 'allocate_inventory: kind % inexistant ou ne correspond pas à l''établissement',
        v_kind_id USING ERRCODE = 'P0001';
    END IF;

    v_got := 0;
    FOR v_unit_id IN
      SELECT iu.id
      FROM public.inventory_unit iu
      WHERE iu.establishment_id = v_est
        AND iu.equipment_kind_id = v_kind_id
        AND iu.is_active = TRUE
        AND iu.deleted_at IS NULL
        AND (iu.chalet_id IS NULL OR iu.chalet_id = v_chalet_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.booking_inventory_allocation bia
          WHERE bia.inventory_unit_id = iu.id
            AND bia.status = ANY (
              ARRAY[
                'pending'::text,
                'pending_payment'::text,
                'confirmed'::text,
                'blocked'::text
              ]
            )
            AND bia.start_at < v_end
            AND bia.end_at > v_start
        )
      ORDER BY iu.sort_order ASC, iu.unit_code ASC
      FOR UPDATE OF iu SKIP LOCKED
      LIMIT v_qty
    LOOP
      INSERT INTO public.booking_inventory_allocation (
        chalet_booking_id,
        inventory_unit_id,
        start_at,
        end_at,
        status,
        payment_status,
        booking_origin
      ) VALUES (
        p_booking_id,
        v_unit_id,
        v_start,
        v_end,
        'pending',
        'processing',
        'platform'
      )
      RETURNING id INTO v_alloc_id;

      v_allocation_ids := array_append(v_allocation_ids, v_alloc_id);
      v_unit_ids := array_append(v_unit_ids, v_unit_id);
      v_got := v_got + 1;
      EXIT WHEN v_got >= v_qty;
    END LOOP;

    IF v_got < v_qty THEN
      RAISE EXCEPTION 'insufficient_inventory: besoin de % unités pour kind % (% déjà attribuées)',
        v_qty, v_kind_id, v_got
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'allocation_ids', to_jsonb(v_allocation_ids),
    'unit_ids', to_jsonb(v_unit_ids),
    'count_allocations', COALESCE(array_length(v_allocation_ids, 1), 0)
  );
END;
$$;

COMMENT ON FUNCTION public.allocate_inventory_for_booking(bigint, jsonb) IS
  'Réserve les unités physiques actives (deleted_at NULL) pour un booking chalet pending.';

NOTIFY pgrst, 'reload schema';
