-- Create function to get chalets within a specified radius
-- This function checks if the user's search circle intersects with each chalet's detection circle

CREATE OR REPLACE FUNCTION public.get_chalets_nearby(
  lng DOUBLE PRECISION,
  lat DOUBLE PRECISION,
  radius_m INTEGER
)
RETURNS TABLE (
  id UUID,
  nom TEXT,
  location GEOMETRY,
  description TEXT,
  detection_radius_m INTEGER,
  distance_m DOUBLE PRECISION
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.nom,
    c.location,
    c.description,
    COALESCE(c.detection_radius_m, 5000) as detection_radius_m, -- Default 5km if not set
    ST_Distance(
      c.location::geography,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
    ) as distance_m
  FROM chalets c
  WHERE ST_DWithin(
    c.location::geography,
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
    radius_m + COALESCE(c.detection_radius_m, 5000) -- User's radius + chalet's detection radius
  )
  ORDER BY distance_m ASC;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_chalets_nearby(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_chalets_nearby(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) TO anon;

-- Add detection_radius_m column to chalets table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'chalets' AND column_name = 'detection_radius_m'
  ) THEN
    ALTER TABLE chalets ADD COLUMN detection_radius_m INTEGER DEFAULT 5000;
    COMMENT ON COLUMN chalets.detection_radius_m IS 'Detection radius in meters for this chalet (default 5km)';
  END IF;
END $$;
