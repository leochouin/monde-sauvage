-- =============================================================================
-- Migration: fix_rls_security
-- Date: 2026-05-06
-- =============================================================================
-- Correctifs de sécurité :
--
--   CRIT-01 — Les utilisateurs anon avaient UPDATE/DELETE sans restriction sur
--             guide_booking (n'importe qui pouvait annuler la réservation payée
--             d'un autre utilisateur en connaissant uniquement son UUID).
--
--   CRIT-03 — Les politiques authenticated sur guide_booking utilisaient
--             USING(true) : tout utilisateur authentifié pouvait lire, modifier
--             ou supprimer les réservations de n'importe quel guide.
--
--   Bonus   — Suppression des politiques anon CRUD sur guide_clients
--             (aucun cas d'usage légitime ; exposait le carnet de clients
--             complet à des utilisateurs non authentifiés).
--
-- Ce que cette migration NE change PAS (intentionnel) :
--   - La politique anon INSERT sur guide_booking : nécessaire pour le
--     guest checkout (flux Stripe sans compte).
--   - La politique anon SELECT sur guide_booking : nécessaire comme fallback
--     côté client pour la vérification de disponibilité.
--     TODO : une fois que TOUS les appels de disponibilité passent par
--     check-guide-conflicts (service role), supprimer cette politique.
--   - Les politiques authenticated sur guide_clients (déjà correctement
--     scopées par guide.user_id = auth.uid()).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1 — guide_booking : supprimer les politiques trop permissives
-- ─────────────────────────────────────────────────────────────────────────────

-- Politiques anon dangereuses (CRIT-01)
DROP POLICY IF EXISTS "Allow anon users to update guide bookings" ON guide_booking;
DROP POLICY IF EXISTS "Allow anon users to delete guide bookings"  ON guide_booking;

-- Politiques authenticated sans scope de propriété (CRIT-03)
DROP POLICY IF EXISTS "Allow authenticated users to read guide bookings"   ON guide_booking;
DROP POLICY IF EXISTS "Allow authenticated users to insert guide bookings"  ON guide_booking;
DROP POLICY IF EXISTS "Allow authenticated users to update guide bookings"  ON guide_booking;
DROP POLICY IF EXISTS "Allow authenticated users to delete guide bookings"  ON guide_booking;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2 — guide_booking : créer des politiques correctement scopées
-- ─────────────────────────────────────────────────────────────────────────────

-- ── SELECT authenticated ──────────────────────────────────────────────────
-- Un utilisateur authentifié peut lire une réservation si :
--   (a) il est le guide propriétaire du booking (guide.user_id = auth.uid())
--   (b) il est le client (customer_email = auth.email())
--   (c) il est admin
CREATE POLICY "guide_booking: select own (authenticated)"
ON guide_booking
FOR SELECT
TO authenticated
USING (
  guide_id IN (
    SELECT g.id FROM guide g WHERE g.user_id = auth.uid()
  )
  OR customer_email = auth.email()
  OR EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.type = 'admin'
  )
);

-- ── INSERT authenticated ──────────────────────────────────────────────────
-- Deux cas légitimes :
--   (a) Le guide crée un booking manuel pour son propre guide.
--   (b) Un client authentifié réserve un guide (flux sans Stripe).
-- On autorise tout utilisateur authentifié à insérer (compte vérifié = niveau
-- de confiance minimum). Le trigger DB prévient les doubles-bookings.
-- L'Edge Function stripe-create-booking (service role) est le chemin
-- privilégié ; cette politique couvre le flux legacy non-payant.
CREATE POLICY "guide_booking: insert (authenticated)"
ON guide_booking
FOR INSERT
TO authenticated
WITH CHECK (true);

-- ── UPDATE authenticated ──────────────────────────────────────────────────
-- Un utilisateur authentifié peut modifier une réservation si :
--   (a) il est le guide propriétaire
--   (b) il est le client (email match) — annulation depuis le panier
--   (c) il est admin
CREATE POLICY "guide_booking: update own (authenticated)"
ON guide_booking
FOR UPDATE
TO authenticated
USING (
  guide_id IN (
    SELECT g.id FROM guide g WHERE g.user_id = auth.uid()
  )
  OR customer_email = auth.email()
  OR EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.type = 'admin'
  )
)
WITH CHECK (
  guide_id IN (
    SELECT g.id FROM guide g WHERE g.user_id = auth.uid()
  )
  OR customer_email = auth.email()
  OR EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.type = 'admin'
  )
);

-- ── DELETE authenticated ──────────────────────────────────────────────────
-- Seuls le guide propriétaire et les admins peuvent supprimer.
CREATE POLICY "guide_booking: delete own (authenticated)"
ON guide_booking
FOR DELETE
TO authenticated
USING (
  guide_id IN (
    SELECT g.id FROM guide g WHERE g.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.type = 'admin'
  )
);

-- ── UPDATE anon — annulation uniquement (remplacement de CRIT-01) ─────────
-- Remplace la politique "USING(true)/WITH CHECK(true)" qui permettait
-- à n'importe quel anon de modifier N'IMPORTE quel champ de N'IMPORTE
-- quelle réservation.
--
-- Nouvelle logique :
--   USING    : cible uniquement les réservations non-payées et en attente
--              (un anon ne peut jamais toucher une réservation confirmée/payée)
--   WITH CHECK : la seule valeur de status autorisée après UPDATE est 'cancelled'
--              (empêche : escalade de statut, modification du montant,
--               détournement d'email, passage de is_paid à true)
--
-- Limitation résiduelle connue : tout anon qui connaît un UUID peut annuler
-- le booking non-payé correspondant. Les UUIDs étant des valeurs 128 bits
-- aléatoires non-devinables, le risque résiduel est accepté pour maintenir
-- la fonctionnalité cancelPendingBooking sans refactorisation.
-- La correction complète nécessite de déplacer cette logique vers une
-- Edge Function avec token signé (hors scope de ce correctif).
CREATE POLICY "guide_booking: anon cancel unpaid only"
ON guide_booking
FOR UPDATE
TO anon
USING (
  is_paid       = false
  AND status    IN ('pending', 'pending_payment')
  AND deleted_at IS NULL
)
WITH CHECK (
  status = 'cancelled'
);

-- Aucune politique DELETE pour anon — aucun cas d'usage légitime.
-- Les politiques anon INSERT et SELECT sont conservées (définies dans les
-- migrations antérieures et intentionnellement non modifiées ici).


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3 — guide_clients : supprimer l'accès anon total
-- ─────────────────────────────────────────────────────────────────────────────
-- Ces quatre politiques ont été créées dans
-- 20260210000000_create_guide_clients_table.sql.
-- Elles accordaient SELECT/INSERT/UPDATE/DELETE à tout utilisateur
-- non-authentifié, exposant le carnet de clients complet de tous les guides.
-- Aucun flux applicatif légitime ne requiert un accès anon à guide_clients.

DROP POLICY IF EXISTS "Allow anon read for guide clients"   ON guide_clients;
DROP POLICY IF EXISTS "Allow anon insert for guide clients" ON guide_clients;
DROP POLICY IF EXISTS "Allow anon update for guide clients" ON guide_clients;
DROP POLICY IF EXISTS "Allow anon delete for guide clients" ON guide_clients;

-- Les politiques authenticated existantes sur guide_clients sont correctes
-- et ne sont pas modifiées :
--   "Guides can read their own clients"     — scopée par guide.user_id = auth.uid()
--   "Guides can insert their own clients"   — idem
--   "Guides can update their own clients"   — idem
--   "Guides can delete their own clients"   — idem
--   "Admins can read all guide clients"     — vérification users.type = 'admin'
--   "Admins can insert guide clients"       — idem
--   "Admins can update guide clients"       — idem
--   "Admins can delete guide clients"       — idem


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4 — Rafraîchissement du cache PostgREST
-- ─────────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
