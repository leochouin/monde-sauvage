-- =============================================================================
-- Étape 1 — Inventaire physique multi-agendas Google Calendar
-- =============================================================================
-- Objectif :
--   • Un type d'équipement logique par établissement (ex : « Chaloupe 16' »).
--   • Une ligne par unité physique (Chaloupe #2, Batterie #1) avec son propre
--     google_calendar_id (sous-agenda du même compte OAuth établissement).
--   • Liaison des unités réservées à la réservation principale chalet (bookings).
--
-- Disponibilité :
--   • Source de vérité transactionnelle : table booking_inventory_allocation
--     + trigger anti-chevauchement (même idée que guide_booking).
--   • Google Calendar : miroir / confort opérateur ; les Edge Functions de sync
--     créent les événements une fois l’allocation confirmée (hors scope de ce fichier).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) equipment_kind — famille / SKU logique (pour regrouper plusieurs unités physiques)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.equipment_kind (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES public."Etablissement"(key) ON DELETE CASCADE,
  slug text NOT NULL,
  label text NOT NULL,
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipment_kind_establishment_slug_unique UNIQUE (establishment_id, slug)
);

COMMENT ON TABLE public.equipment_kind IS
  'Famille d''équipements (ex. Chaloupe, Batterie électrique). Plusieurs inventory_unit partagent un kind.';
COMMENT ON COLUMN public.equipment_kind.slug IS
  'Identifiant stable côté API (ex. chaloupe_16ft).';
COMMENT ON COLUMN public.equipment_kind.metadata IS
  'Tarification, règles d''âge, durée min, etc. — peut évoluer avant table pricing dédiée.';

CREATE INDEX IF NOT EXISTS idx_equipment_kind_establishment
  ON public.equipment_kind (establishment_id);

-- -----------------------------------------------------------------------------
-- 2) inventory_unit — une unité physique = un sous-agenda Google
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_unit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id uuid NOT NULL REFERENCES public."Etablissement"(key) ON DELETE CASCADE,
  equipment_kind_id uuid NOT NULL REFERENCES public.equipment_kind (id) ON DELETE CASCADE,
  -- Optionnel : rattachement à un chalet précis (bateau au quai du chalet X). NULL = pool pourvoirie.
  chalet_id uuid REFERENCES public.chalets (key) ON DELETE SET NULL,
  unit_code text NOT NULL,
  display_name text NOT NULL,
  -- ID de l’agenda Google (souvent forme xxx@group.calendar.google.com ou ID resource).
  google_calendar_id text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_unit_establishment_code_unique UNIQUE (establishment_id, unit_code)
);

COMMENT ON TABLE public.inventory_unit IS
  'Unité physique unique ; un sous-agenda Google dédié (google_calendar_id) sous le compte OAuth de l''établissement.';
COMMENT ON COLUMN public.inventory_unit.google_calendar_id IS
  'calendarId Google de cette unité ; créé via Calendar API après connexion OAuth de l''établissement.';
COMMENT ON COLUMN public.inventory_unit.unit_code IS
  'Code interne stable (ex. BOAT-02, BAT-01) pour logs et supports.';

CREATE INDEX IF NOT EXISTS idx_inventory_unit_establishment
  ON public.inventory_unit (establishment_id);
CREATE INDEX IF NOT EXISTS idx_inventory_unit_kind
  ON public.inventory_unit (equipment_kind_id);
CREATE INDEX IF NOT EXISTS idx_inventory_unit_calendar
  ON public.inventory_unit (google_calendar_id)
  WHERE google_calendar_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_unit_active_kind
  ON public.inventory_unit (equipment_kind_id, is_active);

-- -----------------------------------------------------------------------------
-- 3) booking_inventory_allocation — lien N unités ↔ 1 réservation chalet
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_inventory_allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chalet_booking_id bigint NOT NULL REFERENCES public.bookings (id) ON DELETE CASCADE,
  inventory_unit_id uuid NOT NULL REFERENCES public.inventory_unit (id) ON DELETE RESTRICT,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  payment_status text,
  google_event_id text,
  stripe_payment_intent_id text,
  booking_origin text NOT NULL DEFAULT 'platform',
  platform_fee_amount numeric(10, 2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_inventory_allocation_time_check CHECK (end_at > start_at),
  CONSTRAINT booking_inventory_allocation_status_check CHECK (
    status = ANY (
      ARRAY['pending'::text, 'pending_payment'::text, 'confirmed'::text, 'cancelled'::text, 'blocked'::text]
    )
  ),
  CONSTRAINT booking_inventory_allocation_origin_check CHECK (
    booking_origin = ANY (ARRAY['platform'::text, 'guide_manual'::text])
  )
);

COMMENT ON TABLE public.booking_inventory_allocation IS
  'Association d''une unité physique à une réservation principale bookings ; une ligne = une unité (demander 2 chaloupes ⇒ 2 lignes).';
COMMENT ON COLUMN public.booking_inventory_allocation.google_event_id IS
  'ID événement sur le calendrier de CETTE inventory_unit.';
COMMENT ON COLUMN public.booking_inventory_allocation.status IS
  'pending = hold pré-paiement ; confirmed après webhook Stripe ; cancelled / blocked autres cas.';

CREATE INDEX IF NOT EXISTS idx_bia_chalet_booking
  ON public.booking_inventory_allocation (chalet_booking_id);
CREATE INDEX IF NOT EXISTS idx_bia_inventory_unit
  ON public.booking_inventory_allocation (inventory_unit_id);
CREATE INDEX IF NOT EXISTS idx_bia_active_overlap
  ON public.booking_inventory_allocation (inventory_unit_id, start_at, end_at)
  WHERE status = ANY (ARRAY['pending'::text, 'pending_payment'::text, 'confirmed'::text, 'blocked'::text]);

-- -----------------------------------------------------------------------------
-- 4) Cohérence établissement
-- -----------------------------------------------------------------------------
-- 4a) inventory_unit : si chalet_id non NULL, il doit appartenir au même établissement
CREATE OR REPLACE FUNCTION public.enforce_inventory_unit_chalet_establishment_match()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  est_chalet uuid;
BEGIN
  IF NEW.chalet_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.etablishment_id
    INTO est_chalet
  FROM public.chalets c
  WHERE c.key = NEW.chalet_id;

  IF est_chalet IS NULL THEN
    RAISE EXCEPTION 'inventory_unit: chalet_id invalide';
  END IF;
  IF est_chalet <> NEW.establishment_id THEN
    RAISE EXCEPTION 'inventory_unit: chalet et unité doivent partager le même établissement';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_unit_chalet_establishment_match ON public.inventory_unit;
CREATE TRIGGER trg_inventory_unit_chalet_establishment_match
  BEFORE INSERT OR UPDATE OF chalet_id, establishment_id
  ON public.inventory_unit
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_inventory_unit_chalet_establishment_match();

-- 4b) allocations : unité et booking doivent partager le même établissement
CREATE OR REPLACE FUNCTION public.enforce_allocation_establishment_match()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bid uuid := NEW.inventory_unit_id;
  est_unit uuid;
  est_booking uuid;
BEGIN
  SELECT iu.establishment_id INTO est_unit FROM public.inventory_unit iu WHERE iu.id = bid;
  SELECT c.etablishment_id INTO est_booking
  FROM public.bookings b
  JOIN public.chalets c ON c.key = b.chalet_id
  WHERE b.id = NEW.chalet_booking_id;

  IF est_unit IS NULL THEN
    RAISE EXCEPTION 'inventory_unit introuvable';
  END IF;
  IF est_booking IS NULL THEN
    RAISE EXCEPTION 'booking ou chalet introuvable pour cohérence établissement';
  END IF;
  IF est_unit <> est_booking THEN
    RAISE EXCEPTION 'allocation_cross_establishment: unité et réservation doivent être du même établissement';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bia_establishment_match ON public.booking_inventory_allocation;
CREATE TRIGGER trg_bia_establishment_match
  BEFORE INSERT OR UPDATE OF chalet_booking_id, inventory_unit_id
  ON public.booking_inventory_allocation
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_allocation_establishment_match();

-- -----------------------------------------------------------------------------
-- 5) Anti-chevauchement par unité (serials les transactions sur la même unité)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_inventory_allocation_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_conflict_count integer;
  v_active_statuses text[] := ARRAY['pending', 'pending_payment', 'confirmed', 'blocked'];
BEGIN
  IF NOT (NEW.status = ANY (v_active_statuses)) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('inventory_allocation_' || NEW.inventory_unit_id::text)
  );

  SELECT count(*) INTO v_conflict_count
  FROM public.booking_inventory_allocation a
  WHERE a.inventory_unit_id = NEW.inventory_unit_id
    AND a.id IS DISTINCT FROM COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND a.status = ANY (v_active_statuses)
    AND a.start_at < NEW.end_at
    AND a.end_at > NEW.start_at;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'inventory_allocation_no_overlap: cette unité est déjà réservée sur ce créneau.'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_inventory_allocation_overlap ON public.booking_inventory_allocation;
CREATE TRIGGER trg_prevent_inventory_allocation_overlap
  BEFORE INSERT OR UPDATE OF inventory_unit_id, start_at, end_at, status
  ON public.booking_inventory_allocation
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_inventory_allocation_overlap();

COMMENT ON FUNCTION public.prevent_inventory_allocation_overlap() IS
  'Verrou advisory par inventory_unit_id + contrôle de chevauchement (statuts actifs).';

-- -----------------------------------------------------------------------------
-- 6) updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.inventory_entities_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_equipment_kind_updated ON public.equipment_kind;
CREATE TRIGGER trg_equipment_kind_updated
  BEFORE UPDATE ON public.equipment_kind
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_entities_touch_updated_at();

DROP TRIGGER IF EXISTS trg_inventory_unit_updated ON public.inventory_unit;
CREATE TRIGGER trg_inventory_unit_updated
  BEFORE UPDATE ON public.inventory_unit
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_entities_touch_updated_at();

DROP TRIGGER IF EXISTS trg_bia_updated ON public.booking_inventory_allocation;
CREATE TRIGGER trg_bia_updated
  BEFORE UPDATE ON public.booking_inventory_allocation
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_entities_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 7) RLS — propriétaires d''établissement + lecture client alignée email (base)
-- -----------------------------------------------------------------------------
ALTER TABLE public.equipment_kind ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_inventory_allocation ENABLE ROW LEVEL SECURITY;

-- Equipment kind
DROP POLICY IF EXISTS equipment_kind_owner_all ON public.equipment_kind;
CREATE POLICY equipment_kind_owner_all ON public.equipment_kind
  FOR ALL
  TO authenticated
  USING (
    establishment_id IN (
      SELECT e.key FROM public."Etablissement" e WHERE e.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    establishment_id IN (
      SELECT e.key FROM public."Etablissement" e WHERE e.owner_id = auth.uid()
    )
  );

-- Inventory unit
DROP POLICY IF EXISTS inventory_unit_owner_all ON public.inventory_unit;
CREATE POLICY inventory_unit_owner_all ON public.inventory_unit
  FOR ALL
  TO authenticated
  USING (
    establishment_id IN (
      SELECT e.key FROM public."Etablissement" e WHERE e.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    establishment_id IN (
      SELECT e.key FROM public."Etablissement" e WHERE e.owner_id = auth.uid()
    )
  );

-- Allocations : owner établissement via unité OU client via réservation principale
DROP POLICY IF EXISTS bia_select_owner_or_customer ON public.booking_inventory_allocation;
CREATE POLICY bia_select_owner_or_customer ON public.booking_inventory_allocation
  FOR SELECT
  TO authenticated
  USING (
    inventory_unit_id IN (
      SELECT iu.id FROM public.inventory_unit iu
      WHERE iu.establishment_id IN (
        SELECT e.key FROM public."Etablissement" e WHERE e.owner_id = auth.uid()
      )
    )
    OR chalet_booking_id IN (
      SELECT b.id FROM public.bookings b WHERE b.customer_email = auth.email()
    )
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.type = 'admin')
  );

DROP POLICY IF EXISTS bia_write_owner_only ON public.booking_inventory_allocation;
CREATE POLICY bia_write_owner_only ON public.booking_inventory_allocation
  FOR ALL
  TO authenticated
  USING (
    inventory_unit_id IN (
      SELECT iu.id FROM public.inventory_unit iu
      WHERE iu.establishment_id IN (
        SELECT e.key FROM public."Etablissement" e WHERE e.owner_id = auth.uid()
      )
    )
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.type = 'admin')
  )
  WITH CHECK (
    inventory_unit_id IN (
      SELECT iu.id FROM public.inventory_unit iu
      WHERE iu.establishment_id IN (
        SELECT e.key FROM public."Etablissement" e WHERE e.owner_id = auth.uid()
      )
    )
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.type = 'admin')
  );

-- Important : inserts checkout invité / Edge Functions utilisent SERVICE ROLE
-- qui bypass RLS. Pour un insert client authentifié direct PostgREST, ajouter
-- ultérieurement une policy INSERT ciblée (comme pour guide_booking).
