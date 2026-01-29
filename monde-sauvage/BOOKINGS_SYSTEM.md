# Bookings System Implementation

## Overview

The bookings system syncs Google Calendar events to a local database table and provides a workflow for managing reservations. This allows you to:
- Automatically sync Google Calendar events to your database
- Review and approve bookings from Google Calendar
- Track booking status (blocked, confirmed, cancelled)
- Support multiple booking sources (Google, manual, etc.)

## Database Schema

### Bookings Table

```sql
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chalet_id UUID NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'blocked',
  source TEXT NOT NULL DEFAULT 'manual',
  google_event_id TEXT,
  customer_name TEXT,
  customer_email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Key Columns:**
- `status`: Booking status
  - `blocked` - Pending approval (default for Google Calendar events)
  - `confirmed` - Approved booking
  - `cancelled` - Rejected or cancelled booking
- `source`: Booking source
  - `google` - Synced from Google Calendar
  - `manual` - Manually created
  - Can be extended for other sources (airbnb, booking.com, etc.)
- `google_event_id`: Links bookings to Google Calendar events for sync

## Setup Instructions

### 1. Apply Database Migration

Run the migration to create the bookings table:

```bash
cd monde-sauvage

# If supabase link is configured:
supabase db push

# Or manually run the SQL in Supabase dashboard:
# supabase/migrations/create_bookings_table.sql
```

You can also run the SQL directly in the Supabase SQL Editor from:
`/monde-sauvage/supabase/migrations/create_bookings_table.sql`

### 2. Deploy Edge Function

The edge function has been updated to sync Google Calendar events to the bookings table:

```bash
supabase functions deploy chalet-calendar-events
```

✅ This step is already complete!

## How It Works

### Sync Process

1. **Fetch Calendar Events**: When the modal opens, it calls the `chalet-calendar-events` edge function
2. **Sync to Database**: The edge function:
   - Fetches events from Google Calendar
   - Creates new bookings with `status='blocked'` and `source='google'`
   - Updates existing blocked bookings if dates change
   - Preserves confirmed bookings (doesn't overwrite)
3. **Return Bookings**: Returns all bookings from the database (not raw calendar events)

### Booking Workflow

1. **New Google Calendar Event Created**
   - Automatically synced to bookings table with `status='blocked'`
   - Shows in modal with "En attente" (Pending) badge

2. **Review Booking**
   - User sees booking details in the modal
   - Two options available:
     - ✓ **Confirmer** - Approve the booking (status → 'confirmed')
     - ✕ **Refuser** - Reject the booking (status → 'cancelled')

3. **Confirmed Bookings**
   - Display with green badge "Confirmée"
   - No longer editable by calendar sync
   - Visible to customers

4. **Cancelled Bookings**
   - Display with red badge "Annulée"
   - Kept for record-keeping
   - Can be filtered out in queries

## UI Features

### Booking Cards

Each booking displays:
- Customer name (from Google Calendar event summary)
- Status badge (En attente / Confirmée / Annulée)
- Source badge (📅 Google for synced events)
- Start and end dates
- Customer email (if available)
- Notes (from event description)

### Color Coding

- 🟡 **Orange** - Blocked/Pending bookings
- 🟢 **Green** - Confirmed bookings
- 🔴 **Red** - Cancelled bookings

### Action Buttons

Only visible for `blocked` bookings:
- **Confirmer** button - Confirms the booking
- **Refuser** button - Rejects the booking

## API Response Format

The edge function now returns:

```json
{
  "events": [...],        // Raw Google Calendar events
  "bookings": [...],      // Synced bookings from database
  "calendar_id": "..."    // Google Calendar ID
}
```

The modal uses `bookings` array for display.

## Database Queries

### Get All Future Bookings for a Chalet

```sql
SELECT * FROM bookings 
WHERE chalet_id = 'chalet-uuid'
  AND end_date >= NOW()
  AND status != 'cancelled'
ORDER BY start_date ASC;
```

### Get Pending Bookings

```sql
SELECT * FROM bookings 
WHERE chalet_id = 'chalet-uuid'
  AND status = 'blocked'
ORDER BY start_date ASC;
```

### Get Confirmed Bookings

```sql
SELECT * FROM bookings 
WHERE chalet_id = 'chalet-uuid'
  AND status = 'confirmed'
ORDER BY start_date ASC;
```

## Benefits

1. **Single Source of Truth**: All bookings in one database table
2. **Multi-Source Support**: Easy to add bookings from Airbnb, Booking.com, etc.
3. **Approval Workflow**: Review Google Calendar events before confirming
4. **Audit Trail**: Track booking history with status changes
5. **Performance**: Faster queries, no repeated API calls
6. **Offline Capability**: View bookings even if Google API is down

## Extending the System

### Add New Booking Sources

To add support for Airbnb, Booking.com, or other platforms:

1. Create edge function to fetch bookings from the platform
2. Insert bookings with appropriate `source` value (e.g., 'airbnb')
3. Set initial `status` to 'blocked' for approval workflow
4. Add platform-specific identifier column if needed

### Add Calendar Sync

To keep Google Calendar updated with confirmed bookings:

1. Listen for booking status changes (use Supabase database webhooks)
2. When status changes to 'confirmed', update/create Google Calendar event
3. Store the `google_event_id` for future updates

### Add Email Notifications

1. Use Supabase Edge Functions with email service
2. Send emails when:
   - New booking created (notify owner)
   - Booking confirmed (notify customer)
   - Booking cancelled (notify customer)

## Troubleshooting

### Bookings not syncing

1. Check Google Calendar OAuth connection in establishment settings
2. Verify `chalet.google_calendar` ID is set
3. Check edge function logs in Supabase dashboard

### Duplicate bookings

- The system checks `google_event_id` to prevent duplicates
- If duplicates occur, ensure Google event IDs are being saved correctly

### Migration issues

If `supabase db push` fails:
1. Go to Supabase Dashboard → SQL Editor
2. Copy contents of `supabase/migrations/create_bookings_table.sql`
3. Run manually in SQL Editor

## Related Files

- **Migration**: `/supabase/migrations/create_bookings_table.sql`
- **Edge Function**: `/supabase/functions/chalet-calendar-events/index.ts`
- **Modal Component**: `/src/modals/chaletHoraireModal.jsx`
