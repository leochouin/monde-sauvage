# Guide Booking System - Architecture Diagrams

## System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         MONDE SAUVAGE PLATFORM                        │
│                      Guide Reservation System                         │
└──────────────────────────────────────────────────────────────────────┘

┌─────────────────┐
│   USER/CLIENT   │
│  (Web Browser)  │
└────────┬────────┘
         │
         │ Booking Request
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND LAYER                                │
├─────────────────────────────────────────────────────────────────────┤
│  GuideBookingModal.jsx         │  Booking UI Component              │
│  guideBookingService.js        │  Client-side Service Layer         │
│  DateRangePicker               │  Date/Time Selection               │
└────────┬────────────────────────────────────────────────────────────┘
         │
         │ API Calls
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     SUPABASE BACKEND                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │            EDGE FUNCTIONS (Deno Runtime)                     │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │  • create-guide-booking-event    (Create Calendar Event)     │   │
│  │  • update-guide-booking-event    (Update Calendar Event)     │   │
│  │  • delete-guide-booking-event    (Delete Calendar Event)     │   │
│  │  • guide-calendar-availability   (Check Conflicts)           │   │
│  │  • sync-guide-calendar           (Bidirectional Sync)        │   │
│  │  • refresh-google-token          (Token Management)          │   │
│  └────────┬────────────────────────────────────────────────────┘   │
│           │                                                           │
│           ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              POSTGRESQL DATABASE                             │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │  Tables:                                                      │   │
│  │  • guide_booking          (SOURCE OF TRUTH)                  │   │
│  │  • guide                  (Guide info + refresh_token)       │   │
│  │                                                               │   │
│  │  Functions:                                                   │   │
│  │  • check_guide_booking_conflict()                            │   │
│  │                                                               │   │
│  │  Views:                                                       │   │
│  │  • guide_booking_active   (Non-deleted bookings)             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                       │
└────────┬──────────────────────────────────────────────────────────┘
         │
         │ OAuth 2.0 + API Calls
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    GOOGLE CALENDAR API                               │
├─────────────────────────────────────────────────────────────────────┤
│  • Create Events                                                     │
│  • Update Events                                                     │
│  • Delete Events                                                     │
│  • List Events (for sync)                                            │
│  • Conflict Detection                                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Booking Creation Flow

```
┌────────┐
│  USER  │ Selects dates, enters info, clicks "Create Booking"
└───┬────┘
    │
    ▼
┌───────────────────────────────────────────────────────────────┐
│ 1. AVAILABILITY CHECK                                          │
│    checkGuideAvailability(guideId, startTime, endTime)        │
└───┬───────────────────────────────────────────────────────────┘
    │
    ├─────────────────────────────────────────────────────────┐
    │                                                           │
    ▼                                                           ▼
┌─────────────────────────┐                    ┌────────────────────────────┐
│ Check Database          │                    │ Check Google Calendar      │
│ (guide_booking table)   │                    │ (via API)                  │
│                         │                    │                            │
│ • Active bookings       │                    │ • All events in range      │
│ • Time overlaps         │                    │ • Unsynced events          │
└────┬────────────────────┘                    └────────┬───────────────────┘
     │                                                   │
     └───────────────────┬───────────────────────────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │ Conflicts Found?    │
              └──────┬──────────────┘
                     │
        ┌────────────┴────────────┐
        │ YES                     │ NO
        ▼                         ▼
┌──────────────────┐    ┌────────────────────────────┐
│ Show Conflicts   │    │ 2. CREATE BOOKING IN DB    │
│ Block Booking    │    │    (SOURCE OF TRUTH)       │
└──────────────────┘    └────────┬───────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────────────┐
                    │ 3. CREATE GOOGLE CALENDAR EVENT│
                    │    create-guide-booking-event  │
                    └────────┬───────────────────────┘
                             │
                             ▼
                    ┌────────────────────────────────┐
                    │ 4. LINK BOOKING ↔ EVENT       │
                    │    Save google_event_id        │
                    └────────┬───────────────────────┘
                             │
                             ▼
                    ┌────────────────────────────────┐
                    │ 5. SUCCESS!                    │
                    │    • Booking in DB             │
                    │    • Event in Calendar         │
                    │    • Linked with event_id      │
                    └────────────────────────────────┘
```

---

## Bidirectional Sync Flow

```
┌─────────────────────────────────────────────────────────────┐
│  PERIODIC TRIGGER (Manual or Scheduled)                      │
│  syncGuideBookingsWithCalendar(guideId)                     │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. FETCH DATA FROM BOTH SOURCES                              │
└───────────────────────────┬─────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
┌────────────────────────┐      ┌─────────────────────────┐
│ Database Bookings      │      │ Google Calendar Events  │
│ (guide_booking table)  │      │ (via Calendar API)      │
│                        │      │                         │
│ • All active bookings  │      │ • All events (6 months) │
│ • With google_event_id │      │ • Event IDs             │
└────────┬───────────────┘      └────────┬────────────────┘
         │                               │
         └───────────┬───────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. COMPARE & BUILD MAPS                                      │
│    calendarEventMap = Map(event_id → event)                 │
│    dbBookingMap = Map(google_event_id → booking)            │
└───────────────────────────┬─────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
┌────────────────────────┐      ┌─────────────────────────┐
│ 3a. DETECT DELETIONS   │      │ 3b. DETECT NEW EVENTS   │
│                        │      │                         │
│ In DB but NOT in Cal   │      │ In Cal but NOT in DB    │
└────────┬───────────────┘      └────────┬────────────────┘
         │                               │
         ▼                               ▼
┌────────────────────────┐      ┌─────────────────────────┐
│ Is Booking Paid?       │      │ Create New Booking      │
│                        │      │ • source = 'google'     │
│ YES → Protect          │      │ • Save event_id         │
│ NO  → Soft Delete      │      │ • status = 'confirmed'  │
└────────────────────────┘      └─────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. UPDATE SYNC TIMESTAMPS                                    │
│    synced_at = NOW() for all bookings                       │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. RETURN RESULTS                                            │
│    {                                                         │
│      deletedBookings: [ids],                                │
│      newBookings: [ids],                                    │
│      protectedBookings: [paid booking ids],                 │
│      errors: []                                             │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Conflict Detection Flow

```
┌─────────────────────────────────────────────────────────────┐
│  CHECK AVAILABILITY REQUEST                                  │
│  checkGuideAvailability(guideId, startTime, endTime)       │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 1: DATABASE CHECK                                      │
│ check_guide_booking_conflict() SQL Function                 │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │ SELECT bookings WHERE:      │
              │ • guide_id matches          │
              │ • deleted_at IS NULL        │
              │ • status NOT cancelled      │
              │ • Time ranges overlap:      │
              │   (start < new_end AND      │
              │    end > new_start)         │
              └─────────────┬───────────────┘
                            │
                ┌───────────┴───────────┐
                │                       │
                ▼                       ▼
    ┌──────────────────┐    ┌─────────────────────┐
    │ Conflicts Found  │    │ No DB Conflicts     │
    │ Return conflicts │    │ Continue to Layer 2 │
    └──────────────────┘    └──────────┬──────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 2: GOOGLE CALENDAR CHECK                              │
│ guide-calendar-availability Edge Function                   │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │ Fetch Calendar events       │
              │ • In time range             │
              │ • Active (not cancelled)    │
              │ • Not yet synced to DB      │
              └─────────────┬───────────────┘
                            │
                ┌───────────┴───────────┐
                │                       │
                ▼                       ▼
    ┌──────────────────┐    ┌─────────────────────┐
    │ Events Found     │    │ No Events Found     │
    │ Return conflicts │    │ AVAILABLE ✅        │
    └──────────────────┘    └─────────────────────┘
                │                       │
                │                       │
                └───────────┬───────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │ RETURN RESULT                │
              │ {                            │
              │   available: boolean,        │
              │   conflicts: [...],          │
              │   reason: string             │
              │ }                            │
              └─────────────────────────────┘
```

---

## Data Relationships

```
┌──────────────────────────────────────────────────────────────┐
│                      DATABASE SCHEMA                          │
└──────────────────────────────────────────────────────────────┘

┌─────────────────────┐
│      guide          │
├─────────────────────┤
│ id (PK)            │◄───────────┐
│ name                │            │
│ email               │            │
│ google_refresh_token│            │ Foreign Key
│ google_token_...    │            │
└─────────────────────┘            │
                                   │
                                   │
┌─────────────────────────────────────────────────────────────┐
│                    guide_booking                             │
│                  (SOURCE OF TRUTH)                           │
├─────────────────────────────────────────────────────────────┤
│ id (PK)                                                      │
│ guide_id (FK) ──────────────────────────────────────────────┘
│ start_time                                                   │
│ end_time                                                     │
│ status                   ┐                                   │
│ source                   │                                   │
│ google_event_id ─────────┼────────────────────┐             │
│ customer_name            │ Business            │             │
│ customer_email           │ Logic               │ Links to    │
│ customer_phone           │ Fields              │ Google      │
│ trip_type                │                     │ Calendar    │
│ number_of_people         │                     │             │
│ notes                    │                     │             │
│ is_paid                  │ Payment             │             │
│ payment_amount           │ Fields              │             │
│ payment_reference        │                     │             │
│ created_at               │                     │             │
│ updated_at               │ Audit               │             │
│ synced_at                │ Trail               │             │
│ deleted_at               │                     │             │
└──────────────────────────┴─────────────────────┴─────────────┘
                                                  │
                                                  │
                                                  ▼
┌─────────────────────────────────────────────────────────────┐
│              GOOGLE CALENDAR API                             │
├─────────────────────────────────────────────────────────────┤
│  Calendar Event:                                             │
│  • id (matches google_event_id)                             │
│  • summary (customer_name)                                   │
│  • start.dateTime (start_time)                              │
│  • end.dateTime (end_time)                                  │
│  • description (notes, booking_id)                          │
│  • attendees (customer_email)                               │
└─────────────────────────────────────────────────────────────┘
```

---

## State Transitions

```
┌─────────────────────────────────────────────────────────────┐
│                BOOKING STATUS LIFECYCLE                      │
└─────────────────────────────────────────────────────────────┘

                    ┌─────────────┐
                    │   CREATED   │
                    │ status = ?  │
                    └──────┬──────┘
                           │
           ┌───────────────┴───────────────┐
           │                               │
           ▼                               ▼
    ┌─────────────┐              ┌──────────────────┐
    │  'pending'  │              │ 'confirmed'      │
    │             │              │ (from Google Cal)│
    │ From system │              └────────┬─────────┘
    └──────┬──────┘                       │
           │                              │
           │ Payment received             │
           ▼                              │
    ┌─────────────┐                       │
    │ 'confirmed' │◄──────────────────────┘
    │             │
    │ (or 'booked')│
    └──────┬──────┘
           │
           │ User/Guide action
           ▼
    ┌─────────────┐
    │ 'cancelled' │
    │             │
    │ Still in DB │
    └─────────────┘

           │ Calendar sync detects deletion
           ▼
    ┌─────────────┐
    │  'deleted'  │
    │             │
    │ Soft delete │
    │ (in DB)     │
    └─────────────┘

NOTES:
• 'pending' → Awaiting payment/confirmation
• 'confirmed' or 'booked' → Active booking
• 'cancelled' → Explicitly cancelled
• 'deleted' → Removed from Calendar (soft delete)
• All states preserve in database (no hard deletes)
```

---

## Security Layers

```
┌─────────────────────────────────────────────────────────────┐
│                   SECURITY ARCHITECTURE                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ LAYER 1: INPUT VALIDATION                                    │
├─────────────────────────────────────────────────────────────┤
│ • Email format validation                                    │
│ • Date range validation (end > start)                       │
│ • Required fields enforced                                   │
│ • Type checking (numbers, strings, etc.)                    │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 2: CONFLICT PREVENTION                                 │
├─────────────────────────────────────────────────────────────┤
│ • Database overlap detection                                 │
│ • Google Calendar conflict check                            │
│ • Double-validation before commit                           │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 3: PAYMENT PROTECTION                                  │
├─────────────────────────────────────────────────────────────┤
│ IF is_paid = true:                                          │
│ • Time modification requires allowPaidModification flag      │
│ • Cancellation requires allowPaidCancellation flag          │
│ • Sync cannot delete (added to protectedBookings)           │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 4: DATABASE CONSTRAINTS                                │
├─────────────────────────────────────────────────────────────┤
│ • Foreign key to guide (CASCADE on delete)                  │
│ • CHECK: end_time > start_time                              │
│ • CHECK: status IN (valid values)                           │
│ • CHECK: source IN ('system', 'google')                     │
│ • NOT NULL on critical fields                               │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 5: SOFT DELETION                                       │
├─────────────────────────────────────────────────────────────┤
│ • Never hard delete bookings                                 │
│ • Set deleted_at timestamp                                   │
│ • Preserve audit trail                                       │
│ • Can be restored if needed                                  │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ LAYER 6: OAUTH SECURITY                                      │
├─────────────────────────────────────────────────────────────┤
│ • Google refresh tokens stored encrypted                    │
│ • Access tokens cached with expiry                          │
│ • Automatic token refresh                                    │
│ • No passwords stored                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Integration Points

```
┌─────────────────────────────────────────────────────────────┐
│              SYSTEM INTEGRATION POINTS                       │
└─────────────────────────────────────────────────────────────┘

┌──────────────────┐
│  React Frontend  │
└────────┬─────────┘
         │
         │ Import & Use
         ▼
┌─────────────────────────────────────────────────────────────┐
│  guideBookingService.js                                      │
│  • checkGuideAvailability()                                  │
│  • createGuideBooking()                                      │
│  • updateGuideBooking()                                      │
│  • cancelGuideBooking()                                      │
│  • getGuideBookings()                                        │
│  • syncGuideBookingsWithCalendar()                          │
└────────┬────────────────────────────────────────────────────┘
         │
         │ Fetch API
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Supabase Edge Functions                                     │
│  ${SUPABASE_URL}/functions/v1/                              │
│  • create-guide-booking-event                               │
│  • update-guide-booking-event                               │
│  • delete-guide-booking-event                               │
│  • guide-calendar-availability                              │
│  • sync-guide-calendar                                      │
│  • refresh-google-token                                     │
└────────┬────────────────────────────────────────────────────┘
         │
         ├──────────────────────────┬──────────────────────────┐
         │                          │                          │
         ▼                          ▼                          ▼
┌─────────────────┐  ┌──────────────────────┐  ┌──────────────────┐
│  Supabase DB    │  │  Google Calendar API │  │  Token Refresh   │
│  guide_booking  │  │  OAuth 2.0           │  │  Automatic       │
│  (Source)       │  │  Events CRUD         │  │  Management      │
└─────────────────┘  └──────────────────────┘  └──────────────────┘

FUTURE EXTENSIONS (Ready to Add):
┌──────────────────────────────────────────────────────────────┐
│ • Payment Gateway (Stripe/PayPal)                            │
│ • Email Service (SendGrid/Mailgun)                          │
│ • SMS Service (Twilio)                                       │
│ • Analytics Dashboard                                        │
│ • Admin Panel                                                │
│ • Mobile App (React Native)                                 │
└──────────────────────────────────────────────────────────────┘
```

---

These diagrams provide a visual understanding of the complete guide booking system architecture, workflows, and security model.
