-- Create fishing_zones table to store fishing areas linked to fish types
-- These zones will be displayed on the map when a fish type is selected

-- Enable PostGIS extension if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

-- Add extensions schema to search path so geometry types are available
SET search_path TO public, extensions;

CREATE TABLE IF NOT EXISTS fishing_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  fish_type TEXT NOT NULL,
  geometry GEOMETRY(Polygon, 4326) NOT NULL,
  description TEXT,
  season_start TEXT, -- e.g., 'May'
  season_end TEXT,   -- e.g., 'October'
  difficulty_level TEXT CHECK (difficulty_level IN ('beginner', 'intermediate', 'expert')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comments to document the table
COMMENT ON TABLE fishing_zones IS 'Stores fishing zones/areas linked to fish types for map display';
COMMENT ON COLUMN fishing_zones.fish_type IS 'Type of fish found in this zone (saumon, truite, omble, etc.)';
COMMENT ON COLUMN fishing_zones.geometry IS 'Polygon geometry defining the fishing zone boundaries';

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_fishing_zones_fish_type ON fishing_zones(fish_type);
CREATE INDEX IF NOT EXISTS idx_fishing_zones_geometry ON fishing_zones USING GIST(geometry);

-- Add fish_types column to guide table (array of fish specializations)
ALTER TABLE guide 
ADD COLUMN IF NOT EXISTS fish_types TEXT[] DEFAULT '{}';

-- Check if guide.location is GEOMETRY type, if not skip adding the column
-- (location may already exist as TEXT in your database)
DO $$
BEGIN
  -- Only add location as GEOMETRY if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'guide' AND column_name = 'location'
  ) THEN
    ALTER TABLE guide ADD COLUMN location GEOMETRY(Point, 4326);
  END IF;
END $$;

-- Only create GIST index if location column is geometry type
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'guide' 
    AND column_name = 'location' 
    AND udt_name = 'geometry'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_guide_location ON guide USING GIST(location);
  END IF;
END $$;

COMMENT ON COLUMN guide.fish_types IS 'Array of fish types the guide specializes in';

-- Create function to get fishing zones by fish type
CREATE OR REPLACE FUNCTION public.get_fishing_zones_by_fish_type(
  p_fish_type TEXT
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  fish_type TEXT,
  geometry JSON,
  description TEXT,
  season_start TEXT,
  season_end TEXT,
  difficulty_level TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    fz.id,
    fz.name,
    fz.fish_type,
    ST_AsGeoJSON(fz.geometry)::JSON as geometry,
    fz.description,
    fz.season_start,
    fz.season_end,
    fz.difficulty_level
  FROM fishing_zones fz
  WHERE fz.fish_type = p_fish_type;
END;
$$;

-- Create function to get guides by fish type and optional proximity to zones
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
    END as location,
    CASE 
      WHEN p_zone_id IS NOT NULL AND g.location IS NOT NULL THEN
        ST_Distance(
          g.location::geography,
          (SELECT ST_Centroid(fz.geometry)::geography FROM fishing_zones fz WHERE fz.id = p_zone_id)
        )
      ELSE NULL
    END as distance_m
  FROM guide g
  WHERE 
    g.google_refresh_token IS NOT NULL -- Only guides with calendar connected
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

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_fishing_zones_by_fish_type(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_fishing_zones_by_fish_type(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_guides_by_fish_type(TEXT, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_guides_by_fish_type(TEXT, UUID, INTEGER) TO anon;

-- Grant select on fishing_zones to authenticated and anon users
GRANT SELECT ON fishing_zones TO authenticated;
GRANT SELECT ON fishing_zones TO anon;

-- Add trigger to update updated_at
CREATE TRIGGER update_fishing_zones_updated_at
  BEFORE UPDATE ON fishing_zones
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert sample fishing zones for Gaspésie (these are approximate polygons)
INSERT INTO fishing_zones (name, fish_type, geometry, description, season_start, season_end, difficulty_level) VALUES
-- Saumon Atlantique zones
('Rivière Cascapédia', 'saumon', ST_GeomFromText('POLYGON((-66.1 48.5, -65.9 48.5, -65.9 48.3, -66.1 48.3, -66.1 48.5))', 4326), 'Rivière réputée mondialement pour le saumon atlantique', 'June', 'September', 'intermediate'),
('Rivière Matapédia', 'saumon', ST_GeomFromText('POLYGON((-67.2 48.1, -67.0 48.1, -67.0 47.9, -67.2 47.9, -67.2 48.1))', 4326), 'Excellente rivière à saumon', 'June', 'September', 'intermediate'),
('Rivière Bonaventure', 'saumon', ST_GeomFromText('POLYGON((-65.5 48.4, -65.3 48.4, -65.3 48.2, -65.5 48.2, -65.5 48.4))', 4326), 'Eau cristalline, saumon atlantique', 'June', 'September', 'beginner'),

-- Truite mouchetée zones
('Lac des Américains', 'truite', ST_GeomFromText('POLYGON((-66.0 49.0, -65.8 49.0, -65.8 48.8, -66.0 48.8, -66.0 49.0))', 4326), 'Parc national de la Gaspésie - truites', 'May', 'October', 'beginner'),
('Réserve faunique des Chic-Chocs', 'truite', ST_GeomFromText('POLYGON((-66.5 49.1, -66.2 49.1, -66.2 48.9, -66.5 48.9, -66.5 49.1))', 4326), 'Nombreux lacs à truites', 'May', 'October', 'intermediate'),

-- Omble de fontaine zones
('Rivière Sainte-Anne', 'omble', ST_GeomFromText('POLYGON((-66.4 49.2, -66.2 49.2, -66.2 49.0, -66.4 49.0, -66.4 49.2))', 4326), 'Omble de fontaine abondant', 'May', 'September', 'beginner'),
('Mont Albert Sector', 'omble', ST_GeomFromText('POLYGON((-66.3 48.9, -66.1 48.9, -66.1 48.7, -66.3 48.7, -66.3 48.9))', 4326), 'Lacs alpins avec omble', 'June', 'September', 'expert'),

-- Bar rayé zones (coastal)
('Baie des Chaleurs', 'bar', ST_GeomFromText('POLYGON((-66.5 48.2, -65.5 48.2, -65.5 47.8, -66.5 47.8, -66.5 48.2))', 4326), 'Zone côtière pour le bar rayé', 'June', 'October', 'intermediate'),

-- Maquereau zones (coastal)
('Percé Coastal', 'maquereau', ST_GeomFromText('POLYGON((-64.4 48.6, -64.2 48.6, -64.2 48.4, -64.4 48.4, -64.4 48.6))', 4326), 'Pêche au maquereau près de Percé', 'July', 'September', 'beginner'),
('Gaspé Bay', 'maquereau', ST_GeomFromText('POLYGON((-64.6 48.9, -64.4 48.9, -64.4 48.7, -64.6 48.7, -64.6 48.9))', 4326), 'Baie de Gaspé - maquereau', 'July', 'September', 'beginner');
