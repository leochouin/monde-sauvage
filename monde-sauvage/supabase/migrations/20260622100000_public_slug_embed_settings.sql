-- =============================================================================
-- Public embed: add public_slug and embed_settings to Etablissement
-- =============================================================================
-- public_slug  → URL-friendly identifier (e.g. "pourvoirie-du-lac-castor")
--               used for /p/:slug and /widget/:slug routes
-- embed_settings → JSONB bag for future widget customisation (colors, filters…)
-- =============================================================================

ALTER TABLE "Etablissement"
  ADD COLUMN IF NOT EXISTS "public_slug"    TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS "embed_settings" JSONB NOT NULL DEFAULT '{}';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Enable RLS so we can expose selected rows to anonymous readers while keeping
-- all other rows private.  The two policies below cover every access pattern:
--   • Public visitors fetch by slug (no auth)  → "public select by slug"
--   • Owners manage their own row (auth req'd) → "owner all"
-- Edge functions use SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS entirely.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "Etablissement" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "etablissement: public select by slug" ON "Etablissement";
CREATE POLICY "etablissement: public select by slug"
ON "Etablissement"
FOR SELECT
USING (public_slug IS NOT NULL);

DROP POLICY IF EXISTS "etablissement: owner all" ON "Etablissement";
CREATE POLICY "etablissement: owner all"
ON "Etablissement"
FOR ALL
USING (auth.uid() = owner_id);

NOTIFY pgrst, 'reload schema';
