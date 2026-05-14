-- =============================================================================
-- Migration: guide_sensitive_column_privileges
-- =============================================================================
-- Backfill : guides avec refresh token mais statut encore "never" (legacy)
UPDATE public.guide
SET
  calendar_connection_status = 'connected',
  calendar_last_validated_at = COALESCE(calendar_last_validated_at, now())
WHERE COALESCE(calendar_connection_status, 'never_connected') IN ('never_connected', '')
  AND (
    google_refresh_token IS NOT NULL
    OR (
      encrypted_refresh_token IS NOT NULL
      AND token_encryption_iv IS NOT NULL
    )
  );

-- =============================================================================
-- Problème : La politique RLS "guide: public select" expose toutes les colonnes,
--            dont google_refresh_token, encrypted_refresh_token, IV, tokens
--            QuickBooks, etc.
--
-- Solution :
--   1. REVOKE ALL sur public.guide pour anon + authenticated, puis GRANT SELECT
--      uniquement sur les colonnes non sensibles (liste dynamique).
--   2. GRANT UPDATE restreint aux champs profil modifiables depuis le client.
--   3. GRANT INSERT restreint aux colonnes nécessaires au bootstrap profil.
--   4. GRANT ALL sur public.guide pour service_role (Edge Functions + tâches admin).
--   5. Adapter get_guides_by_fish_type : ne plus lire google_refresh_token dans
--      la condition WHERE (incompatible avec le REVOKE colonnes + sécurité).
-- =============================================================================

-- ── 1) Fonction carte / filtre guides : statut calendrier, pas le token ─────
CREATE OR REPLACE FUNCTION public.get_guides_by_fish_type(
  p_fish_type TEXT DEFAULT NULL,
  p_zone_id UUID DEFAULT NULL,
  p_radius_m INTEGER DEFAULT 50000
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  email TEXT,
  fish_types TEXT[],
  location JSON,
  distance_m DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    g.id,
    g.name,
    g.email,
    g.fish_types,
    CASE WHEN g.location IS NOT NULL
      THEN ST_AsGeoJSON(g.location)::JSON
      ELSE NULL
    END AS location,
    CASE
      WHEN p_zone_id IS NOT NULL AND g.location IS NOT NULL THEN
        ST_Distance(
          g.location::geography,
          (SELECT ST_Centroid(fz.geometry)::geography FROM fishing_zones fz WHERE fz.id = p_zone_id)
        )
      ELSE NULL
    END AS distance_m
  FROM guide g
  WHERE
    g.calendar_connection_status = 'connected'
    AND (p_fish_type IS NULL OR p_fish_type = ANY(g.fish_types))
    AND (
      p_zone_id IS NULL
      OR g.location IS NULL
      OR ST_DWithin(
        g.location::geography,
        (SELECT ST_Centroid(fz.geometry)::geography FROM fishing_zones fz WHERE fz.id = p_zone_id),
        p_radius_m
      )
    )
  ORDER BY distance_m ASC NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.get_guides_by_fish_type(TEXT, UUID, INTEGER) IS
  'Liste les guides avec calendrier connecté (status=connected), sans dépendre de google_refresh_token.';

-- ── 2) Privilèges colonnes : anon / authenticated vs service_role ───────────
DO $$
DECLARE
  v_sensitive text[] := ARRAY[
    'google_refresh_token',
    'encrypted_refresh_token',
    'token_encryption_iv',
    'cached_access_token',
    'access_token_expires_at',
    'quickbooks_access_token',
    'quickbooks_refresh_token',
    'quickbooks_realm_id'
  ];
  v_safe_select text;
  v_insert_cols text;
  v_update_cols text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'guide'
  ) THEN
    RAISE NOTICE 'guide_sensitive_column_privileges: table guide absente, abandon.';
    RETURN;
  END IF;

  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
  INTO v_safe_select
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'guide'
    AND NOT (c.column_name = ANY (v_sensitive));

  IF v_safe_select IS NULL OR v_safe_select = '' THEN
    RAISE EXCEPTION 'guide_sensitive_column_privileges: aucune colonne sécurisée à exposer.';
  END IF;

  -- Droit complet pour les Edge Functions (contournent RLS mais pas les colonnes : service_role doit tout voir)
  GRANT ALL PRIVILEGES ON TABLE public.guide TO service_role;

  REVOKE ALL PRIVILEGES ON TABLE public.guide FROM anon;
  REVOKE ALL PRIVILEGES ON TABLE public.guide FROM authenticated;

  EXECUTE format(
    'GRANT SELECT (%s) ON TABLE public.guide TO anon, authenticated',
    v_safe_select
  );

  -- UPDATE : uniquement le profil éditable depuis le client React
  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.column_name)
  INTO v_update_cols
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'guide'
    AND c.column_name IN (
      'name', 'experience', 'bio', 'phone', 'email', 'fish_types',
      'hourly_rate', 'location'
    );

  IF v_update_cols IS NOT NULL AND v_update_cols <> '' THEN
    EXECUTE format(
      'GRANT UPDATE (%s) ON TABLE public.guide TO authenticated',
      v_update_cols
    );
  END IF;

  -- INSERT : bootstrap d’un profil guide (tokens / Stripe / calendrier gérés côté service_role)
  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.column_name)
  INTO v_insert_cols
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'guide'
    AND c.column_name IN (
      'id', 'user_id', 'name', 'email', 'fish_types', 'hourly_rate',
      'bio', 'experience', 'phone', 'location'
    );

  IF v_insert_cols IS NOT NULL AND v_insert_cols <> '' THEN
    EXECUTE format(
      'GRANT INSERT (%s) ON TABLE public.guide TO authenticated',
      v_insert_cols
    );
  END IF;

  GRANT DELETE ON TABLE public.guide TO authenticated;
END;
$$;

NOTIFY pgrst, 'reload schema';
