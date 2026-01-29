# Quick Demo Guide - Monde Sauvage Reservation System

## 🚀 How to Test the Reservation System

### Prerequisites
1. Make sure the development server is running
2. You should have at least one chalet in the database
3. The chalet should have `price_per_night` set

### Step-by-Step Demo

#### 1. Open the Application
```bash
cd monde-sauvage
npm run dev
```

#### 2. Access a Chalet

**Option A: Via Map**
- Open the map view
- Click on any chalet marker
- This should open the chalet query modal
- Click on a chalet card to open the detail modal

**Option B: Direct Database Test**
- Use the chalet with ID: `f74c7602-bb67-448b-8ff8-7748d663a9a5` (Chalet 1)
- Price: 250$ per night

#### 3. Test Reservation Flow

1. **See the Chalet Details**
   - Image gallery
   - Description
   - Amenities
   - Price per night

2. **Scroll to Reservation Section**
   - You'll see "Réserver ce chalet" section
   - Two date pickers (Arrivée/Départ)

3. **Select Dates**
   ```
   Example:
   Arrivée: January 25, 2026
   Départ: January 28, 2026
   ```

4. **Watch Real-Time Availability**
   - Status appears automatically
   - "🔄 Vérification de la disponibilité..."
   - Then either:
     - ✅ "Disponible pour ces dates" (green)
     - ❌ "Non disponible: [reason]" (red)

5. **See Price Breakdown** (if available)
   ```
   250$ × 3 nuits     750$ CAD
   ─────────────────────────────
   Total              750$ CAD
   ```

6. **Fill Guest Information**
   - Nom complet: "Jean Tremblay"
   - Email: "jean@example.com"
   - Notes: "Arrivée tardive possible"

7. **Click "Réserver"**
   - Button shows "Réservation en cours..."
   - Success message appears:
     ```
     ✅
     Réservation confirmée!
     Votre demande de réservation a été enregistrée avec succès.
     ```

#### 4. Verify in Database

Open Supabase dashboard and check `bookings` table:

```sql
SELECT * FROM bookings WHERE customer_email = 'jean@example.com' ORDER BY created_at DESC LIMIT 1;
```

You should see:
```
chalet_id: f74c7602-bb67-448b-8ff8-7748d663a9a5
start_date: 2026-01-25
end_date: 2026-01-28
status: pending
source: website
customer_name: Jean Tremblay
customer_email: jean@example.com
```

### 🧪 Test Scenarios

#### Scenario 1: Happy Path (Available Dates)
- Select future dates that are not booked
- Fill form
- Submit
- ✅ Should succeed

#### Scenario 2: Past Dates
- Try to select a past date
- ❌ Should show: "La date d'arrivée ne peut pas être dans le passé"

#### Scenario 3: Invalid Date Range
- Check-out before check-in
- ❌ Should show: "La date de départ doit être après la date d'arrivée"

#### Scenario 4: Already Booked Dates
1. Create a booking in database:
   ```sql
   INSERT INTO bookings (chalet_id, start_date, end_date, status, source, customer_name, customer_email)
   VALUES (
     'f74c7602-bb67-448b-8ff8-7748d663a9a5',
     '2026-02-10',
     '2026-02-15',
     'confirmed',
     'website',
     'Existing Guest',
     'existing@example.com'
   );
   ```
2. Try to book overlapping dates (e.g., Feb 12-14)
3. ❌ Should show: "Non disponible: Dates déjà réservées"

#### Scenario 5: Google Calendar Conflict
1. Add an event to the chalet's Google Calendar (if connected)
2. Try to book those dates on the website
3. ❌ Should show: "Non disponible: Dates déjà réservées"

### 🔍 Debugging Tips

#### Check Console Logs

Open browser DevTools (F12) and look for:
```
🔍 Checking availability for chalet: [id] from [date] to [date]
✅ Chalet is available!
📝 Creating booking: [data]
✅ Booking created successfully: [booking]
```

Or error messages:
```
❌ Error checking bookings: [error]
❌ Error creating booking: [error]
```

#### Check Network Requests

In DevTools Network tab, you should see:
1. Request to Supabase `bookings` table (checking availability)
2. Request to `chalet-calendar-events` function (if Google Calendar is connected)
3. POST to Supabase `bookings` table (creating reservation)

#### Common Issues

**"Failed to check booking availability"**
- Check Supabase connection
- Verify `bookings` table exists
- Check console for detailed error

**"Failed to fetch chalet information"**
- Verify chalet exists in database
- Check that you're using the correct ID field (`key`)

**Availability always shows "unavailable"**
- Check if there are existing bookings blocking the dates
- Verify overlap logic is working correctly
- Test with far-future dates to isolate the issue

**Price not showing**
- Verify `price_per_night` is set in `chalets` table
- Check date format is correct
- Verify `calculateBookingPrice()` is being called

### 📊 Sample Test Data

Use this data to populate your database for testing:

```sql
-- Sample Chalet
UPDATE chalets 
SET 
  price_per_night = 250,
  nb_personnes = 6,
  Description = 'Beautiful chalet with lake view'
WHERE key = 'f74c7602-bb67-448b-8ff8-7748d663a9a5';

-- Sample Booking (blocks March 1-5, 2026)
INSERT INTO bookings (chalet_id, start_date, end_date, status, source, customer_name, customer_email)
VALUES (
  'f74c7602-bb67-448b-8ff8-7748d663a9a5',
  '2026-03-01',
  '2026-03-05',
  'confirmed',
  'website',
  'Test Booking',
  'test@example.com'
);
```

### 🎯 Expected Behavior Summary

| Action | Expected Result |
|--------|----------------|
| Select valid future dates | ✅ Shows "Disponible" + price |
| Select past dates | ❌ Shows error message |
| Select invalid range | ❌ Shows error message |
| Select booked dates | ❌ Shows "Non disponible" |
| Submit valid reservation | ✅ Success message + DB entry |
| Submit without dates | ❌ Button disabled |
| Submit without name/email | ❌ Form validation error |

### 🔄 Testing Google Calendar Integration

If you have Google Calendar connected:

1. **Setup**
   - Go to establishment settings
   - Connect Google Calendar
   - Create a calendar for the chalet (if not exists)

2. **Add Event in Google Calendar**
   - Open Google Calendar
   - Create event on chalet's calendar
   - Set date range (e.g., March 10-15, 2026)

3. **Test in Website**
   - Wait a moment for sync (or refresh)
   - Try to book March 10-15
   - Should show "Non disponible"

4. **Verify Sync**
   Check database:
   ```sql
   SELECT * FROM bookings 
   WHERE source = 'google' 
   AND chalet_id = 'f74c7602-bb67-448b-8ff8-7748d663a9a5';
   ```

### 💡 Pro Tips

1. **Use Browser DevTools** to inspect the reservation form state
2. **Check Supabase Dashboard** to verify data in real-time
3. **Test edge cases** like same-day bookings, long-term bookings
4. **Clear browser cache** if you see stale data
5. **Use different email addresses** for multiple test bookings

### 📝 Demo Script for Stakeholders

**Introduction (30 seconds)**
"Today I'll show you our new online reservation system for Monde Sauvage chalets."

**Show Chalet Details (30 seconds)**
"Users can browse chalets and see details, photos, and amenities."

**Demonstrate Reservation (1 minute)**
"To make a reservation, they simply select check-in and check-out dates. The system checks availability in real-time against both our database and Google Calendar."

**Show Price Calculation (30 seconds)**
"The price is calculated automatically based on the number of nights."

**Submit Reservation (30 seconds)**
"After filling in their information, they can reserve the chalet. The reservation is saved with a 'pending' status."

**Future Payment Integration (30 seconds)**
"The system is architected to easily add payment processing. When we integrate Stripe or another payment provider, pending reservations will become confirmed after successful payment."

**Show Database (30 seconds)**
"Here you can see the reservation in our database with all the details."

---

**Last Updated:** January 19, 2026  
**System Version:** v1.0 Demo
