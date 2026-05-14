-- Réservations saisies / importées par le propriétaire d'établissement (migration depuis un autre logiciel)

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_booking_origin_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_booking_origin_check
  CHECK (booking_origin IN ('platform', 'guide_manual', 'establishment_manual'));

COMMENT ON CONSTRAINT bookings_booking_origin_check ON public.bookings IS
  'platform = client via site ; guide_manual = guide ; establishment_manual = pourvoyeur / migration';

-- INSERT : carnet réservations pour chalets de l'établissement (origine établissement uniquement)
DROP POLICY IF EXISTS "Establishment owners insert establishment_manual bookings" ON public.bookings;
CREATE POLICY "Establishment owners insert establishment_manual bookings"
  ON public.bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    booking_origin = 'establishment_manual'
    AND chalet_id IN (
      SELECT c.key
      FROM public.chalets c
      INNER JOIN public."Etablissement" e ON e.key = c.etablishment_id
      WHERE e.owner_id = auth.uid()
    )
  );

-- UPDATE : corriger ou annuler les réservations migrées / saisies pourvoyeur
DROP POLICY IF EXISTS "Establishment owners update establishment_manual bookings" ON public.bookings;
CREATE POLICY "Establishment owners update establishment_manual bookings"
  ON public.bookings
  FOR UPDATE
  TO authenticated
  USING (
    booking_origin = 'establishment_manual'
    AND chalet_id IN (
      SELECT c.key
      FROM public.chalets c
      INNER JOIN public."Etablissement" e ON e.key = c.etablishment_id
      WHERE e.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    booking_origin = 'establishment_manual'
    AND chalet_id IN (
      SELECT c.key
      FROM public.chalets c
      INNER JOIN public."Etablissement" e ON e.key = c.etablishment_id
      WHERE e.owner_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
