# Monde Sauvage - Reservation System Documentation

## Overview

This document describes the complete Airbnb-style reservation system implemented for Monde Sauvage chalets. The system integrates both Supabase database bookings and Google Calendar availability to provide real-time booking capabilities.

## Architecture

### Core Components

1. **bookingService.js** - Central booking logic and availability checking
2. **chaletDetailModal.jsx** - User-facing reservation interface
3. **chalet-calendar-events Edge Function** - Google Calendar sync (Calendar → Database)
4. **create-booking-calendar-event Edge Function** - Google Calendar sync (Database → Calendar)

### Source of Truth: Database First

**The `bookings` table is the source of truth.** All bookings originate in the database and are synced to Google Calendar.

#### Bidirectional Sync

**Website → Database → Google Calendar**
```
User creates booking on website
    ↓
Saved to bookings table (source of truth)
    ↓
Automatically synced to Google Calendar
    ↓
Event created with booking reference
```

**Google Calendar → Database**
```
Event created directly in Google Calendar
    ↓
Synced to bookings table (via chalet-calendar-events)
    ↓
Marked with source="google"
```

### Payment-Ready Architecture

The system is designed to support future payment integration:

```
User selects dates
    ↓
checkAvailability() → validates dates (DB + Google Calendar)
    ↓
User fills form and submits
    ↓
createBooking() → creates booking with status="pending"
    ↓
syncToGoogleCalendar() → creates Google Calendar event (non-blocking)
    ↓
[FUTURE: initiatePayment()]
    ↓
[FUTURE: onSuccess → confirmBooking()]
    ↓
[FUTURE: onFailure → cancelBooking() + deleteGoogleEvent()]
```

## Database Schema

### bookings Table

```sql
id: integer (primary key)
chalet_id: uuid (foreign key to chalets.key)
start_date: date
end_date: date
status: text ('pending' | 'confirmed' | 'paid' | 'cancelled')
source: text ('google' | 'website')
customer_name: text
customer_email: text
google_event_id: text (nullable)
notes: text (nullable)
created_at: timestamp
```

**Important Rules:**

- `source = "google"` → booking originated from Google Calendar sync (external event)
- `source = "website"` → booking created via reservation form (then synced TO Google Calendar)
- `status = "pending"` → awaiting confirmation/payment
- `status = "confirmed"` → confirmed booking (from Google or after future payment)
- Google Calendar events FROM the calendar are synced with `status="confirmed"` and `source="google"`
- Website bookings are synced TO Google Calendar automatically with booking reference

### chalets Table

```sql
key: uuid (primary key)
Name: text
Description: text
nb_personnes: integer
price_per_night: numeric
etablishment_id: uuid
google_calendar: text (calendar ID)
Image: text (URL)
latitude: numeric
longitude: numeric
```

**Important:** Use `chalets.key` as the foreign key to `bookings.chalet_id`.

## Availability Logic

The system checks availability using **TWO sources**:

### 1. Supabase Database

```javascript
// Check for overlapping bookings in database
const overlappingBookings = await supabase
  .from('bookings')
  .select('*')
  .eq('chalet_id', chaletId)
  .eq('status', 'confirmed')
  .or(`and(start_date.lt.${endDate},end_date.gt.${startDate})`);

if (overlappingBookings.length > 0) {
  return { available: false };
}
```

**Overlap Logic:**
- Booking overlaps if: `booking.start_date < selected_end_date AND booking.end_date > selected_start_date`

### 2. Google Calendar

```javascript
// If chalet has Google Calendar, check it
if (chalet.google_calendar) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/chalet-calendar-events?calendar_id=${calendar}&chalet_id=${id}&start_date=${start}&end_date=${end}`
  );
  
  const calendarData = await response.json();
  if (calendarData.bookings && calendarData.bookings.length > 0) {
    return { available: false };
  }
}
```

**Important:** Google Calendar events should either:
- Already be synced into `bookings` table with `source="google"`, OR
- Be checked live via the edge function

## API Reference

### bookingService.js Functions

#### checkChaletAvailability(chaletId, startDate, endDate)

Checks if a chalet is available for booking.

**Parameters:**
- `chaletId` (string) - The chalet key/UUID
- `startDate` (string) - ISO format date (YYYY-MM-DD)
- `endDate` (string) - ISO format date (YYYY-MM-DD)

**Returns:**
```javascript
{
  available: boolean,
  reason?: string  // Only present if unavailable
}
```

#### calculateBookingPrice(pricePerNight, startDate, endDate)

Calculates the total price for a booking.

**Parameters:**
- `pricePerNight` (number) - Price per night from chalet data
- `startDate` (string) - ISO format date
- `endDate` (string) - ISO format date

**Returns:**
```javascript
{
  nights: number,
  subtotal: number,
  serviceFee: number,  // Currently 0, placeholder for future
  total: number
}
```

#### createBooking(bookingData)

Creates a new booking in the database AND syncs to Google Calendar.

**Parameters:**
```javascript
{
  chaletId: string,
  startDate: string,
  endDate: string,
  customerName: string,
  customerEmail: string,
  notes?: string
}
```

**Returns:** The created booking object

**Behavior:**
- Double-checks availability before creating
- Sets `status="pending"` (payment-ready)
- Sets `source="website"`
- **Automatically syncs to Google Calendar** (non-blocking)
- Updates booking with `google_event_id` after sync
- Throws error if unavailable
- Booking is valid even if Google sync fails

#### confirmBooking(bookingId)

Confirms a booking (for future payment integration).

**Parameters:**
- `bookingId` (number) - The booking ID

**Returns:** The updated booking object

**Usage:** Call after successful payment

#### cancelBooking(bookingId, deleteFromCalendar = true)

Cancels a booking and optionally deletes the Google Calendar event.

**Parameters:**
- `bookingId` (number) - The booking ID
- `deleteFromCalendar` (boolean) - Whether to delete from Google Calendar (default: true)

**Returns:** The updated booking object

**Usage:** Call if payment fails or user cancels

**Behavior:**
- Updates status to 'cancelled'
- Deletes corresponding Google Calendar event (if exists and deleteFromCalendar=true)
- Non-blocking - booking is cancelled even if Calendar delete fails

#### getChaletBookings(chaletId)

Gets all bookings for a specific chalet.

**Parameters:**
- `chaletId` (string) - The chalet key

**Returns:** Array of booking objects

## User Interface

### Chalet Detail Modal

The modal includes:

1. **Image Gallery** - Chalet photos
2. **Description Section** - Details and amenities
3. **Reservation Section** - Booking interface

### Reservation Interface (Airbnb Style)

#### Date Selection
- Check-in date picker
- Check-out date picker
- Validation: no past dates, check-out > check-in

#### Real-Time Availability
- Shows status while checking: "🔄 Vérification de la disponibilité..."
- Available: "✅ Disponible pour ces dates" (green background)
- Unavailable: "❌ Non disponible: [reason]" (red background)

#### Price Breakdown
```
250$ × 3 nuits     750$ CAD
─────────────────────────────
Total              750$ CAD
```

#### Guest Information Form
- Full name (required)
- Email (required)
- Notes (optional)

#### Reserve Button
- Enabled only when available
- Shows loading state while submitting
- Disabled if unavailable

#### Success Message
After successful booking:
```
✅
Réservation confirmée!
Votre demande de réservation a été enregistrée avec succès.
```

## Edge Function: chalet-calendar-events

**Purpose:** Syncs Google Calendar events INTO the bookings table

### Endpoint
```
GET /functions/v1/chalet-calendar-events
```

### Parameters
- `calendar_id` (required) - The Google Calendar ID
- `chalet_id` (required) - The chalet key/UUID
- `start_date` (optional) - ISO date for range start
- `end_date` (optional) - ISO date for range end

### Behavior

1. **Authenticates** with Google Calendar using establishment's refresh token
2. **Fetches events** from Google Calendar for the specified date range
3. **Syncs events** to `bookings` table:
   - Creates new bookings for new events (source="google", status="confirmed")
   - Updates existing Google-sourced bookings
   - Never modifies website-sourced bookings
4. **Returns** both events and bookings

### Response Format
```json
{
  "events": [...],
  "bookings": [...],
  "calendar_id": "abc123@group.calendar.google.com"
}
```

---

## Edge Function: create-booking-calendar-event

**Purpose:** Syncs bookings FROM database TO Google Calendar

### Endpoint
```
POST /functions/v1/create-booking-calendar-event
```

### Parameters (JSON Body)
```json
{
  "booking_id": 123,
  "calendar_id": "abc@group.calendar.google.com",
  "chalet_name": "Chalet 1",
  "start_date": "2026-01-25",
  "end_date": "2026-01-28",
  "customer_name": "John Doe",
  "customer_email": "john@example.com",
  "notes": "Late arrival"
}
```

### Behavior

1. **Validates** booking exists in database
2. **Authenticates** with Google Calendar using establishment's refresh token
3. **Creates event** in Google Calendar with:
   - Title: "[Chalet Name] - [Customer Name]"
   - Description: Customer details and notes
   - All-day event format
   - Customer added as attendee
   - Metadata: booking_id and source="monde_sauvage_website"
4. **Updates** booking record with `google_event_id`
5. **Returns** event ID and link

### Response Format
```json
{
  "success": true,
  "event_id": "abc123",
  "event_link": "https://calendar.google.com/...",
  "message": "Booking synced to Google Calendar successfully"
}
```

### Error Handling

- If Google Calendar sync fails, **booking is still valid**
- Error is logged but doesn't block booking creation
- Booking exists in database without `google_event_id`

## Testing Guide

### Test Scenario 1: Basic Availability Check

1. Open the app and click on a chalet
2. Select check-in and check-out dates
3. Verify availability status appears
4. Verify price calculation is correct

### Test Scenario 2: Create Website Booking

1. Select available dates
2. Fill in guest information
3. Click "Réserver"
4. Verify success message appears
5. Check database: `bookings` table should have new row with `source="website"`, `status="pending"`

### Test Scenario 3: Google Calendar Conflict

1. Create an event in the chalet's Google Calendar
2. Wait for sync (or trigger manually)
3. Try to book the same dates on the website
4. Verify "unavailable" message appears

### Test Scenario 4: Overlapping Database Booking

1. Create a booking in the database (simulate existing reservation)
2. Try to book overlapping dates
3. Verify "unavailable" message with reason

## Future Enhancements

### Payment Integration

To add payment (e.g., Stripe):

1. **Install Stripe SDK**
   ```bash
   npm install @stripe/stripe-js
   ```

2. **Update workflow** in `chaletDetailModal.jsx`:
   ```javascript
   const handleSubmitReservation = async (e) => {
     e.preventDefault();
     
     // Create pending booking
     const booking = await createBooking({...});
     
     // Initiate payment
     const paymentResult = await initiateStripePayment(booking);
     
     if (paymentResult.success) {
       await confirmBooking(booking.id);
       showSuccessMessage();
     } else {
       await cancelBooking(booking.id);
       showErrorMessage();
     }
   };
   ```

3. **Update booking status** to include "paid"

### Email Notifications

Add email sending on booking creation:
- Confirmation to guest
- Notification to establishment owner

### Admin Dashboard

Create admin interface to:
- View all bookings
- Manage reservations
- Handle cancellations
- Issue refunds

## Troubleshooting

### "Failed to check booking availability"

**Cause:** Database connection issue or incorrect query

**Solution:**
1. Check Supabase connection
2. Verify `bookings` table exists
3. Check table permissions (RLS policies)

### "Failed to check Google Calendar"

**Cause:** 
- Google Calendar not connected
- Token expired
- Invalid calendar ID

**Solution:**
1. Check if establishment has `google_calendar_id`
2. Reconnect Google Calendar in establishment settings
3. Verify chalet has `google_calendar` field populated

### Bookings not appearing

**Cause:** RLS (Row Level Security) policies blocking access

**Solution:**
1. Check RLS policies on `bookings` table
2. For testing, temporarily disable RLS:
   ```sql
   ALTER TABLE bookings DISABLE ROW LEVEL SECURITY;
   ```
3. In production, configure proper RLS policies

### Price calculation incorrect

**Cause:** Date format or timezone issues

**Solution:**
1. Ensure dates are in ISO format (YYYY-MM-DD)
2. Check `price_per_night` field in chalets table
3. Verify calculation in `calculateBookingPrice()`

## Best Practices

1. **Always validate dates** on both client and server
2. **Double-check availability** before creating bookings
3. **Use transactions** for critical operations
4. **Log all booking operations** for audit trail
5. **Handle edge cases**:
   - Same-day bookings
   - Multi-night bookings
   - Holiday pricing (future)
6. **Test Google Calendar sync** regularly
7. **Monitor booking conflicts** and resolve quickly

## Security Considerations

1. **Use Supabase RLS** to protect booking data
2. **Validate all inputs** to prevent SQL injection
3. **Rate limit** booking API to prevent abuse
4. **Sanitize user input** (names, emails, notes)
5. **Secure Google OAuth** tokens properly
6. **Use HTTPS** for all API calls
7. **Implement CSRF protection** when adding payments

## Support

For issues or questions:
1. Check the console logs for errors
2. Review the Supabase dashboard for data issues
3. Test Google Calendar connection in establishment settings
4. Verify edge functions are deployed correctly

---

**System Status:** ✅ Functional Demo - Ready for Testing
**Payment Integration:** 🔄 Architecture Ready - Not Implemented
**Last Updated:** January 19, 2026
