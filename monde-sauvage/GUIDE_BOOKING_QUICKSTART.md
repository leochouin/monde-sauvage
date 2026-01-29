# Guide Booking System - Quick Start Guide

## 🚀 Quick Setup (5 Minutes)

### 1. Run Database Migration

```bash
cd monde-sauvage
supabase migration up
```

This creates the `guide_booking` table and all necessary functions.

### 2. Deploy Edge Functions

```bash
# Deploy all at once
supabase functions deploy create-guide-booking-event
supabase functions deploy update-guide-booking-event
supabase functions deploy delete-guide-booking-event
supabase functions deploy guide-calendar-availability
supabase functions deploy sync-guide-calendar
```

### 3. Install Frontend Dependencies

```bash
npm install react-datepicker
```

### 4. Test the System

```javascript
// Import the service
import { checkGuideAvailability, createGuideBooking } from './utils/guideBookingService';

// Check availability
const available = await checkGuideAvailability(
  "guide-uuid",
  "2026-01-25T09:00:00Z",
  "2026-01-25T17:00:00Z"
);

console.log('Available:', available);

// Create a booking
if (available.available) {
  const booking = await createGuideBooking({
    guideId: "guide-uuid",
    startTime: "2026-01-25T09:00:00Z",
    endTime: "2026-01-25T17:00:00Z",
    customerName: "Test User",
    customerEmail: "test@example.com",
    tripType: "Hiking",
    numberOfPeople: 2
  });
  
  console.log('Booking created:', booking);
}
```

---

## 📖 Common Use Cases

### Use Case 1: Display Booking Modal

```jsx
import React, { useState } from 'react';
import GuideBookingModal from './modals/guideBookingModal';

function GuideProfile({ guide }) {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <button onClick={() => setShowModal(true)}>
        Book This Guide
      </button>

      <GuideBookingModal
        guide={guide}
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onBookingCreated={(booking) => {
          console.log('Created:', booking);
          alert('Booking confirmed!');
        }}
      />
    </>
  );
}
```

### Use Case 2: List Guide's Bookings

```jsx
import { getGuideBookings } from './utils/guideBookingService';

function GuideCalendar({ guideId }) {
  const [bookings, setBookings] = useState([]);

  useEffect(() => {
    loadBookings();
  }, [guideId]);

  const loadBookings = async () => {
    const data = await getGuideBookings(guideId, {
      includeDeleted: false,
      includeHistorical: false
    });
    setBookings(data);
  };

  return (
    <div>
      <h3>Upcoming Bookings</h3>
      {bookings.map(booking => (
        <div key={booking.id}>
          {booking.customer_name} - {new Date(booking.start_time).toLocaleString()}
        </div>
      ))}
    </div>
  );
}
```

### Use Case 3: Admin - Sync All Guides

```jsx
import { syncGuideBookingsWithCalendar } from './utils/guideBookingService';

function AdminPanel({ guides }) {
  const syncAll = async () => {
    for (const guide of guides) {
      try {
        const results = await syncGuideBookingsWithCalendar(guide.id);
        console.log(`Synced ${guide.name}:`, results);
      } catch (err) {
        console.error(`Failed to sync ${guide.name}:`, err);
      }
    }
  };

  return (
    <button onClick={syncAll}>
      Sync All Guide Calendars
    </button>
  );
}
```

### Use Case 4: Handle Paid Booking

```javascript
import { updateGuideBooking } from './utils/guideBookingService';

// After payment is processed
async function confirmPayment(bookingId, paymentData) {
  await updateGuideBooking(bookingId, {
    status: 'confirmed',
    is_paid: true,
    payment_amount: paymentData.amount,
    payment_reference: paymentData.transactionId
  });
  
  // Send confirmation email
  await sendConfirmationEmail(bookingId);
}
```

### Use Case 5: Cancel Booking

```javascript
import { cancelGuideBooking } from './utils/guideBookingService';

async function handleCancellation(bookingId, reason) {
  try {
    await cancelGuideBooking(bookingId, reason, false);
    alert('Booking cancelled successfully');
  } catch (err) {
    if (err.message.includes('paid booking')) {
      // Show admin approval dialog
      const approved = confirm('This is a paid booking. Contact admin for approval.');
      if (approved) {
        await cancelGuideBooking(bookingId, reason, true);
      }
    }
  }
}
```

---

## 🔍 Debugging Tips

### Check if Guide Has Calendar Access

```sql
SELECT 
  id, 
  name, 
  email, 
  google_refresh_token IS NOT NULL as has_calendar,
  google_token_created_at
FROM guide
WHERE id = 'guide-uuid';
```

### View All Bookings for a Guide

```sql
SELECT 
  id,
  start_time,
  end_time,
  customer_name,
  status,
  source,
  google_event_id,
  is_paid,
  synced_at,
  deleted_at
FROM guide_booking
WHERE guide_id = 'guide-uuid'
ORDER BY start_time DESC;
```

### Check for Conflicts

```sql
SELECT * FROM check_guide_booking_conflict(
  'guide-uuid',
  '2026-01-25T09:00:00Z'::timestamptz,
  '2026-01-25T17:00:00Z'::timestamptz,
  NULL
);
```

### View Sync History

```sql
SELECT 
  guide_id,
  COUNT(*) as total_bookings,
  MAX(synced_at) as last_sync,
  SUM(CASE WHEN source = 'google' THEN 1 ELSE 0 END) as synced_from_calendar,
  SUM(CASE WHEN source = 'system' THEN 1 ELSE 0 END) as created_in_system
FROM guide_booking
WHERE deleted_at IS NULL
GROUP BY guide_id;
```

---

## 🎯 Key Files Reference

### Database
- `supabase/migrations/20260119000000_create_guide_booking_table.sql` - Table schema

### Frontend
- `src/utils/guideBookingService.js` - Client-side service
- `src/modals/guideBookingModal.jsx` - Booking UI component
- `src/modals/guideBookingModal.css` - Styles

### Edge Functions
- `supabase/functions/create-guide-booking-event/` - Create calendar event
- `supabase/functions/update-guide-booking-event/` - Update calendar event
- `supabase/functions/delete-guide-booking-event/` - Delete calendar event
- `supabase/functions/guide-calendar-availability/` - Check availability
- `supabase/functions/sync-guide-calendar/` - Bidirectional sync

### Documentation
- `GUIDE_BOOKING_SYSTEM.md` - Complete documentation (this file)

---

## ⚡ Performance Tips

1. **Cache availability checks** for frequently requested time slots
2. **Batch sync operations** when syncing multiple guides
3. **Use database indexes** - already created in migration
4. **Paginate booking lists** for guides with many bookings
5. **Background sync** - run sync in background, not on every page load

---

## 🛡️ Security Checklist

- ✅ Database uses Row Level Security (RLS) policies
- ✅ Paid bookings protected from deletion
- ✅ Google Calendar uses refresh tokens (no password storage)
- ✅ Edge functions validate all inputs
- ✅ Soft deletion preserves audit trail
- ✅ Customer emails validated before booking creation

---

## 📞 Support

For questions or issues:

1. Check `GUIDE_BOOKING_SYSTEM.md` for detailed documentation
2. Review edge function logs: `supabase functions logs <function-name>`
3. Check database directly using SQL queries above
4. Test individual components in isolation

---

## ✅ Verification Checklist

After setup, verify:

- [ ] Database migration ran successfully
- [ ] All 5 edge functions deployed
- [ ] Guide has `google_refresh_token` in database
- [ ] Can create a test booking
- [ ] Booking appears in Google Calendar
- [ ] Can check availability
- [ ] Sync detects new calendar events
- [ ] Modal opens and displays correctly
- [ ] Conflicts are properly detected

---

## 🎉 You're Ready!

The guide booking system is now fully set up and ready to use. Start by:

1. Adding the booking button to your guide profile pages
2. Testing with a real booking
3. Verifying sync with Google Calendar
4. Setting up periodic sync (optional)

See `GUIDE_BOOKING_SYSTEM.md` for complete documentation and advanced features.
