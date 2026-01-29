-- Create a helper function to create PostGIS point from lat/lon
-- This ensures the location is stored in the same format as your existing data

CREATE OR REPLACE FUNCTION public.create_point_geometry(longitude DOUBLE PRECISION, latitude DOUBLE PRECISION)
RETURNS geometry
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geometry;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.create_point_geometry(DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_point_geometry(DOUBLE PRECISION, DOUBLE PRECISION) TO anon;

-- Create a helper function to extract lat/lon from PostGIS geometry
CREATE OR REPLACE FUNCTION public.get_point_coordinates(geom geometry)
RETURNS json
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT json_build_object(
    'latitude', ST_Y(geom),
    'longitude', ST_X(geom)
  );
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_point_coordinates(geometry) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_point_coordinates(geometry) TO anon;
