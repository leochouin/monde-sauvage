-- Update function to get available chalets within a specified radius
-- This function filters out chalets that have bookings during the requested dates

-- Drop the existing function first to allow changing the return type
DROP FUNCTION IF EXISTS public.get_chalets_nearby(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.get_chalets_nearby(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER);

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

-- Grant execute permission to authenticated and anonymous users
GRANT EXECUTE ON FUNCTION public.get_chalets_nearby(
  DOUBLE PRECISION, 
  DOUBLE PRECISION, 
  INTEGER, 
  INTEGER, 
  TIMESTAMPTZ, 
  TIMESTAMPTZ
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_chalets_nearby(
  DOUBLE PRECISION, 
  DOUBLE PRECISION, 
  INTEGER, 
  INTEGER, 
  TIMESTAMPTZ, 
  TIMESTAMPTZ
) TO anon;

-- Add comment to document the function
COMMENT ON FUNCTION public.get_chalets_nearby(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) IS 
'Returns chalets within a radius, filtered by capacity and availability during specified dates. Excludes chalets with overlapping bookings.';
