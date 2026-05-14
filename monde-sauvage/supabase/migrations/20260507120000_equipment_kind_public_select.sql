-- Checkout add-ons : lecture publique des types d'équipement actifs (prix libellés, slugs pour l'API)
DROP POLICY IF EXISTS equipment_kind_public_select ON public.equipment_kind;
CREATE POLICY equipment_kind_public_select ON public.equipment_kind
  FOR SELECT
  TO anon, authenticated
  USING (is_active = true);
