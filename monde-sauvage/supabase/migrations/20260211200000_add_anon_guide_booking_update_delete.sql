-- Add missing RLS policies for anon users to update/delete guide bookings
-- The update policy was missing, causing "Failed to update booking" errors
-- when the client-side Supabase (using anon key) tried to update bookings.

-- Allow anon users to update guide bookings
CREATE POLICY "Allow anon users to update guide bookings"
ON guide_booking
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

-- Allow anon users to delete guide bookings
CREATE POLICY "Allow anon users to delete guide bookings"
ON guide_booking
FOR DELETE
TO anon
USING (true);

-- Notify PostgREST to refresh its schema cache
NOTIFY pgrst, 'reload schema';
