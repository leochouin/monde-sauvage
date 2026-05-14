-- Permet aux propriétaires d'établissement de voir les réservations chalet (pour calendrier opérations UI).

DROP POLICY IF EXISTS "Establishment owners can view bookings for their chalets" ON public.bookings;
CREATE POLICY "Establishment owners can view bookings for their chalets"
  ON public.bookings
  FOR SELECT
  TO authenticated
  USING (
    chalet_id IN (
      SELECT c.key
      FROM public.chalets c
      INNER JOIN public."Etablissement" e ON e.key = c.etablishment_id
      WHERE e.owner_id = auth.uid()
    )
  );

COMMENT ON POLICY "Establishment owners can view bookings for their chalets" ON public.bookings IS
  'Lecture des réservations des chalets appartenant à l’établissement du propriétaire (complète la policy client user_id).';
