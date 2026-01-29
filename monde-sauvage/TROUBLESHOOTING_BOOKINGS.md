# Troubleshooting Google Calendar Events Not Showing

## Issue
Google Calendar events are not being displayed in the booking modal for acceptance/rejection.

## Most Likely Causes

### 1. Missing Columns in Existing Bookings Table

Your existing bookings table might be missing the columns needed for Google Calendar sync:
- `google_event_id`
- `source`
- `customer_name`
- `customer_email`
- `notes`

**Solution:** Run the migration to add these columns

```bash
# In Supabase Dashboard → SQL Editor, run:
# /supabase/migrations/update_existing_bookings_table.sql
```

Or manually add the columns:

```sql
-- Add missing columns
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS google_event_id TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes TEXT;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_bookings_google_event_id ON bookings(google_event_id);
CREATE INDEX IF NOT EXISTS idx_bookings_source ON bookings(source);
```

### 2. Foreign Key Mismatch

The edge function tries to insert bookings with `chalet_id`, but your existing table might use a different foreign key structure.

**Check your foreign key:**

```sql
-- See how bookings references chalets
SELECT
    tc.constraint_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.table_name = 'bookings' 
  AND tc.constraint_type = 'FOREIGN KEY';
```

**Common scenarios:**
- If it references `Chalets(key)` → Edge function uses `chalet.key`
- If it references `Chalets(id)` → Edge function uses `chalet.id`
- If it references `chalets(key)` (lowercase) → Need to adjust

The code already handles this with: `chalet.key || chalet.id`

### 3. Row Level Security (RLS) Policies

Your bookings table might have RLS enabled that prevents the edge function from inserting data.

**Check RLS:**

```sql
-- Check if RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'bookings';

-- View existing policies
SELECT * FROM pg_policies WHERE tablename = 'bookings';
```

**Solution:** Add a policy for the service role:

```sql
-- Allow service role to insert/update bookings
CREATE POLICY "Service role can manage bookings" 
ON bookings
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
```

### 4. Column Name Differences

Your existing bookings table might use different column names.

**Check column names:**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'bookings'
ORDER BY ordinal_position;
```

**Common differences:**
- `start_date` vs `check_in` or `arrival_date`
- `end_date` vs `check_out` or `departure_date`
- `chalet_id` vs `property_id` or `accommodation_id`

## Debugging Steps

### Step 1: Check Browser Console

Open the modal and check the browser console (F12) for:

```javascript
🔍 Fetching calendar events for: {calendarId, chaletId, ...}
✅ Received data: {eventsCount, bookingsCount, bookings}
```

This will show:
- How many events were fetched from Google
- How many bookings were returned from the database
- The actual bookings data

### Step 2: Check Edge Function Logs

Go to: [Supabase Dashboard → Edge Functions → chalet-calendar-events → Logs](https://supabase.com/dashboard/project/fhpbftdkqnkncsagvsph/functions)

Look for:
- `✅ Found X events` - Google Calendar fetch succeeded
- `📥 Syncing events to bookings table...`
- `✅ Created new booking for event: xxx` - Successful inserts
- `❌ Failed to insert booking:` - Error messages
- `✅ Returning X bookings from database` - Final count

### Step 3: Manually Check Database

```sql
-- See if any bookings exist
SELECT * FROM bookings LIMIT 10;

-- Check for Google-sourced bookings
SELECT * FROM bookings WHERE source = 'google';

-- Check for a specific chalet
SELECT * FROM bookings WHERE chalet_id = 'your-chalet-key-here';
```

### Step 4: Test Manual Insert

Try manually inserting a booking to verify table structure:

```sql
-- Replace with actual chalet_id from your chalets table
INSERT INTO bookings (
    chalet_id,
    start_date,
    end_date,
    status,
    source,
    google_event_id,
    customer_name
) VALUES (
    'your-chalet-key-here',
    NOW() + INTERVAL '1 day',
    NOW() + INTERVAL '3 days',
    'blocked',
    'google',
    'test-event-id',
    'Test Booking'
);

-- Check if it was inserted
SELECT * FROM bookings WHERE customer_name = 'Test Booking';
```

If this fails, check the error message - it will tell you exactly what's wrong.

## Quick Fix Script

Run this in Supabase SQL Editor to add missing columns and fix common issues:

```sql
-- 1. Add missing columns
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS google_event_id TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. Add indexes
CREATE INDEX IF NOT EXISTS idx_bookings_google_event_id ON bookings(google_event_id);
CREATE INDEX IF NOT EXISTS idx_bookings_source ON bookings(source);

-- 3. Add RLS policy for service role (if RLS is enabled)
CREATE POLICY IF NOT EXISTS "Service role can manage bookings" 
ON bookings
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 4. Verify structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'bookings'
ORDER BY ordinal_position;
```

## After Fixing

1. Refresh the browser page
2. Open a chalet modal that has a Google Calendar
3. Check browser console for the debug logs
4. Bookings should now appear with "En attente" status

## Still Not Working?

Share the output of:

1. **Browser Console** - The debug logs when opening the modal
2. **Edge Function Logs** - From Supabase dashboard
3. **Database Schema** - Result of:
   ```sql
   SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_name = 'bookings'
   ORDER BY ordinal_position;
   ```

This will help identify the exact issue!
