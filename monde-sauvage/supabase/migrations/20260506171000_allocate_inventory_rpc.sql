-- =============================================================================
-- Étape 2 — RPC : allocation atomique d'inventaire sur une réservation chalet
-- =============================================================================
-- Appelée depuis l'Edge Function stripe-create-booking (service role) après
-- insertion du booking, avant création du PaymentIntent.
--
-- p_lines exemple :
-- [
--   { "equipment_kind_id": "<uuid>", "quantity": 2 },
--   { "slug": "chaloupe", "quantity": 1 }
-- ]
--
-- Règle de pool : unité disponible si chalet_id IS NULL (pool pourvoirie) OU
-- chalet_id = chalet réservé.
--
-- Tarification équipements (equipment_kind.metadata) — lecture côté Edge :
--   addon_price_per_stay   : prix CAD pour la durée complète du séjour, par unité
--   addon_price_per_night  : prix CAD × nombre de nuits × unités
--
-- Concurrency : FOR UPDATE SKIP LOCKED sur inventory_unit puis INSERT allocation.
-- Tout est annulé (rollback fonction) si une ligne manque de stock.
-- =============================================================================

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
  'Réserve les unités physiques (booking_inventory_allocation en pending) pour un booking chalet pending. Rollback automatique si stock insuffisant.';

REVOKE ALL ON FUNCTION public.allocate_inventory_for_booking(bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_inventory_for_booking(bigint, jsonb) TO service_role;
