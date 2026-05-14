-- PostGIS types (geography, etc.) live in schema "extensions" (see postgis migration).
-- search_path = public alone breaks get_chalets_nearby body at runtime.

ALTER FUNCTION public.get_chalets_nearby(
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  INTEGER,
  INTEGER,
  TIMESTAMPTZ,
  TIMESTAMPTZ
) SECURITY DEFINER
SET search_path = public, extensions;
