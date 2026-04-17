-- Add chalet_lng / chalet_lat to get_chalets_nearby so the map can place markers.
-- These are extracted from the existing PostGIS location column; no data-model change.

DROP FUNCTION IF EXISTS public.get_chalets_nearby(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.get_chalets_nearby(
  lng DOUBLE PRECISION,
  lat DOUBLE PRECISION,
  radius_m INTEGER,
  min_capacity INTEGER DEFAULT NULL,
  check_start_date TIMESTAMPTZ DEFAULT NULL,
  check_end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  key UUID,
  "Name" TEXT,
  "Description" TEXT,
  "Image" TEXT,
  nb_personnes INTEGER,
  price_per_night NUMERIC,
  distance_m DOUBLE PRECISION,
  google_calendar TEXT,
  etablishment_id UUID,
  etablishment_name TEXT,
  chalet_lng DOUBLE PRECISION,
  chalet_lat DOUBLE PRECISION
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.key::UUID,
    c."Name"::TEXT,
    c."Description"::TEXT,
    c."Image"::TEXT,
    c.nb_personnes::INTEGER,
    c.price_per_night::NUMERIC,
    ST_Distance(
      c.location::geography,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
    )::DOUBLE PRECISION AS distance_m,
    c.google_calendar::TEXT,
    c.etablishment_id::UUID,
    e."Name"::TEXT AS etablishment_name,
    ST_X(c.location::geometry)::DOUBLE PRECISION AS chalet_lng,
    ST_Y(c.location::geometry)::DOUBLE PRECISION AS chalet_lat
  FROM chalets c
  LEFT JOIN "Etablissement" e ON c.etablishment_id = e.key
  WHERE
    ST_DWithin(
      c.location::geography,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
      radius_m
    )
    AND (min_capacity IS NULL OR c.nb_personnes >= min_capacity)
    AND (
      check_start_date IS NULL
      OR check_end_date IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM bookings b
        WHERE b.chalet_id = c.key
          AND b.status IN ('blocked', 'confirmed')
          AND b.start_date::TIMESTAMPTZ < check_end_date
          AND b.end_date::TIMESTAMPTZ > check_start_date
      )
    )
  ORDER BY distance_m ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_chalets_nearby(
  DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_chalets_nearby(
  DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ
) TO anon;
