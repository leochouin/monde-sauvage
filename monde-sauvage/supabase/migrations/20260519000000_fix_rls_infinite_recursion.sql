-- =============================================================================
-- Migration : fix_rls_infinite_recursion
-- Date      : 2026-05-19
-- Erreur    : 42P17 infinite recursion detected in policy for relation "users"
-- =============================================================================
--
-- CAUSE RACINE
-- ─────────────
-- La politique "users: select own or admin" sur public.users contient :
--
--     EXISTS (SELECT 1 FROM public.users adm
--             WHERE adm.id = auth.uid() AND adm.type = 'admin')
--
-- Quand PostgreSQL évalue cette sous-requête, il déclenche la RLS de la
-- table users, ce qui ré-évalue la même politique → boucle infinie.
-- Toutes les politiques d'autres tables qui font également
-- SELECT FROM public.users héritent du même crash dès que la RLS de
-- users est activée.
--
-- SOLUTION
-- ────────
-- 1. Créer get_user_role() en SECURITY DEFINER : s'exécute sous l'identité
--    "postgres", la RLS de users n'est donc jamais déclenchée.
-- 2. Remplacer chaque EXISTS (SELECT 1 FROM users WHERE type = 'admin')
--    par public.get_user_role() = 'admin' dans TOUTES les tables affectées.
--
-- Tables corrigées :
--   public.users
--   public.guide
--   public.fishing_zones
--   public.guide_booking
--   public.guide_clients
--   public.booking_inventory_allocation
-- =============================================================================


-- =============================================================================
-- ÉTAPE 1 — Fonction SECURITY DEFINER (contournement de la RLS sur users)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT type FROM public.users WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION public.get_user_role() IS
  'Retourne users.type pour l''utilisateur courant (auth.uid()) sans déclencher la RLS '
  'de la table users. SECURITY DEFINER indispensable pour briser la récursion 42P17.';

-- Seuls les utilisateurs authentifiés peuvent appeler cette fonction.
REVOKE ALL  ON FUNCTION public.get_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;
-- service_role accède sans restriction (contourne RLS de toutes façons).


-- =============================================================================
-- ÉTAPE 2 — TABLE public.users  (politiques auto-référentielles)
-- =============================================================================

DROP POLICY IF EXISTS "users: select own or admin" ON public.users;
DROP POLICY IF EXISTS "users: delete admin only"   ON public.users;

-- SELECT : propre ligne OU rôle admin (sans boucle)
CREATE POLICY "users: select own or admin"
ON public.users
FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR public.get_user_role() = 'admin'
);

-- DELETE : admin uniquement
CREATE POLICY "users: delete admin only"
ON public.users
FOR DELETE
TO authenticated
USING (
  public.get_user_role() = 'admin'
);


-- =============================================================================
-- ÉTAPE 3 — TABLE public.guide
-- =============================================================================

DROP POLICY IF EXISTS "guide: update own or admin" ON public.guide;
DROP POLICY IF EXISTS "guide: delete admin only"   ON public.guide;

CREATE POLICY "guide: update own or admin"
ON public.guide
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  OR public.get_user_role() = 'admin'
)
WITH CHECK (
  user_id = auth.uid()
  OR public.get_user_role() = 'admin'
);

CREATE POLICY "guide: delete admin only"
ON public.guide
FOR DELETE
TO authenticated
USING (
  public.get_user_role() = 'admin'
);


-- =============================================================================
-- ÉTAPE 4 — TABLE public.fishing_zones
-- =============================================================================

DROP POLICY IF EXISTS "fishing_zones: admin insert" ON public.fishing_zones;
DROP POLICY IF EXISTS "fishing_zones: admin update" ON public.fishing_zones;
DROP POLICY IF EXISTS "fishing_zones: admin delete" ON public.fishing_zones;

CREATE POLICY "fishing_zones: admin insert"
ON public.fishing_zones
FOR INSERT
TO authenticated
WITH CHECK (
  public.get_user_role() = 'admin'
);

CREATE POLICY "fishing_zones: admin update"
ON public.fishing_zones
FOR UPDATE
TO authenticated
USING (
  public.get_user_role() = 'admin'
)
WITH CHECK (
  public.get_user_role() = 'admin'
);

CREATE POLICY "fishing_zones: admin delete"
ON public.fishing_zones
FOR DELETE
TO authenticated
USING (
  public.get_user_role() = 'admin'
);


-- =============================================================================
-- ÉTAPE 5 — TABLE public.guide_booking
-- =============================================================================

DROP POLICY IF EXISTS "guide_booking: select own (authenticated)" ON guide_booking;
DROP POLICY IF EXISTS "guide_booking: update own (authenticated)" ON guide_booking;
DROP POLICY IF EXISTS "guide_booking: delete own (authenticated)" ON guide_booking;

CREATE POLICY "guide_booking: select own (authenticated)"
ON guide_booking
FOR SELECT
TO authenticated
USING (
  guide_id IN (
    SELECT g.id FROM guide g WHERE g.user_id = auth.uid()
  )
  OR customer_email = auth.email()
  OR public.get_user_role() = 'admin'
);

CREATE POLICY "guide_booking: update own (authenticated)"
ON guide_booking
FOR UPDATE
TO authenticated
USING (
  guide_id IN (
    SELECT g.id FROM guide g WHERE g.user_id = auth.uid()
  )
  OR customer_email = auth.email()
  OR public.get_user_role() = 'admin'
)
WITH CHECK (
  guide_id IN (
    SELECT g.id FROM guide g WHERE g.user_id = auth.uid()
  )
  OR customer_email = auth.email()
  OR public.get_user_role() = 'admin'
);

CREATE POLICY "guide_booking: delete own (authenticated)"
ON guide_booking
FOR DELETE
TO authenticated
USING (
  guide_id IN (
    SELECT g.id FROM guide g WHERE g.user_id = auth.uid()
  )
  OR public.get_user_role() = 'admin'
);


-- =============================================================================
-- ÉTAPE 6 — TABLE public.guide_clients
-- =============================================================================

DROP POLICY IF EXISTS "Admins can read all guide clients"   ON guide_clients;
DROP POLICY IF EXISTS "Admins can insert guide clients"     ON guide_clients;
DROP POLICY IF EXISTS "Admins can update guide clients"     ON guide_clients;
DROP POLICY IF EXISTS "Admins can delete guide clients"     ON guide_clients;

CREATE POLICY "Admins can read all guide clients"
ON guide_clients
FOR SELECT
TO authenticated
USING (
  public.get_user_role() = 'admin'
);

CREATE POLICY "Admins can insert guide clients"
ON guide_clients
FOR INSERT
TO authenticated
WITH CHECK (
  public.get_user_role() = 'admin'
);

CREATE POLICY "Admins can update guide clients"
ON guide_clients
FOR UPDATE
TO authenticated
USING (
  public.get_user_role() = 'admin'
)
WITH CHECK (
  public.get_user_role() = 'admin'
);

CREATE POLICY "Admins can delete guide clients"
ON guide_clients
FOR DELETE
TO authenticated
USING (
  public.get_user_role() = 'admin'
);


-- =============================================================================
-- ÉTAPE 7 — TABLE public.booking_inventory_allocation
-- =============================================================================

DROP POLICY IF EXISTS bia_select_owner_or_customer ON public.booking_inventory_allocation;
DROP POLICY IF EXISTS bia_write_owner_only         ON public.booking_inventory_allocation;

CREATE POLICY bia_select_owner_or_customer
ON public.booking_inventory_allocation
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
  OR public.get_user_role() = 'admin'
);

CREATE POLICY bia_write_owner_only
ON public.booking_inventory_allocation
FOR ALL
TO authenticated
USING (
  inventory_unit_id IN (
    SELECT iu.id FROM public.inventory_unit iu
    WHERE iu.establishment_id IN (
      SELECT e.key FROM public."Etablissement" e WHERE e.owner_id = auth.uid()
    )
  )
  OR public.get_user_role() = 'admin'
)
WITH CHECK (
  inventory_unit_id IN (
    SELECT iu.id FROM public.inventory_unit iu
    WHERE iu.establishment_id IN (
      SELECT e.key FROM public."Etablissement" e WHERE e.owner_id = auth.uid()
    )
  )
  OR public.get_user_role() = 'admin'
);


-- =============================================================================
-- ÉTAPE 8 — Rafraîchissement du cache PostgREST
-- =============================================================================
NOTIFY pgrst, 'reload schema';
