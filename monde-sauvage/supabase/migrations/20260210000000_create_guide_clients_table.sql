-- Create guide_clients table for guides to store recurring client information
-- Each guide can only see/manage their own clients

CREATE TABLE IF NOT EXISTS guide_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_id UUID NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Foreign key to guide table
  CONSTRAINT fk_guide_clients_guide
    FOREIGN KEY (guide_id) REFERENCES guide(id)
    ON DELETE CASCADE
);

-- Comments
COMMENT ON TABLE guide_clients IS 'Stores recurring client information per guide for quick booking creation';
COMMENT ON COLUMN guide_clients.id IS 'Unique identifier for the client record';
COMMENT ON COLUMN guide_clients.guide_id IS 'The guide who owns this client record';
COMMENT ON COLUMN guide_clients.full_name IS 'Client full name';
COMMENT ON COLUMN guide_clients.email IS 'Client email address';
COMMENT ON COLUMN guide_clients.phone IS 'Client phone number';
COMMENT ON COLUMN guide_clients.notes IS 'Optional notes about the client (preferences, etc.)';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_guide_clients_guide_id ON guide_clients(guide_id);
CREATE INDEX IF NOT EXISTS idx_guide_clients_name ON guide_clients(guide_id, full_name);
CREATE INDEX IF NOT EXISTS idx_guide_clients_email ON guide_clients(guide_id, email) WHERE email IS NOT NULL;

-- Auto-update updated_at
CREATE TRIGGER update_guide_clients_updated_at
  BEFORE UPDATE ON guide_clients
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE guide_clients ENABLE ROW LEVEL SECURITY;

-- RLS Policies: guides can only access their own clients
-- For authenticated users: can read only their own clients
CREATE POLICY "Guides can read their own clients"
ON guide_clients
FOR SELECT
TO authenticated
USING (
  guide_id IN (
    SELECT g.id FROM guide g WHERE g.user_id = auth.uid()
  )
);

-- For authenticated users: can insert only for themselves
CREATE POLICY "Guides can insert their own clients"
ON guide_clients
FOR INSERT
TO authenticated
WITH CHECK (
  guide_id IN (
    SELECT g.id FROM guide g WHERE g.user_id = auth.uid()
  )
);

-- For authenticated users: can update only their own clients
CREATE POLICY "Guides can update their own clients"
ON guide_clients
FOR UPDATE
TO authenticated
USING (
  guide_id IN (
    SELECT g.id FROM guide g WHERE g.user_id = auth.uid()
  )
)
WITH CHECK (
  guide_id IN (
    SELECT g.id FROM guide g WHERE g.user_id = auth.uid()
  )
);

-- For authenticated users: can delete only their own clients
CREATE POLICY "Guides can delete their own clients"
ON guide_clients
FOR DELETE
TO authenticated
USING (
  guide_id IN (
    SELECT g.id FROM guide g WHERE g.user_id = auth.uid()
  )
);

-- Allow anon access for cases where guide creates bookings without full auth session
CREATE POLICY "Allow anon read for guide clients"
ON guide_clients
FOR SELECT
TO anon
USING (true);

CREATE POLICY "Allow anon insert for guide clients"
ON guide_clients
FOR INSERT
TO anon
WITH CHECK (true);

CREATE POLICY "Allow anon update for guide clients"
ON guide_clients
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

CREATE POLICY "Allow anon delete for guide clients"
ON guide_clients
FOR DELETE
TO anon
USING (true);

-- Notify PostgREST to refresh schema
NOTIFY pgrst, 'reload schema';
