# Guide Reservation System - Complete Documentation

## Overview

This document provides a comprehensive guide to the Guide Reservation System for Monde Sauvage. The system manages guide bookings with bidirectional Google Calendar synchronization, ensuring the database remains the source of truth while keeping guides' calendars up-to-date.

---

## 🏗️ Architecture

### Core Principles

1. **Database as Source of Truth**: The `guide_booking` table is the authoritative source for all bookings
2. **Bidirectional Sync**: Changes in either the database or Google Calendar are synchronized
3. **Conflict Prevention**: Multiple layers of validation prevent double-booking
4. **Payment Protection**: Paid bookings cannot be deleted or modified without explicit permission
5. **Soft Deletion**: Bookings are marked as deleted rather than removed from the database

### Data Flow

```
┌─────────────────┐
│   Frontend      │
│  (React Modal)  │
└────────┬────────┘
         │
         ▼
┌─────────────────────┐         ┌──────────────────┐
│  guideBookingService│◄───────►│  Supabase DB     │
│     (Client)        │         │  (Source of Truth)│
└────────┬────────────┘         └──────────────────┘
         │                                ▲
         ▼                                │
┌─────────────────────┐                  │
│  Edge Functions     │                  │
│  (Supabase)         │                  │
├─────────────────────┤                  │
│ - create-booking    │──────────────────┘
│ - update-booking    │
│ - delete-booking    │
│ - sync-calendar     │
│ - check-availability│
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Google Calendar API│
│  (Secondary Sync)   │
└─────────────────────┘
```

---

## 📊 Database Schema

### `guide_booking` Table

```sql
CREATE TABLE guide_booking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guide_id UUID NOT NULL,                    -- Foreign key to guide table
  start_time TIMESTAMPTZ NOT NULL,           -- Booking start
  end_time TIMESTAMPTZ NOT NULL,             -- Booking end
  status TEXT NOT NULL DEFAULT 'pending',    -- pending, confirmed, booked, cancelled, deleted
  source TEXT NOT NULL DEFAULT 'system',     -- system or google
  google_event_id TEXT,                      -- Links to Google Calendar event
  customer_id UUID,                          -- Optional FK to users
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  trip_type TEXT,                            -- Type of activity
  number_of_people INTEGER,
  notes TEXT,
  is_paid BOOLEAN DEFAULT FALSE,             -- Payment status
  payment_amount DECIMAL(10, 2),
  payment_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ,                     -- Last sync with Google Calendar
  deleted_at TIMESTAMPTZ                     -- Soft deletion timestamp
);
```

### Status Values

- **pending**: Booking created, awaiting confirmation or payment
- **confirmed**: Booking confirmed (can be used after payment)
- **booked**: Alternative confirmed state
- **cancelled**: Booking cancelled by customer or guide
- **deleted**: Booking deleted (soft delete)

### Source Values

- **system**: Booking created through the Monde Sauvage platform
- **google**: Booking synced from Google Calendar

---

## 🔄 Synchronization Workflow

### 1. Creating a Booking (System → Calendar)

```javascript
// Client calls guideBookingService
const booking = await createGuideBooking({
  guideId: "uuid",
  startTime: "2026-01-20T09:00:00Z",
  endTime: "2026-01-20T17:00:00Z",
  customerName: "John Doe",
  customerEmail: "john@example.com",
  // ... other fields
});
```

**Workflow:**

1. ✅ Check availability (DB + Google Calendar)
2. ✅ Create booking in database (`source: 'system'`)
3. ✅ Call `create-guide-booking-event` edge function
4. ✅ Create event in Google Calendar
5. ✅ Update booking with `google_event_id`
6. ✅ Set `synced_at` timestamp

### 2. Syncing Calendar → Database

```javascript
// Periodic or manual sync
const syncResults = await syncGuideBookingsWithCalendar(guideId);
```

**Workflow:**

1. 🔍 Fetch all events from Google Calendar
2. 🔍 Fetch all bookings from database
3. 🗑️ **Detect deletions**: Events in DB but not in Calendar
   - Check if booking is paid (`is_paid = true`)
   - If paid: Skip deletion, add to `protectedBookings`
   - If not paid: Soft delete (set `status = 'deleted'`, `deleted_at = NOW()`)
4. ➕ **Detect new events**: Events in Calendar but not in DB
   - Create new booking with `source = 'google'`
   - Save `google_event_id` for future sync
5. ✅ Update `synced_at` for all bookings

### 3. Updating a Booking

```javascript
const updated = await updateGuideBooking(bookingId, {
  start_time: "2026-01-21T09:00:00Z",
  end_time: "2026-01-21T17:00:00Z",
  notes: "Changed to next day"
});
```

**Workflow:**

1. ✅ Check if booking is paid
2. ✅ If paid and time change requested: Require `allowPaidModification = true`
3. ✅ Check availability for new time slot
4. ✅ Update database
5. ✅ Call `update-guide-booking-event` edge function
6. ✅ Update Google Calendar event

### 4. Cancelling a Booking

```javascript
const cancelled = await cancelGuideBooking(bookingId, "Customer requested cancellation");
```

**Workflow:**

1. ✅ Check if booking is paid
2. ✅ If paid: Require `allowPaidCancellation = true`
3. ✅ Update database (`status = 'cancelled'`)
4. ✅ Call `delete-guide-booking-event` edge function
5. ✅ Delete from Google Calendar

---

## 🔒 Security & Conflict Resolution

### Conflict Detection

The system uses multiple layers to prevent double-booking:

1. **Database Function**: `check_guide_booking_conflict()`
   - Checks for time overlaps in the database
   - Excludes cancelled/deleted bookings
   - Returns list of conflicts

2. **Google Calendar Check**: `guide-calendar-availability`
   - Queries Google Calendar API for events in time range
   - Catches events not yet synced to database

3. **Pre-Creation Validation**: `checkGuideAvailability()`
   - Runs both checks before creating booking
   - Returns `{available: boolean, conflicts: [], reason: string}`

### Payment Protection

```javascript
// Paid bookings are protected from:
// 1. Time modifications without permission
if (currentBooking.is_paid && !allowPaidModification) {
  throw new Error('Cannot modify time of paid booking');
}

// 2. Cancellation without permission
if (booking.is_paid && !allowPaidCancellation) {
  throw new Error('Cannot cancel paid booking without administrator approval');
}

// 3. Deletion during calendar sync
if (booking.is_paid) {
  syncResult.protectedBookings.push(booking.id);
  continue; // Skip deletion
}
```

### Soft Deletion

All deletions are "soft deletes":

```sql
UPDATE guide_booking 
SET status = 'deleted', 
    deleted_at = NOW() 
WHERE id = booking_id;
```

Benefits:
- Audit trail preserved
- Can be restored if needed
- Historical data maintained
- Billing/analytics unaffected

---

## 🚀 Edge Functions

### 1. `create-guide-booking-event`

**Purpose**: Creates Google Calendar event for a new booking

**Input:**
```json
{
  "booking_id": "uuid",
  "guide_id": "uuid",
  "start_time": "2026-01-20T09:00:00Z",
  "end_time": "2026-01-20T17:00:00Z",
  "customer_name": "John Doe",
  "customer_email": "john@example.com",
  "trip_type": "Hiking",
  "notes": "Beginner level"
}
```

**Output:**
```json
{
  "success": true,
  "event_id": "google_event_id",
  "event_link": "https://calendar.google.com/...",
  "message": "Google Calendar event created successfully"
}
```

### 2. `update-guide-booking-event`

**Purpose**: Updates Google Calendar event when booking changes

**Input:**
```json
{
  "booking_id": "uuid",
  "event_id": "google_event_id",
  "guide_id": "uuid",
  "updates": {
    "start_time": "2026-01-21T09:00:00Z",
    "end_time": "2026-01-21T17:00:00Z",
    "customer_name": "John Doe",
    "notes": "Updated notes"
  }
}
```

### 3. `delete-guide-booking-event`

**Purpose**: Deletes Google Calendar event when booking is cancelled

**Input:**
```json
{
  "event_id": "google_event_id",
  "guide_id": "uuid"
}
```

### 4. `sync-guide-calendar`

**Purpose**: Bidirectional sync between database and Google Calendar

**Input:**
```json
{
  "guide_id": "uuid"
}
```

**Output:**
```json
{
  "success": true,
  "syncResult": {
    "deletedBookings": ["uuid1", "uuid2"],
    "newBookings": ["uuid3"],
    "updatedBookings": [],
    "errors": [],
    "protectedBookings": ["uuid4"]
  },
  "message": "Sync completed: 1 new, 2 deleted, 1 protected"
}
```

### 5. `guide-calendar-availability`

**Purpose**: Checks Google Calendar for conflicts in a time range

**Input (Query Params):**
- `guide_id`: UUID
- `start_time`: ISO datetime
- `end_time`: ISO datetime

**Output:**
```json
{
  "available": false,
  "conflicts": [
    {
      "id": "event_id",
      "summary": "Fishing Trip",
      "start": "2026-01-20T09:00:00Z",
      "end": "2026-01-20T17:00:00Z",
      "link": "https://calendar.google.com/..."
    }
  ],
  "message": "Found 1 conflicting event(s)"
}
```

---

## 🎨 Frontend Usage

### Basic Booking Flow

```jsx
import React, { useState } from 'react';
import GuideBookingModal from './modals/guideBookingModal';

function GuidePage({ guide }) {
  const [showBooking, setShowBooking] = useState(false);

  const handleBookingCreated = (booking) => {
    console.log('Booking created:', booking);
    // Show confirmation, redirect, etc.
  };

  return (
    <div>
      <button onClick={() => setShowBooking(true)}>
        Book This Guide
      </button>

      <GuideBookingModal
        guide={guide}
        isOpen={showBooking}
        onClose={() => setShowBooking(false)}
        onBookingCreated={handleBookingCreated}
      />
    </div>
  );
}
```

### Direct Service Usage

```javascript
import {
  createGuideBooking,
  updateGuideBooking,
  cancelGuideBooking,
  getGuideBookings,
  syncGuideBookingsWithCalendar
} from './utils/guideBookingService';

// Create booking
const booking = await createGuideBooking({
  guideId: guide.id,
  startTime: startDate.toISOString(),
  endTime: endDate.toISOString(),
  customerName: "Jane Smith",
  customerEmail: "jane@example.com",
  tripType: "Canoeing",
  numberOfPeople: 4
});

// Get all bookings
const bookings = await getGuideBookings(guide.id, {
  includeDeleted: false,
  includeHistorical: false,
  status: 'confirmed'
});

// Update booking
const updated = await updateGuideBooking(booking.id, {
  notes: "Bring rain gear"
});

// Cancel booking
const cancelled = await cancelGuideBooking(
  booking.id, 
  "Weather conditions unsafe"
);

// Sync with Google Calendar
const syncResults = await syncGuideBookingsWithCalendar(guide.id);
```

---

## 🔧 Setup & Installation

### 1. Database Migration

```bash
cd monde-sauvage
supabase migration up
```

This will run the migration file:
- `supabase/migrations/20260119000000_create_guide_booking_table.sql`

### 2. Deploy Edge Functions

```bash
# Deploy all guide booking functions
supabase functions deploy create-guide-booking-event
supabase functions deploy update-guide-booking-event
supabase functions deploy delete-guide-booking-event
supabase functions deploy guide-calendar-availability
supabase functions deploy sync-guide-calendar
```

### 3. Environment Variables

Ensure these are set in Supabase:

- `GOOGLE_CLIENT_ID`: Google OAuth client ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret
- `SUPABASE_URL`: Your Supabase project URL
- `SERVICE_ROLE_KEY`: Supabase service role key

### 4. Frontend Dependencies

```bash
npm install react-datepicker
```

### 5. Import Components

```jsx
// In your app
import GuideBookingModal from './modals/guideBookingModal';
import { 
  createGuideBooking, 
  checkGuideAvailability 
} from './utils/guideBookingService';
```

---

## 📅 Scheduled Sync (Recommended)

For automatic synchronization, set up a periodic trigger:

### Option 1: Cron Job (Supabase Edge Function)

Create a scheduled function that runs every hour:

```typescript
// supabase/functions/scheduled-guide-sync/index.ts
import { createClient } from "@supabase/supabase-js";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SERVICE_ROLE_KEY")!
  );

  // Get all guides with Google Calendar tokens
  const { data: guides } = await supabase
    .from("guide")
    .select("id")
    .not("google_refresh_token", "is", null);

  // Sync each guide
  for (const guide of guides || []) {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-guide-calendar`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ guide_id: guide.id })
    });
  }

  return new Response(JSON.stringify({ synced: guides?.length || 0 }));
});
```

### Option 2: Manual Admin Trigger

Add an admin interface to trigger syncs:

```jsx
function AdminDashboard() {
  const syncGuide = async (guideId) => {
    const results = await syncGuideBookingsWithCalendar(guideId);
    console.log('Sync results:', results);
  };

  return (
    <button onClick={() => syncGuide(guide.id)}>
      Sync Calendar
    </button>
  );
}
```

---

## 🧪 Testing

### Test Availability Check

```javascript
const result = await checkGuideAvailability(
  "guide-uuid",
  "2026-01-20T09:00:00Z",
  "2026-01-20T17:00:00Z"
);

console.log(result);
// { available: true } or
// { available: false, conflicts: [...], reason: "..." }
```

### Test Booking Creation

```javascript
const booking = await createGuideBooking({
  guideId: "guide-uuid",
  startTime: "2026-01-20T09:00:00Z",
  endTime: "2026-01-20T17:00:00Z",
  customerName: "Test Customer",
  customerEmail: "test@example.com",
  tripType: "Test Trip",
  numberOfPeople: 2,
  notes: "This is a test booking"
});

console.log('Created:', booking);
```

### Test Sync

```javascript
const syncResults = await syncGuideBookingsWithCalendar("guide-uuid");

console.log('Deleted bookings:', syncResults.deletedBookings);
console.log('New bookings:', syncResults.newBookings);
console.log('Protected bookings:', syncResults.protectedBookings);
```

---

## 🐛 Troubleshooting

### Booking Not Syncing to Google Calendar

1. **Check guide has refresh token:**
   ```sql
   SELECT id, email, google_refresh_token IS NOT NULL as has_token
   FROM guide
   WHERE id = 'guide-uuid';
   ```

2. **Test token refresh:**
   ```bash
   curl "${SUPABASE_URL}/functions/v1/refresh-google-token?guideId=guide-uuid" \
     -H "Authorization: Bearer ${ANON_KEY}"
   ```

3. **Check edge function logs:**
   ```bash
   supabase functions logs create-guide-booking-event
   ```

### Calendar Events Not Syncing to Database

1. **Check last sync time:**
   ```sql
   SELECT MAX(synced_at) as last_sync
   FROM guide_booking
   WHERE guide_id = 'guide-uuid';
   ```

2. **Manually trigger sync:**
   ```javascript
   await syncGuideBookingsWithCalendar(guideId);
   ```

3. **Check for errors in sync results:**
   ```javascript
   const results = await syncGuideBookingsWithCalendar(guideId);
   console.log('Errors:', results.errors);
   ```

### Conflicts Not Detected

1. **Test conflict detection function:**
   ```sql
   SELECT * FROM check_guide_booking_conflict(
     'guide-uuid',
     '2026-01-20T09:00:00Z',
     '2026-01-20T17:00:00Z',
     NULL
   );
   ```

2. **Check for soft-deleted bookings:**
   ```sql
   SELECT * FROM guide_booking
   WHERE guide_id = 'guide-uuid'
     AND deleted_at IS NULL;
   ```

---

## 📈 Future Enhancements

### Payment Integration

```javascript
// After payment processing
await updateGuideBooking(bookingId, {
  is_paid: true,
  payment_amount: 250.00,
  payment_reference: "stripe_ch_xyz123",
  status: 'confirmed'
});
```

### Email Notifications

```javascript
// After booking creation
await sendBookingConfirmationEmail({
  to: customerEmail,
  booking: booking,
  guide: guide
});

// After sync detects deletion of paid booking
await notifyAdminOfDeletedPaidBooking({
  booking: booking,
  guide: guide
});
```

### Multi-Guide Bookings

```javascript
// Book multiple guides for same activity
const bookings = await Promise.all([
  createGuideBooking({ guideId: guide1.id, ... }),
  createGuideBooking({ guideId: guide2.id, ... })
]);
```

### Recurring Bookings

```javascript
// Create series of bookings
const series = await createRecurringBooking({
  guideId: guide.id,
  startTime: "2026-01-20T09:00:00Z",
  endTime: "2026-01-20T17:00:00Z",
  recurrence: "weekly",
  count: 4
});
```

---

## 📝 Summary

The Guide Reservation System provides a robust, scalable solution for managing guide bookings with automatic Google Calendar synchronization. Key features include:

✅ Database as source of truth  
✅ Bidirectional Google Calendar sync  
✅ Multi-layer conflict detection  
✅ Payment protection  
✅ Soft deletion with audit trail  
✅ Real-time availability checking  
✅ Modular, maintainable code architecture  

The system is ready for production use and can be easily extended with payment processing, email notifications, and additional features.
