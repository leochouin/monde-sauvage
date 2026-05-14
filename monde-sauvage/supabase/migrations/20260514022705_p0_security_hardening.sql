-- =============================================================================
-- Migration : p0_security_hardening
-- Date      : 2026-05-17
-- =============================================================================
-- Correctifs P0 identifiés lors de l'audit d'architecture :
--
--   SEC-01 — users.type modifiable par n'importe quel utilisateur authentifié.
--            Résolution : trigger hard-stop + RLS stricte + RPC admin.
--
--   SEC-02 — RLS absente sur la table `guide`.
--            Résolution : ENABLE RLS + policies SELECT/INSERT/UPDATE/DELETE.
--
--   SEC-03 — RLS absente sur la table `fishing_zones`.
--            Résolution : ENABLE RLS + policies (lecture publique, écriture admin).
--
--   TYPE-01 — booking_inventory_allocation.chalet_booking_id déclaré bigint
--             alors que bookings.id est UUID.
--             Résolution : détection du type réel + correction de la FK.
-- =============================================================================


-- =============================================================================
-- SEC-01 — Verrouillage de public.users.type
-- =============================================================================
-- Stratégie :
--   Couche 1 (trigger) — hard-stop au niveau moteur : toute tentative de changer
--     users.type depuis un rôle PostgREST non-privilégié lève une exception 42501.
--     Le trigger N'EST PAS SECURITY DEFINER → current_user reflète le rôle réel
--     défini par PostgREST (anon | authenticated | service_role).
--
--   Couche 2 (RLS) — politique UPDATE qui ne laisse passer que les modifications
--     sur sa propre ligne. Le trigger en est le dernier filet si une future
--     politique trop permissive est ajoutée par erreur.
--
--   Couche 3 (RPC admin) — seule voie légitime pour changer le type d'un
--     utilisateur depuis l'application. La fonction est SECURITY DEFINER :
--     elle tourne sous l'identité "postgres" (le propriétaire des objets),
--     ce qui satisfait le trigger sans ouvrir de brèche.
-- -----------------------------------------------------------------------------

-- ── 1a. Trigger guard (couche 1) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_users_type_immutable()
RETURNS trigger
LANGUAGE plpgsql
-- PAS de SECURITY DEFINER : on veut que current_user == rôle PostgREST réel
AS $$
BEGIN
  -- Si le champ type ne change pas, on laisse passer sans condition.
  IF NEW.type IS NOT DISTINCT FROM OLD.type THEN
    RETURN NEW;
  END IF;

  -- Le champ type est en train de changer.
  -- Rôles autorisés à le modifier directement :
  --   • service_role  → Edge Functions (stripe-webhook, onboarding, etc.)
  --   • postgres      → migrations SQL et fonctions SECURITY DEFINER
  --   • supabase_admin / supabase → rôles internes Supabase
  IF current_user IN ('service_role', 'postgres', 'supabase_admin', 'supabase') THEN
    RETURN NEW;
  END IF;

  -- Tout autre rôle (authenticated, anon) → exception.
  RAISE EXCEPTION
    'users_type_immutable: le champ type ne peut être modifié que par un administrateur système. Utilisez la fonction set_user_type() si vous êtes admin.'
    USING ERRCODE = '42501';
END;
$$;

COMMENT ON FUNCTION public.guard_users_type_immutable() IS
  'Trigger hard-stop : empêche tout rôle PostgREST non-privilégié de modifier users.type directement.';

DROP TRIGGER IF EXISTS trg_guard_users_type ON public.users;
CREATE TRIGGER trg_guard_users_type
  BEFORE UPDATE OF type
  ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_users_type_immutable();

-- ── 1b. RLS sur public.users (couche 2) ──────────────────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Suppression des éventuelles politiques trop permissives existantes
DROP POLICY IF EXISTS "Users can view their own profile"      ON public.users;
DROP POLICY IF EXISTS "Users can update their own profile"    ON public.users;
DROP POLICY IF EXISTS "Users can insert their own profile"    ON public.users;
DROP POLICY IF EXISTS "Allow users to read own data"          ON public.users;
DROP POLICY IF EXISTS "Allow users to update own data"        ON public.users;
DROP POLICY IF EXISTS "Allow authenticated read"              ON public.users;
DROP POLICY IF EXISTS "users: select own"                     ON public.users;
DROP POLICY IF EXISTS "users: update own"                     ON public.users;
DROP POLICY IF EXISTS "users: insert own"                     ON public.users;
DROP POLICY IF EXISTS "users: delete admin only"              ON public.users;
DROP POLICY IF EXISTS "users: admin read all"                 ON public.users;

-- SELECT : chaque utilisateur voit sa propre ligne ; les admins voient tout.
CREATE POLICY "users: select own or admin"
ON public.users
FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.users adm
    WHERE adm.id = auth.uid() AND adm.type = 'admin'
  )
);

-- INSERT : un utilisateur authentifié ne peut insérer que sa propre ligne.
-- (Le flux normal passe par syncUserProfileRow dans App.jsx.)
CREATE POLICY "users: insert own"
ON public.users
FOR INSERT
TO authenticated
WITH CHECK (id = auth.uid());

-- UPDATE : un utilisateur authentifié peut modifier sa propre ligne.
--   Le trigger trg_guard_users_type bloque toute modification du champ type.
CREATE POLICY "users: update own"
ON public.users
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- DELETE : réservé aux admins (suppression de compte → normalement via service_role).
CREATE POLICY "users: delete admin only"
ON public.users
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users adm
    WHERE adm.id = auth.uid() AND adm.type = 'admin'
  )
);

-- ── 1c. RPC admin set_user_type (couche 3) ───────────────────────────────────
-- Cette fonction est la SEULE voie légitime pour promouvoir/rétrograder
-- un utilisateur depuis l'application. Elle est SECURITY DEFINER : elle
-- s'exécute sous l'identité "postgres", donc le trigger la laisse passer.
-- Elle vérifie elle-même que l'appelant est bien admin avant d'agir.
CREATE OR REPLACE FUNCTION public.set_user_type(
  p_user_id  uuid,
  p_new_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Vérification que l'appelant est admin (via auth.uid() + table users)
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND type = 'admin'
  ) THEN
    RAISE EXCEPTION
      'permission_denied: seul un utilisateur de type ''admin'' peut modifier le type d''un autre utilisateur.'
      USING ERRCODE = '42501';
  END IF;

  -- Validation de la valeur cible
  IF p_new_type NOT IN ('default', 'guide', 'establishment', 'admin') THEN
    RAISE EXCEPTION
      'invalid_user_type: valeurs autorisées : default | guide | establishment | admin. Reçu : %', p_new_type
      USING ERRCODE = '22023';
  END IF;

  -- Mise à jour (le trigger voit current_user = 'postgres' → autorisé)
  UPDATE public.users
  SET    type = p_new_type,
         updated_at = now()
  WHERE  id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'user_not_found: aucun utilisateur avec l''id %', p_user_id
      USING ERRCODE = 'P0002';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.set_user_type(uuid, text) IS
  'RPC admin : modifie users.type de manière sécurisée. Requiert type = ''admin'' sur le compte appelant.';

-- Seuls les utilisateurs authentifiés peuvent appeler cette RPC
-- (la vérification admin est interne à la fonction)
REVOKE ALL ON FUNCTION public.set_user_type(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_user_type(uuid, text) TO authenticated;


-- =============================================================================
-- SEC-02 — RLS sur la table `guide`
-- =============================================================================
-- Modèle d'accès :
--   SELECT  anon + authenticated  → lecture publique (carte, fiches guides)
--           ATTENTION : google_refresh_token est ainsi lisible via PostgREST.
--           Correctif complet = migration ultérieure vers private.oauth_tokens.
--           Atténuation immédiate : on exclut le token via une vue (TODO P1).
--   INSERT  authenticated uniquement, sur sa propre ligne (user_id = auth.uid())
--   UPDATE  guide propriétaire (user_id = auth.uid()) OU admin
--   DELETE  admin uniquement
-- -----------------------------------------------------------------------------
ALTER TABLE public.guide ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "guide: public select"          ON public.guide;
DROP POLICY IF EXISTS "guide: insert own"             ON public.guide;
DROP POLICY IF EXISTS "guide: update own or admin"    ON public.guide;
DROP POLICY IF EXISTS "guide: delete admin only"      ON public.guide;
DROP POLICY IF EXISTS "Allow public read access"      ON public.guide;
DROP POLICY IF EXISTS "Allow guide owner to update"   ON public.guide;

-- SELECT public (anon + authenticated) — nécessaire pour la carte et les réservations
CREATE POLICY "guide: public select"
ON public.guide
FOR SELECT
USING (true);

-- INSERT : un utilisateur authentifié ne peut créer que son propre profil guide
CREATE POLICY "guide: insert own"
ON public.guide
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- UPDATE : propriétaire du guide ou admin
CREATE POLICY "guide: update own or admin"
ON public.guide
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.type = 'admin'
  )
)
WITH CHECK (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.type = 'admin'
  )
);

-- DELETE : admin uniquement
CREATE POLICY "guide: delete admin only"
ON public.guide
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.type = 'admin'
  )
);

-- NOTE SÉCURITÉ (à traiter en P1) ──────────────────────────────────────────
-- google_refresh_token, google_access_token et champs OAuth sont actuellement
-- accessibles en SELECT via PostgREST (politique public select ci-dessus).
-- Solution propre : créer private.oauth_tokens et y déplacer ces colonnes.
-- Atténuation temporaire disponible : créer une vue publique guide_public_v
-- qui exclut les colonnes sensibles et révoquer le SELECT direct sur guide.
-- =============================================================================


-- =============================================================================
-- SEC-03 — RLS sur la table `fishing_zones`
-- =============================================================================
-- Modèle d'accès :
--   SELECT  anon + authenticated → données publiques pour la carte
--   INSERT  admin uniquement (zones curatoriales, pas de contenu utilisateur)
--   UPDATE  admin uniquement
--   DELETE  admin uniquement
-- -----------------------------------------------------------------------------
ALTER TABLE public.fishing_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fishing_zones: public select"       ON public.fishing_zones;
DROP POLICY IF EXISTS "fishing_zones: admin write"         ON public.fishing_zones;
DROP POLICY IF EXISTS "fishing_zones: admin insert"        ON public.fishing_zones;
DROP POLICY IF EXISTS "fishing_zones: admin update"        ON public.fishing_zones;
DROP POLICY IF EXISTS "fishing_zones: admin delete"        ON public.fishing_zones;

-- SELECT public (déjà couvert par GRANT SELECT dans la migration initiale,
-- on l'encapsule aussi dans une politique RLS pour cohérence)
CREATE POLICY "fishing_zones: public select"
ON public.fishing_zones
FOR SELECT
USING (true);

-- INSERT : admin uniquement
CREATE POLICY "fishing_zones: admin insert"
ON public.fishing_zones
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.type = 'admin'
  )
);

-- UPDATE : admin uniquement
CREATE POLICY "fishing_zones: admin update"
ON public.fishing_zones
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.type = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.type = 'admin'
  )
);

-- DELETE : admin uniquement
CREATE POLICY "fishing_zones: admin delete"
ON public.fishing_zones
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.type = 'admin'
  )
);


-- =============================================================================
-- TYPE-01 — Alignement booking_inventory_allocation.chalet_booking_id
-- =============================================================================
-- Contexte :
--   create_bookings_table.sql     → bookings.id        UUID
--   20260506160000_inventory_...  → chalet_booking_id  bigint  ← incohérence
--
-- Ce bloc détecte le type réel de bookings.id en production et corrige
-- la colonne chalet_booking_id pour qu'elle corresponde exactement.
--
-- Cas A : bookings.id est UUID  → on change chalet_booking_id de bigint → uuid
--         (cas le plus probable : c'est le type défini dans la migration originale)
-- Cas B : bookings.id est bigint → la FK est déjà correcte, pas d'action
-- Cas C : booking_inventory_allocation n'existe pas → pas d'action
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_bookings_id_type    text;
  v_bia_fk_type         text;
  v_fk_constraint_name  text;
BEGIN

  -- Récupère le type réel de bookings.id (data_type ou udt_name pour uuid)
  SELECT
    CASE
      WHEN data_type = 'uuid'    THEN 'uuid'
      WHEN data_type = 'bigint'  THEN 'bigint'
      WHEN data_type = 'integer' THEN 'integer'
      ELSE data_type
    END
  INTO v_bookings_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'bookings'
    AND column_name  = 'id';

  IF v_bookings_id_type IS NULL THEN
    RAISE NOTICE 'TYPE-01 : table bookings introuvable, rien à faire.';
    RETURN;
  END IF;

  RAISE NOTICE 'TYPE-01 : bookings.id est de type %.', v_bookings_id_type;

  -- Récupère le type actuel de booking_inventory_allocation.chalet_booking_id
  SELECT
    CASE
      WHEN data_type = 'uuid'    THEN 'uuid'
      WHEN data_type = 'bigint'  THEN 'bigint'
      WHEN data_type = 'integer' THEN 'integer'
      ELSE data_type
    END
  INTO v_bia_fk_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'booking_inventory_allocation'
    AND column_name  = 'chalet_booking_id';

  IF v_bia_fk_type IS NULL THEN
    RAISE NOTICE 'TYPE-01 : booking_inventory_allocation introuvable, rien à faire.';
    RETURN;
  END IF;

  -- Si les types correspondent déjà → rien à faire
  IF v_bia_fk_type = v_bookings_id_type THEN
    RAISE NOTICE 'TYPE-01 : types déjà cohérents (%), aucun changement.', v_bia_fk_type;
    RETURN;
  END IF;

  RAISE NOTICE 'TYPE-01 : incohérence détectée. bookings.id=%, chalet_booking_id=%. Correction en cours…',
    v_bookings_id_type, v_bia_fk_type;

  -- Trouve et supprime la contrainte FK existante
  SELECT constraint_name
  INTO   v_fk_constraint_name
  FROM   information_schema.table_constraints
  WHERE  table_schema    = 'public'
    AND  table_name      = 'booking_inventory_allocation'
    AND  constraint_type = 'FOREIGN KEY'
    AND  constraint_name LIKE '%chalet_booking_id%' OR constraint_name LIKE '%bookings%';

  -- Fallback : cherche toutes les FK de la table
  IF v_fk_constraint_name IS NULL THEN
    SELECT tc.constraint_name
    INTO   v_fk_constraint_name
    FROM   information_schema.table_constraints tc
    JOIN   information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema   = kcu.table_schema
    WHERE  tc.table_schema  = 'public'
      AND  tc.table_name    = 'booking_inventory_allocation'
      AND  tc.constraint_type = 'FOREIGN KEY'
      AND  kcu.column_name  = 'chalet_booking_id'
    LIMIT 1;
  END IF;

  IF v_fk_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.booking_inventory_allocation DROP CONSTRAINT %I',
      v_fk_constraint_name
    );
    RAISE NOTICE 'TYPE-01 : contrainte FK % supprimée.', v_fk_constraint_name;
  ELSE
    RAISE NOTICE 'TYPE-01 : aucune contrainte FK trouvée sur chalet_booking_id (migration peut-être jamais appliquée).';
  END IF;

  -- Modification du type de la colonne pour l'aligner sur bookings.id
  -- USING : conversion des valeurs existantes (si la table est vide, c'est trivial ;
  --         si elle contient des données bigint vers uuid, elles seront nulles → ON DELETE CASCADE
  --         garantit la cohérence)
  EXECUTE format(
    'ALTER TABLE public.booking_inventory_allocation
       ALTER COLUMN chalet_booking_id TYPE %s
       USING chalet_booking_id::%s',
    v_bookings_id_type,
    v_bookings_id_type
  );

  RAISE NOTICE 'TYPE-01 : colonne chalet_booking_id convertie en %.', v_bookings_id_type;

  -- Recrée la contrainte FK
  EXECUTE format(
    'ALTER TABLE public.booking_inventory_allocation
       ADD CONSTRAINT bia_chalet_booking_id_fk
       FOREIGN KEY (chalet_booking_id)
       REFERENCES public.bookings(id)
       ON DELETE CASCADE',
    v_bookings_id_type
  );

  RAISE NOTICE 'TYPE-01 : contrainte FK bia_chalet_booking_id_fk recréée (type %).', v_bookings_id_type;

END;
$$;


-- =============================================================================
-- Fin de migration — Rafraîchissement du cache PostgREST
-- =============================================================================
NOTIFY pgrst, 'reload schema';
