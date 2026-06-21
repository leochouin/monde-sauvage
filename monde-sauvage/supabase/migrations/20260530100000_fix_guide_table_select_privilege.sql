-- =============================================================================
-- Migration: fix_guide_table_select_privilege
-- =============================================================================
-- Problème : la migration 20260518100000_guide_sensitive_column_privileges a
--   révoqué le SELECT table-level et accordé uniquement des privilèges colonnes.
--   PostgREST exige un SELECT table-level pour traiter select=* → HTTP 403.
--
-- Solution : restaurer GRANT SELECT table-level. La sécurité ligne reste assurée
--   par les politiques RLS (migration p0_security_hardening). La protection des
--   colonnes sensibles (tokens OAuth, QB) est un objectif P1 à implémenter via
--   une vue dédiée — pas via des privilèges colonnes incompatibles avec PostgREST.
-- =============================================================================

-- Repartir d'un état propre pour anon et authenticated
REVOKE ALL PRIVILEGES ON TABLE public.guide FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.guide FROM authenticated;

-- SELECT table-level : requis pour PostgREST (select=*)
GRANT SELECT ON TABLE public.guide TO anon, authenticated;

-- UPDATE : uniquement les colonnes profil éditables depuis le client React
GRANT UPDATE (name, experience, bio, phone, email, fish_types, hourly_rate, location)
  ON TABLE public.guide TO authenticated;

-- INSERT : bootstrap d'un profil guide (tokens/Stripe gérés par service_role)
GRANT INSERT (id, user_id, name, email, fish_types, hourly_rate, bio, experience, phone, location)
  ON TABLE public.guide TO authenticated;

GRANT DELETE ON TABLE public.guide TO authenticated;

-- service_role (Edge Functions) conserve tous les droits
GRANT ALL PRIVILEGES ON TABLE public.guide TO service_role;

NOTIFY pgrst, 'reload schema';
