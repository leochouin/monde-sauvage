-- =============================================================================
-- RPC : stock d'équipement disponible pour une période donnée
-- =============================================================================
-- Retourne le nombre d'unités libres par equipment_kind pour un chalet + fenêtre
-- de dates. Utilisé côté client pour bloquer le "+" dès que le stock est atteint.
--
-- Sécurité : SECURITY DEFINER pour bypasser RLS (inventory_unit est privé).
-- Accessible aux utilisateurs authentifiés ET anonymes (parcours non connecté).
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
    iu.equipment_kind_id,
    COUNT(iu.id)::bigint AS available_count
  FROM public.inventory_unit iu
  WHERE iu.establishment_id = p_establishment_id
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
  GROUP BY iu.equipment_kind_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_available_equipment_counts(uuid, uuid, date, date)
  TO authenticated, anon;

COMMENT ON FUNCTION public.get_available_equipment_counts(uuid, uuid, date, date) IS
  'Retourne le nombre d''unités d''inventaire encore libres par equipment_kind pour le chalet et la période indiqués. Utilisé par le flux de réservation pour bloquer le bouton + en temps réel.';
