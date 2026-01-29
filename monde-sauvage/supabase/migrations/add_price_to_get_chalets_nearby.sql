-- Add price_per_night to the get_chalets_nearby function return values
-- This fixes the price breakdown not displaying in the chalet detail modal

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
  etablishment_name TEXT
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
    )::DOUBLE PRECISION as distance_m,
    c.google_calendar::TEXT,
    c.etablishment_id::UUID,
    e."Name"::TEXT as etablishment_name
  FROM chalets c
  LEFT JOIN "Etablissement" e ON c.etablishment_id = e.key
  WHERE 
    -- Check if chalet is within radius
    ST_DWithin(
      c.location::geography,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
      radius_m
    )
    -- Check capacity if specified
    AND (min_capacity IS NULL OR c.nb_personnes >= min_capacity)
    -- Filter out chalets with overlapping bookings (if dates provided)
    AND (
      check_start_date IS NULL 
      OR check_end_date IS NULL
      OR NOT EXISTS (
        SELECT 1 
        FROM bookings b
        WHERE b.chalet_id = c.key
          AND b.status IN ('blocked', 'confirmed') -- Only check active bookings
          -- Check for date overlap: booking overlaps if it starts before our end date AND ends after our start date
          AND b.start_date::TIMESTAMPTZ < check_end_date
          AND b.end_date::TIMESTAMPTZ > check_start_date
      )
    )
  ORDER BY distance_m ASC;
END;
$$;
