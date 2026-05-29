-- Autoriser booking_origin = 'establishment_manual' dans booking_inventory_allocation
-- (pour les allocations créées lors des réservations manuelles pourvoyeur)

ALTER TABLE public.booking_inventory_allocation
  DROP CONSTRAINT IF EXISTS booking_inventory_allocation_origin_check;

ALTER TABLE public.booking_inventory_allocation
  ADD CONSTRAINT booking_inventory_allocation_origin_check
  CHECK (booking_origin = ANY (
    ARRAY['platform'::text, 'guide_manual'::text, 'establishment_manual'::text]
  ));

NOTIFY pgrst, 'reload schema';
