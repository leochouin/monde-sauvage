-- Add RLS policies for guide_booking table
-- This allows the table to be accessed via the Supabase client

-- Enable RLS on the table (if not already enabled)
ALTER TABLE guide_booking ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all authenticated users to read guide bookings
CREATE POLICY "Allow authenticated users to read guide bookings"
ON guide_booking
FOR SELECT
TO authenticated
USING (true);

-- Policy: Allow all authenticated users to insert guide bookings
CREATE POLICY "Allow authenticated users to insert guide bookings"
ON guide_booking
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Policy: Allow all authenticated users to update guide bookings
CREATE POLICY "Allow authenticated users to update guide bookings"
ON guide_booking
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- Policy: Allow all authenticated users to delete guide bookings
CREATE POLICY "Allow authenticated users to delete guide bookings"
ON guide_booking
FOR DELETE
TO authenticated
USING (true);

-- Also allow anon users to read (for public availability checking)
CREATE POLICY "Allow anon users to read guide bookings"
ON guide_booking
FOR SELECT
TO anon
USING (true);

-- Allow anon users to insert (for booking without account)
CREATE POLICY "Allow anon users to insert guide bookings"
ON guide_booking
FOR INSERT
TO anon
WITH CHECK (true);

-- Notify PostgREST to refresh its schema cache
NOTIFY pgrst, 'reload schema';
