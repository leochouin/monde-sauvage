-- =============================================================================
-- Fix : get_available_equipment_counts retourne aussi les kinds avec 0 unités
-- =============================================================================
-- La version initiale utilisait GROUP BY sur inventory_unit, donc les kinds sans
-- aucune unité active disparaissaient du résultat.
-- On passe à un LEFT JOIN depuis equipment_kind pour garantir une ligne par kind
-- (count = 0 quand tout est épuisé).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_available_equipment_counts(
  p_establishment_id uuid,
  p_chalet_id        uuid,
  p_start_date       date,
  p_end_date         date
)
RETURNS TABLE (equipment_kind_id uuid, available_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ek.id AS equipment_kind_id,
    COUNT(iu.id)::bigint AS available_count
  FROM public.equipment_kind ek
  LEFT JOIN public.inventory_unit iu
    ON  iu.equipment_kind_id = ek.id
    AND iu.establishment_id  = p_establishment_id
    AND iu.is_active  = TRUE
    AND iu.deleted_at IS NULL
    AND (iu.chalet_id IS NULL OR iu.chalet_id = p_chalet_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.booking_inventory_allocation bia
      WHERE bia.inventory_unit_id = iu.id
        AND bia.status = ANY(ARRAY[
          'pending'::text,
          'pending_payment'::text,
          'confirmed'::text,
          'blocked'::text
        ])
        AND bia.start_at < p_end_date::timestamptz
        AND bia.end_at   > p_start_date::timestamptz
    )
  WHERE ek.establishment_id = p_establishment_id
    AND ek.is_active = TRUE
  GROUP BY ek.id;
$$;

GRANT EXECUTE ON FUNCTION public.get_available_equipment_counts(uuid, uuid, date, date)
  TO authenticated, anon;

COMMENT ON FUNCTION public.get_available_equipment_counts(uuid, uuid, date, date) IS
  'Retourne le stock disponible pour chaque equipment_kind actif, y compris ceux à 0 unité (épuisé). LEFT JOIN garantit une ligne par kind.';
