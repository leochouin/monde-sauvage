-- Create guide_fish_type_locations table
-- Links each guide's fish type specialization to specific locations/rivers/lakes
-- Allows a guide to have multiple locations per fish type

CREATE TABLE IF NOT EXISTS guide_fish_type_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_id UUID NOT NULL REFERENCES guide(id) ON DELETE CASCADE,
  fish_type TEXT NOT NULL,
  location_name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Ensure no duplicate guide+fish_type+location combinations
  UNIQUE(guide_id, fish_type, location_name)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_gftl_guide_id ON guide_fish_type_locations(guide_id);
CREATE INDEX IF NOT EXISTS idx_gftl_fish_type ON guide_fish_type_locations(fish_type);
CREATE INDEX IF NOT EXISTS idx_gftl_guide_fish ON guide_fish_type_locations(guide_id, fish_type);

-- Comments
COMMENT ON TABLE guide_fish_type_locations IS 'Maps guide fish type specializations to specific locations (rivers, lakes, etc.)';
COMMENT ON COLUMN guide_fish_type_locations.guide_id IS 'Reference to the guide';
COMMENT ON COLUMN guide_fish_type_locations.fish_type IS 'Fish type value (saumon, truite, omble, etc.) matching guide.fish_types entries';
COMMENT ON COLUMN guide_fish_type_locations.location_name IS 'Name of the fishing location (e.g., Rivière Cascapédia, Lac des Américains)';
COMMENT ON COLUMN guide_fish_type_locations.description IS 'Optional description of the location or conditions';

-- RLS policies
ALTER TABLE guide_fish_type_locations ENABLE ROW LEVEL SECURITY;

-- Anyone can read (for search/filtering)
CREATE POLICY "guide_fish_type_locations_select" ON guide_fish_type_locations
  FOR SELECT TO authenticated, anon
  USING (true);

-- Only the guide owner can insert/update/delete their own locations
CREATE POLICY "guide_fish_type_locations_insert" ON guide_fish_type_locations
  FOR INSERT TO authenticated
  WITH CHECK (
    guide_id IN (SELECT g.id FROM guide g WHERE g.user_id = auth.uid())
  );

CREATE POLICY "guide_fish_type_locations_update" ON guide_fish_type_locations
  FOR UPDATE TO authenticated
  USING (
    guide_id IN (SELECT g.id FROM guide g WHERE g.user_id = auth.uid())
  );

CREATE POLICY "guide_fish_type_locations_delete" ON guide_fish_type_locations
  FOR DELETE TO authenticated
  USING (
    guide_id IN (SELECT g.id FROM guide g WHERE g.user_id = auth.uid())
  );

-- Grant permissions
GRANT SELECT ON guide_fish_type_locations TO authenticated;
GRANT SELECT ON guide_fish_type_locations TO anon;
GRANT INSERT, UPDATE, DELETE ON guide_fish_type_locations TO authenticated;

-- Helper function to get a guide's locations grouped by fish type
CREATE OR REPLACE FUNCTION public.get_guide_fish_locations(p_guide_id UUID)
RETURNS TABLE (
  fish_type TEXT,
  locations JSON
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    gftl.fish_type,
    json_agg(json_build_object(
      'id', gftl.id,
      'location_name', gftl.location_name,
      'description', gftl.description
    )) as locations
  FROM guide_fish_type_locations gftl
  WHERE gftl.guide_id = p_guide_id
  GROUP BY gftl.fish_type;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_guide_fish_locations(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_guide_fish_locations(UUID) TO anon;
