# System Flow Diagram - Monde Sauvage Reservation System

## 📊 Complete User Journey

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER JOURNEY                             │
└─────────────────────────────────────────────────────────────────┘

1️⃣ USER BROWSES CHALETS
    │
    ├─► Opens map in Monde Sauvage app
    ├─► Sees chalet markers on map
    └─► Clicks on chalet marker
         │
         └─► Query Modal opens with chalet list

2️⃣ USER VIEWS CHALET DETAILS
    │
    ├─► Clicks "Voir plus" on chalet card
    └─► Chalet Detail Modal opens
         │
         ├─► Image gallery loads
         ├─► Description shown
         ├─► Amenities displayed
         └─► Reservation section visible

3️⃣ USER SELECTS DATES
    │
    ├─► Picks check-in date
    └─► Picks check-out date
         │
         └─► AUTOMATIC AVAILABILITY CHECK TRIGGERED
              │
              ├─► Frontend: checkChaletAvailability()
              │    │
              │    ├─► Step 1: Check Supabase Database
              │    │    │
              │    │    └─► Query: SELECT * FROM bookings
              │    │         WHERE chalet_id = [id]
              │    │         AND status = 'confirmed'
              │    │         AND (overlap check)
              │    │
              │    └─► Step 2: Check Google Calendar (if connected)
              │         │
              │         └─► Edge Function: chalet-calendar-events
              │              │
              │              ├─► Gets Google Calendar events
              │              ├─► Syncs to bookings table
              │              └─► Returns overlapping events
              │
              └─► RESULT: Available ✅ or Unavailable ❌
                   │
                   ├─► If Available:
                   │    ├─► Show green success message
                   │    ├─► Calculate price breakdown
                   │    └─► Enable "Réserver" button
                   │
                   └─► If Unavailable:
                        ├─► Show red error message
                        ├─► Explain reason
                        └─► Disable "Réserver" button

4️⃣ USER FILLS INFORMATION
    │
    ├─► Enters full name
    ├─► Enters email
    └─► (Optional) Adds notes

5️⃣ USER SUBMITS RESERVATION
    │
    └─► Clicks "Réserver" button
         │
         ├─► Frontend: createBooking()
         │    │
         │    ├─► Double-checks availability (safety)
         │    │
         │    └─► Inserts into Supabase:
         │         │
         │         └─► INSERT INTO bookings
         │              chalet_id: [UUID]
         │              start_date: [date]
         │              end_date: [date]
         │              status: 'pending' ← PAYMENT READY
         │              source: 'website'
         │              customer_name: [name]
         │              customer_email: [email]
         │              notes: [text]
         │
         ├─► Success! ✅
         │    │
         │    └─► Show success message
         │         "Réservation confirmée!"
         │
         └─► Error ❌
              └─► Show error message
                   "Erreur lors de la réservation"

6️⃣ FUTURE: PAYMENT INTEGRATION
    │
    └─► After createBooking() success:
         │
         ├─► Call: initiatePayment()
         │    │
         │    ├─► Redirect to Stripe/Square
         │    └─► User completes payment
         │
         ├─► On Success:
         │    └─► confirmBooking(bookingId)
         │         └─► UPDATE bookings
         │              SET status = 'confirmed'
         │              WHERE id = [bookingId]
         │
         └─► On Failure:
              └─► cancelBooking(bookingId)
                   └─► UPDATE bookings
                        SET status = 'cancelled'
                        WHERE id = [bookingId]
```

---

## 🔄 Availability Check Flow (Detailed)

```
┌──────────────────────────────────────────────────────────────────┐
│              AVAILABILITY CHECK ALGORITHM                         │
└──────────────────────────────────────────────────────────────────┘

Input: chaletId, startDate, endDate
    │
    ▼
┌──────────────────────────────────────┐
│  STEP 1: Validate Dates              │
│  ────────────────────────            │
│  • startDate >= today?               │
│  • endDate > startDate?              │
│  • Valid date format?                │
└──────────────────────────────────────┘
    │
    ├─► ❌ Invalid → Return error
    │
    ▼
┌──────────────────────────────────────┐
│  STEP 2: Check Database              │
│  ────────────────────────            │
│  Query Supabase bookings table       │
│                                      │
│  SELECT * FROM bookings              │
│  WHERE chalet_id = [id]              │
│    AND status = 'confirmed'          │
│    AND start_date < [endDate]        │
│    AND end_date > [startDate]        │
└──────────────────────────────────────┘
    │
    ├─► Found bookings? → ❌ UNAVAILABLE
    │                      "Dates already booked in database"
    │
    ▼
┌──────────────────────────────────────┐
│  STEP 3: Get Chalet Info             │
│  ────────────────────────            │
│  SELECT google_calendar              │
│  FROM chalets                        │
│  WHERE key = [chaletId]              │
└──────────────────────────────────────┘
    │
    ├─► No google_calendar? → Skip to ✅ AVAILABLE
    │
    ▼
┌──────────────────────────────────────┐
│  STEP 4: Check Google Calendar       │
│  ────────────────────────            │
│  Call Edge Function:                 │
│  /chalet-calendar-events             │
│    ?calendar_id=[id]                 │
│    &chalet_id=[id]                   │
│    &start_date=[date]                │
│    &end_date=[date]                  │
└──────────────────────────────────────┘
    │
    ├─► Edge Function Flow:
    │    │
    │    ├─► Get establishment's Google token
    │    ├─► Fetch events from Google Calendar API
    │    ├─► Sync events to bookings table
    │    └─► Return overlapping events
    │
    ├─► Found events? → ❌ UNAVAILABLE
    │                    "Dates already booked in Google Calendar"
    │
    ├─► Connection error? → ⚠️ Continue (rely on DB only)
    │
    ▼
┌──────────────────────────────────────┐
│  RESULT: ✅ AVAILABLE                │
│  ────────────────────────            │
│  No conflicts found                  │
│  Return { available: true }          │
└──────────────────────────────────────┘
```

---

## 🗄️ Database Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                    DATABASE SCHEMA                               │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────┐
│          CHALETS                 │
├──────────────────────────────────┤
│ key (UUID) ← PRIMARY KEY         │
│ Name (text)                      │
│ Description (text)               │
│ nb_personnes (int)               │
│ price_per_night (numeric) ⭐     │
│ etablishment_id (UUID)           │
│ google_calendar (text)           │
│ Image (text)                     │
│ latitude (numeric)               │
│ longitude (numeric)              │
└──────────────────────────────────┘
           │
           │ Referenced by
           │
           ▼
┌──────────────────────────────────┐
│          BOOKINGS                │
├──────────────────────────────────┤
│ id (serial) ← PRIMARY KEY        │
│ chalet_id (UUID) ────┘ FK        │
│ start_date (date)                │
│ end_date (date)                  │
│ status (text) ⭐                 │
│   • 'pending'                    │
│   • 'confirmed'                  │
│   • 'paid'                       │
│   • 'cancelled'                  │
│ source (text) ⭐                 │
│   • 'google'                     │
│   • 'website'                    │
│ customer_name (text)             │
│ customer_email (text)            │
│ google_event_id (text)           │
│ notes (text)                     │
│ created_at (timestamp)           │
└──────────────────────────────────┘

⭐ = Critical for system logic
```

---

## 🔀 Booking Status State Machine

```
┌─────────────────────────────────────────────────────────────────┐
│                 BOOKING STATUS WORKFLOW                          │
└─────────────────────────────────────────────────────────────────┘

Website Bookings:
─────────────────

    ┌──────────────┐
    │   PENDING    │ ← Initial state when user submits form
    └──────────────┘
          │
          │ [Future: Payment successful]
          ▼
    ┌──────────────┐
    │  CONFIRMED   │ ← After payment processed
    └──────────────┘
          │
          ├──► [Payment fails] ──► ┌──────────────┐
          │                         │  CANCELLED   │
          │                         └──────────────┘
          │
          │ [Future: Payment completed]
          ▼
    ┌──────────────┐
    │     PAID     │ ← Final success state
    └──────────────┘


Google Calendar Bookings:
──────────────────────────

    ┌──────────────┐
    │  CONFIRMED   │ ← Direct state from sync
    └──────────────┘
          │
          └──► Always confirmed (external bookings)


Transitions:
───────────

pending → confirmed   (confirmBooking())
pending → cancelled   (cancelBooking())
confirmed → paid      (Future: markAsPaid())
* → cancelled         (Admin cancellation)
```

---

## 🌐 System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│              SYSTEM COMPONENTS                                   │
└─────────────────────────────────────────────────────────────────┘

Frontend (React)
────────────────
│
├─► Components:
│   ├─► MapApp.jsx           (Shows chalets on map)
│   ├─► queryModal.jsx       (Lists available chalets)
│   └─► chaletDetailModal.jsx ← NEW RESERVATION UI
│        │
│        ├─► Date pickers
│        ├─► Availability status
│        ├─► Price breakdown
│        └─► Guest form
│
├─► Services:
│   └─► bookingService.js ← NEW BOOKING LOGIC
│        │
│        ├─► checkChaletAvailability()
│        ├─► calculateBookingPrice()
│        ├─► createBooking()
│        ├─► confirmBooking()
│        └─► cancelBooking()
│
└─► Styles:
    └─► App.css (Reservation section styles)


Backend (Supabase)
──────────────────
│
├─► Database:
│   ├─► chalets table
│   └─► bookings table
│
├─► Edge Functions:
│   ├─► chalet-calendar-events ← UPDATED
│   │    │
│   │    ├─► Fetches Google Calendar events
│   │    ├─► Syncs to bookings table
│   │    └─► Supports date range queries
│   │
│   └─► refresh-google-token
│        │
│        └─► Handles OAuth token refresh
│
└─► Authentication:
    └─► Supabase Auth (for establishment owners)


External Services
─────────────────
│
└─► Google Calendar API
     │
     ├─► Stores external bookings
     ├─► Syncs to Monde Sauvage
     └─► Prevents double bookings


Data Flow:
──────────

User Action
    ↓
Frontend (React)
    ↓
bookingService.js
    ↓
Supabase (Database + Edge Functions)
    ↓
Google Calendar API (if needed)
    ↓
Response back to user
```

---

## 🎯 Key Integration Points

```
1. USER → FRONTEND
   └─► React components handle UI interactions

2. FRONTEND → BOOKING SERVICE
   └─► Service layer handles business logic

3. BOOKING SERVICE → SUPABASE DATABASE
   └─► Direct queries for bookings and chalets

4. BOOKING SERVICE → EDGE FUNCTION
   └─► Calendar availability checks

5. EDGE FUNCTION → GOOGLE CALENDAR
   └─► External event synchronization

6. GOOGLE CALENDAR → BOOKINGS TABLE
   └─► Automatic sync of external bookings

7. BOOKINGS TABLE → AVAILABILITY CHECK
   └─► Both website and Google bookings block dates
```

---

## 📝 Notes

- All date overlap logic uses: `start < end_compare AND end > start_compare`
- Google Calendar is optional - system works without it
- Payment integration is architected but not implemented
- Status field is extensible for future workflows
- Source field enables different handling of booking origins

---

**Created:** January 19, 2026  
**System:** Monde Sauvage Reservation v1.0  
**Purpose:** Visual reference for system architecture
