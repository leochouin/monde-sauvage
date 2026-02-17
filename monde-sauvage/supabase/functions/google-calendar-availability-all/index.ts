import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Helper function to check if two time ranges overlap
// Handles both datetime strings (2026-01-28T08:00:00) and date-only strings (2026-01-28)
function doTimesOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
  // Normalize date-only strings to full day ranges
  // If start2 is just a date (no T), treat it as midnight to midnight (full day booking)
  const normalizeToStart = (dateStr: string): Date => {
    if (!dateStr.includes('T')) {
      return new Date(`${dateStr}T00:00:00`);
    }
    return new Date(dateStr);
  };
  
  const normalizeToEnd = (dateStr: string): Date => {
    if (!dateStr.includes('T')) {
      return new Date(`${dateStr}T23:59:59`);
    }
    return new Date(dateStr);
  };
  
  const s1 = normalizeToStart(start1).getTime();
  const e1 = normalizeToEnd(end1).getTime();
  const s2 = normalizeToStart(start2).getTime();
  const e2 = normalizeToEnd(end2).getTime();
  
  console.log(`Overlap check: Event [${new Date(s1).toISOString()} - ${new Date(e1).toISOString()}] vs Booking [${new Date(s2).toISOString()} - ${new Date(e2).toISOString()}]`);
  
  const overlaps = s1 < e2 && e1 > s2;
  console.log(`  -> Overlaps: ${overlaps}`);
  return overlaps;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const url = new URL(req.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");

  if (!start || !end) {
    return new Response(JSON.stringify({ error: "Missing start or end" }), { 
      status: 400,
      headers: corsHeaders 
    });
  }

  // Convert YYYY-MM-DD to RFC3339 format (YYYY-MM-DDTHH:MM:SSZ)
  const startISO = start.includes('T') ? start : `${start}T00:00:00Z`;
  const endISO = end.includes('T') ? end : `${end}T23:59:59Z`;
  
  console.log(`Date conversion: ${start} -> ${startISO}, ${end} -> ${endISO}`);

  // 1️⃣ Fetch all guides that connected Google Calendar
  const { data: guides } = await supabase
    .from("guide")
    .select("id, name, google_refresh_token, availability_calendar_id")
    .not("google_refresh_token", "is", null);

  // 2️⃣ Fetch ALL existing bookings for all guides in the date range (pending, confirmed)
  // We exclude cancelled and deleted bookings
  const { data: existingBookings, error: bookingsError } = await supabase
    .from("guide_booking")
    .select("guide_id, start_time, end_time, status")
    .gte("end_time", start) // Use the original date string for comparison
    .lte("start_time", end)
    .neq("status", "cancelled")
    .neq("status", "deleted");

  if (bookingsError) {
    console.error("Error fetching existing bookings:", bookingsError);
  }

  console.log("Raw existing bookings:", existingBookings);
  console.log("Total bookings found:", existingBookings?.length || 0);

  // Create a map of guide_id -> array of booked time ranges
  const bookedSlotsMap = new Map<string, Array<{start: string, end: string, status: string}>>();
  if (existingBookings) {
    for (const booking of existingBookings) {
      const guideBookings = bookedSlotsMap.get(booking.guide_id) || [];
      guideBookings.push({
        start: booking.start_time,
        end: booking.end_time,
        status: booking.status
      });
      bookedSlotsMap.set(booking.guide_id, guideBookings);
    }
  }
  console.log("Existing bookings by guide:", Object.fromEntries(bookedSlotsMap));

  const results: any[] = [];

  for (const guide of guides) {
    try {
      // 3️⃣ Exchange refresh token → access token
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: guide.google_refresh_token,
          grant_type: "refresh_token",
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) continue;

      const calendarId = guide.availability_calendar_id;
      if (!calendarId) {
        console.log(`Guide ${guide.id} (${guide.name}) has no calendar ID`);
        continue;
      }

      console.log(`Fetching events for guide ${guide.id} (${guide.name}), calendar: ${calendarId}`);
      console.log(`Date range: ${startISO} to ${endISO}`);

      // 4️⃣ Fetch availability events from Google Calendar
      const eventsRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(startISO)}&timeMax=${encodeURIComponent(endISO)}`,
        {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
          },
        }
      );

      console.log(`Events API response status: ${eventsRes.status}`);
      const events = await eventsRes.json();
      console.log(`Events response:`, JSON.stringify(events, null, 2));

      if (!eventsRes.ok) {
        console.error(`Calendar API error for guide ${guide.id}:`, events);
        results.push({
          guide_id: guide.id,
          name: guide.name,
          events: [],
          available_events: [],
          is_available: false,
          error: events.error?.message || "Calendar API error",
        });
        continue;
      }

      // 5️⃣ Check if the guide is fully booked for the entire requested range
      const guideBookedSlots = bookedSlotsMap.get(guide.id) || [];
      const allEvents = events.items || [];

      // A guide is available by default if they have a connected calendar.
      // They are only UNAVAILABLE if every day in the requested range is covered by a booking.
      const requestStart = new Date(startISO).getTime();
      const requestEnd = new Date(endISO).getTime();
      
      // Check if bookings fully cover the requested range
      let fullyBooked = false;
      if (guideBookedSlots.length > 0) {
        // Sort bookings by start time
        const sorted = [...guideBookedSlots].sort((a, b) => 
          new Date(a.start).getTime() - new Date(b.start).getTime()
        );
        
        // Check if bookings cover the entire range (simplified: if any day is free, guide is available)
        let coveredUntil = requestStart;
        for (const booking of sorted) {
          const bStart = new Date(booking.start.includes('T') ? booking.start : `${booking.start}T00:00:00`).getTime();
          const bEnd = new Date(booking.end.includes('T') ? booking.end : `${booking.end}T23:59:59`).getTime();
          if (bStart <= coveredUntil) {
            coveredUntil = Math.max(coveredUntil, bEnd);
          }
        }
        fullyBooked = coveredUntil >= requestEnd;
      }

      console.log(`Guide ${guide.name}: ${allEvents.length} calendar events, ${guideBookedSlots.length} bookings, fullyBooked=${fullyBooked}`);

      // Guide is available by default (has connected calendar).
      // Only unavailable if their entire requested range is covered by bookings.
      results.push({
        guide_id: guide.id,
        name: guide.name,
        events: allEvents,
        all_events: allEvents,
        booked_slots: guideBookedSlots,
        is_available: !fullyBooked, // Available unless fully booked for the entire range
      });

    } catch (err) {
      results.push({
        guide_id: guide.id,
        error: String(err),
        is_available: false,
      });
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
