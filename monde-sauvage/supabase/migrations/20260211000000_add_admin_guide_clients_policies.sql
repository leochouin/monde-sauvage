-- Add RLS policies so admin users can manage guide_clients across all guides
-- Admin is identified by users.type = 'admin' where users.id = auth.uid()

-- SELECT: Admins can read all guide clients
CREATE POLICY "Admins can read all guide clients"
ON guide_clients
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.type = 'admin'
  )
);

-- INSERT: Admins can create clients for any guide
CREATE POLICY "Admins can insert guide clients"
ON guide_clients
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.type = 'admin'
  )
);

-- UPDATE: Admins can update any guide client
CREATE POLICY "Admins can update guide clients"
ON guide_clients
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.type = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.type = 'admin'
  )
);

-- DELETE: Admins can delete any guide client
CREATE POLICY "Admins can delete guide clients"
ON guide_clients
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.type = 'admin'
  )
);

-- Notify PostgREST to refresh schema
NOTIFY pgrst, 'reload schema';
