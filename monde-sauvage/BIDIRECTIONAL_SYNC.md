# 🔄 Bidirectional Sync Architecture

## Database is the Source of Truth

```
┌─────────────────────────────────────────────────────────────────────┐
│                    BOOKING FLOW WITH SYNC                            │
└─────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════
SCENARIO 1: Website Booking (Database → Google Calendar)
═══════════════════════════════════════════════════════════════════════

    👤 User
     │
     ├─► Selects dates in chalet detail modal
     ├─► Fills name, email, notes
     └─► Clicks "Réserver"
          │
          ▼
    📝 CREATE BOOKING IN DATABASE (Source of Truth)
     │
     ├─► INSERT INTO bookings
     │    • chalet_id: [uuid]
     │    • start_date: 2026-01-25
     │    • end_date: 2026-01-28
     │    • status: "pending" ⭐
     │    • source: "website" ⭐
     │    • customer_name: "John Doe"
     │    • customer_email: "john@example.com"
     │    • google_event_id: null (for now)
     │
     ▼
    ✅ BOOKING SAVED (ID: 123)
     │
     │ (Non-blocking - booking is valid even if next step fails)
     │
     ▼
    🔄 SYNC TO GOOGLE CALENDAR
     │
     ├─► Call: create-booking-calendar-event
     │    │
     │    ├─► Get establishment's Google token
     │    ├─► Create event in Google Calendar:
     │    │    • Title: "Chalet 1 - John Doe"
     │    │    • Description: Booking details
     │    │    • All-day event: Jan 25-28
     │    │    • Attendee: john@example.com
     │    │    • Metadata: booking_id=123, source=website
     │    │
     │    └─► Returns: event_id="abc123xyz"
     │
     ▼
    📅 EVENT CREATED IN GOOGLE CALENDAR
     │
     └─► UPDATE bookings
          SET google_event_id = "abc123xyz"
          WHERE id = 123

    ✅ RESULT: Booking exists in BOTH database AND Google Calendar


═══════════════════════════════════════════════════════════════════════
SCENARIO 2: Google Calendar Booking (Google Calendar → Database)
═══════════════════════════════════════════════════════════════════════

    👤 External User (or owner)
     │
     └─► Creates event directly in Google Calendar
          │
          └─► Event: "Famille Tremblay"
               Dates: Feb 10-15, 2026
          
          ▼
    📅 EVENT IN GOOGLE CALENDAR
     │
     │ (Triggered by: periodic sync or chalet horaire modal)
     │
     ▼
    🔄 SYNC TO DATABASE
     │
     ├─► Call: chalet-calendar-events
     │    │
     │    ├─► Fetch events from Google Calendar
     │    ├─► For each event:
     │    │    │
     │    │    ├─► Check if exists: google_event_id match?
     │    │    │
     │    │    ├─► If NEW event:
     │    │    │    └─► INSERT INTO bookings
     │    │    │         • chalet_id: [uuid]
     │    │    │         • start_date: 2026-02-10
     │    │    │         • end_date: 2026-02-15
     │    │    │         • status: "confirmed" ⭐
     │    │    │         • source: "google" ⭐
     │    │    │         • customer_name: "Famille Tremblay"
     │    │    │         • google_event_id: "def456uvw"
     │    │    │
     │    │    └─► If EXISTING event:
     │    │         └─► UPDATE bookings (only if source="google")
     │    │
     │    └─► Never modifies source="website" bookings
     │
     ▼
    ✅ RESULT: Event synced to database with source="google"


═══════════════════════════════════════════════════════════════════════
SCENARIO 3: Availability Check (Consults Both Sources)
═══════════════════════════════════════════════════════════════════════

    👤 User
     │
     └─► Selects dates: March 1-5, 2026
          │
          ▼
    🔍 CHECK AVAILABILITY
     │
     ├─► Step 1: Check Database (Source of Truth)
     │    │
     │    └─► SELECT * FROM bookings
     │         WHERE chalet_id = [uuid]
     │         AND status = 'confirmed'
     │         AND start_date < '2026-03-05'
     │         AND end_date > '2026-03-01'
     │
     ├─► Step 2: Check Google Calendar (if connected)
     │    │
     │    └─► Call: chalet-calendar-events
     │         • Fetches events for date range
     │         • Syncs any new events to database
     │         • Returns overlapping events
     │
     └─► Combine Results
          │
          ├─► If ANY bookings found → ❌ UNAVAILABLE
          └─► If NO bookings found → ✅ AVAILABLE


═══════════════════════════════════════════════════════════════════════
SCENARIO 4: Cancellation (Removes from Both)
═══════════════════════════════════════════════════════════════════════

    👤 User/Admin
     │
     └─► Cancels booking ID: 123
          │
          ▼
    🚫 CANCEL BOOKING
     │
     ├─► UPDATE bookings
     │    SET status = 'cancelled'
     │    WHERE id = 123
     │
     └─► Get google_event_id from booking
          │
          ├─► If google_event_id exists:
          │    │
          │    └─► Call: delete-booking-calendar-event
          │         │
          │         └─► DELETE event from Google Calendar
          │              (keeps calendar in sync)
          │
          └─► If no google_event_id:
               └─► Done (was never synced)

    ✅ RESULT: Booking cancelled in database, event deleted from calendar


═══════════════════════════════════════════════════════════════════════
SCENARIO 5: Payment Confirmation (Future)
═══════════════════════════════════════════════════════════════════════

    👤 User
     │
     └─► Completes payment via Stripe
          │
          ▼
    💳 PAYMENT SUCCESSFUL
     │
     ├─► UPDATE bookings
     │    SET status = 'confirmed'
     │    WHERE id = 123
     │
     └─► Update Google Calendar event (optional)
          │
          └─► Change title to "[CONFIRMED] Chalet 1 - John Doe"

    ✅ RESULT: Status updated, payment recorded, calendar reflects status
```

---

## 🔑 Key Principles

### 1. Database is Source of Truth
- All bookings must exist in `bookings` table first
- Google Calendar is a **mirror**, not the source
- If sync fails, booking is still valid

### 2. Non-Blocking Sync
- Website bookings don't wait for Google Calendar
- User gets immediate confirmation
- Sync happens in background
- Failures are logged but don't block users

### 3. Conflict Prevention
- Availability check consults BOTH sources
- Database check is primary
- Google Calendar check catches external bookings
- Both must be clear for "available" status

### 4. Status Distinction
```
source="website" + status="pending"    → User booking, awaiting payment
source="website" + status="confirmed"  → User booking, payment received
source="google"  + status="confirmed"  → External booking (always confirmed)
```

### 5. Sync Direction Rules

**Website Booking:**
```
Database → Google Calendar
• Created in DB with source="website"
• Synced TO Calendar with booking_id reference
• google_event_id stored in DB for link
```

**External Booking:**
```
Google Calendar → Database
• Created in Calendar externally
• Synced FROM Calendar with source="google"
• Never modified by website (read-only)
```

---

## 🔄 Data Flow Summary

```
┌─────────────────────────────────────────────────┐
│           BOOKINGS TABLE                        │
│         (Source of Truth)                       │
│                                                 │
│  ┌────────────────────────────────────┐        │
│  │ id: 1                               │        │
│  │ status: "pending"                   │        │
│  │ source: "website"                   │  ←─────┼─── Website Bookings
│  │ google_event_id: "abc123"           │        │
│  └────────────────────────────────────┘        │
│                                                 │
│  ┌────────────────────────────────────┐        │
│  │ id: 2                               │        │
│  │ status: "confirmed"                 │        │
│  │ source: "google"                    │  ←─────┼─── External Bookings
│  │ google_event_id: "def456"           │        │
│  └────────────────────────────────────┘        │
└─────────────────────────────────────────────────┘
                    ↕
              (Bidirectional Sync)
                    ↕
┌─────────────────────────────────────────────────┐
│         GOOGLE CALENDAR                         │
│           (Mirror)                              │
│                                                 │
│  📅 Event: "Chalet 1 - John Doe"               │
│     Dates: Jan 25-28                            │
│     Metadata: booking_id=1                      │
│                                                 │
│  📅 Event: "Famille Tremblay"                  │
│     Dates: Feb 10-15                            │
│     Created externally                          │
└─────────────────────────────────────────────────┘
```

---

**Last Updated:** January 19, 2026  
**System:** Monde Sauvage v1.0 with Bidirectional Sync
