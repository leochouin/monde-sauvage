-- Create normalized guide_service_locations table
-- Replaces free-text guide_fish_type_locations.location_name with references to fishing_zones.id

CREATE TABLE IF NOT EXISTS guide_service_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_id UUID NOT NULL REFERENCES guide(id) ON DELETE CASCADE,
  fish_type TEXT NOT NULL,
  fishing_zone_id UUID NOT NULL REFERENCES fishing_zones(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicates for the same guide/fish/location combination
  UNIQUE (guide_id, fish_type, fishing_zone_id)
);

CREATE INDEX IF NOT EXISTS idx_gsl_guide_id ON guide_service_locations(guide_id);
CREATE INDEX IF NOT EXISTS idx_gsl_fish_type ON guide_service_locations(fish_type);
CREATE INDEX IF NOT EXISTS idx_gsl_zone_id ON guide_service_locations(fishing_zone_id);

COMMENT ON TABLE guide_service_locations IS 'Normalized mapping of guide service locations by fish type using fishing_zones references';
COMMENT ON COLUMN guide_service_locations.guide_id IS 'Reference to guide';
COMMENT ON COLUMN guide_service_locations.fish_type IS 'Fish type selected by the guide';
COMMENT ON COLUMN guide_service_locations.fishing_zone_id IS 'Reference to predefined fishing zone';

ALTER TABLE guide_service_locations ENABLE ROW LEVEL SECURITY;

-- Public read is allowed to support filtering/search by clients
DROP POLICY IF EXISTS "guide_service_locations_select" ON guide_service_locations;
CREATE POLICY "guide_service_locations_select" ON guide_service_locations
  FOR SELECT TO authenticated, anon
  USING (true);

-- Guide owners can manage only their own rows
DROP POLICY IF EXISTS "guide_service_locations_insert" ON guide_service_locations;
CREATE POLICY "guide_service_locations_insert" ON guide_service_locations
  FOR INSERT TO authenticated
  WITH CHECK (
    guide_id IN (SELECT g.id FROM guide g WHERE g.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "guide_service_locations_update" ON guide_service_locations;
CREATE POLICY "guide_service_locations_update" ON guide_service_locations
  FOR UPDATE TO authenticated
  USING (
    guide_id IN (SELECT g.id FROM guide g WHERE g.user_id = auth.uid())
  )
  WITH CHECK (
    guide_id IN (SELECT g.id FROM guide g WHERE g.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "guide_service_locations_delete" ON guide_service_locations;
CREATE POLICY "guide_service_locations_delete" ON guide_service_locations
  FOR DELETE TO authenticated
  USING (
    guide_id IN (SELECT g.id FROM guide g WHERE g.user_id = auth.uid())
  );

GRANT SELECT ON guide_service_locations TO authenticated;
GRANT SELECT ON guide_service_locations TO anon;
GRANT INSERT, UPDATE, DELETE ON guide_service_locations TO authenticated;

-- Backfill normalized rows from legacy free-text table when names match existing fishing zones
INSERT INTO guide_service_locations (guide_id, fish_type, fishing_zone_id)
SELECT DISTINCT
  legacy.guide_id,
  legacy.fish_type,
  zones.id AS fishing_zone_id
FROM guide_fish_type_locations legacy
JOIN fishing_zones zones
  ON zones.fish_type = legacy.fish_type
 AND lower(trim(zones.name)) = lower(trim(legacy.location_name))
ON CONFLICT (guide_id, fish_type, fishing_zone_id) DO NOTHING;
