// Supabase Edge Function: google-calendar-availability
// This function fetches Google Calendar events for a guide using their refresh token.
// NOW WITH AUTOMATIC TOKEN REFRESH - No more manual reconnection needed!

import { createClient } from "@supabase/supabase-js";

// CORS headers to be used in all responses
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  console.log("📩 Received request");

  // Read secrets inside the handler
  const SUPABASE_URL = Deno.env.get("URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: allGuides } = await supabase.from("guide").select("*");
  console.log("All guides in DB:", allGuides);

  const url = new URL(req.url);
  const guideId = url.searchParams.get("guide_id")
    || url.searchParams.get("id")
    || url.searchParams.get("uuid")
    || url.searchParams.get("guide")
    || url.searchParams.get("guideId")
    || null;

  if (!guideId) {
    console.log("❌ Missing guide_id");
    return new Response(JSON.stringify({ error: "Missing guide_id" }), { 
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log("🧭 Guide ID:", guideId);

  // 1️⃣ Get access token using centralized refresh function
  // This automatically handles token refresh and caching
  console.log("🔄 Getting access token via refresh-google-token function...");
  const tokenRefreshUrl = `${SUPABASE_URL}/functions/v1/refresh-google-token?guideId=${guideId}`;
  const tokenRefreshRes = await fetch(tokenRefreshUrl, {
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  const tokenData = await tokenRefreshRes.json();
  console.log("📡 Token refresh response status:", tokenRefreshRes.status);

  // Check if token refresh failed due to invalid/expired refresh token
  if (!tokenRefreshRes.ok || tokenData.requiresReauth) {
    console.log("❌ Token refresh failed - requires reauth");
    return new Response(JSON.stringify({ 
      error: tokenData.error || "Token expired",
      description: tokenData.description || "Your Google Calendar connection has expired. Please reconnect your account.",
      requiresReauth: true
    }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log("✅ Access token obtained:", tokenData.cached ? "(from cache)" : "(fresh)");

  // 2️⃣ Create "Monde Sauvage - Availability" calendar if it doesn't exist yet

  // First check if we already stored a calendar ID
  const { data: guideRow } = await supabase
    .from("guide")
    .select("availability_calendar_id")
    .eq("id", guideId)
    .single();

  let availabilityCalendarId = guideRow?.availability_calendar_id;
  const EXPECTED_CALENDAR_NAME = "monde sauvage";
  let needsNewCalendar = false;

  console.log("📅 Stored availability calendar ID:", availabilityCalendarId);

  // If we have a stored calendar ID, verify it exists in Google Calendar and has the correct name
  if (availabilityCalendarId) {
    console.log("🔍 Verifying calendar exists in Google Calendar...");
    
    const verifyCalendarRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(availabilityCalendarId)}`,
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }
    );

    if (!verifyCalendarRes.ok) {
      console.log("❌ Stored calendar ID not found in Google Calendar (status: " + verifyCalendarRes.status + ")");
      needsNewCalendar = true;
    } else {
      const calendarData = await verifyCalendarRes.json();
      console.log("📅 Found calendar with name:", calendarData.summary);
      
      // Check if the calendar name matches what we expect
      if (calendarData.summary?.toLowerCase() !== EXPECTED_CALENDAR_NAME.toLowerCase()) {
        console.log(`⚠️ Calendar name mismatch. Expected: "${EXPECTED_CALENDAR_NAME}", Found: "${calendarData.summary}"`);
        needsNewCalendar = true;
      } else {
        console.log("✅ Calendar verified successfully");
      }
    }
  } else {
    console.log("🆕 No availability calendar ID stored");
    needsNewCalendar = true;
  }

  // Create a new calendar if needed
  if (needsNewCalendar) {
    console.log("🆕 Creating new availability calendar...");

    const createCalendarRes = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: EXPECTED_CALENDAR_NAME,
          timeZone: "UTC",
        }),
      }
    );

    if (!createCalendarRes.ok) {
      console.error("❌ Failed to create calendar:", await createCalendarRes.text());
    } else {
      const createdCalendar = await createCalendarRes.json();
      availabilityCalendarId = createdCalendar.id;

      // Store new calendar ID in database
      await supabase
        .from("guide")
        .update({ availability_calendar_id: availabilityCalendarId })
        .eq("id", guideId);

      console.log("📅 Created new availability calendar:", availabilityCalendarId);
    }
  }

  if (!tokenData.access_token) {
    console.log("❌ Failed to get access token");
    console.log("❌ Error details:", JSON.stringify(tokenData, null, 2));
    return new Response(JSON.stringify({ 
      error: "Failed to get access token",
      googleError: tokenData.error, 
      description: tokenData.error_description,
      hint: "The refresh token may be expired or invalid. Please re-authenticate the guide."
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3️⃣ Fetch events from Google Calendar
  const now = new Date();

  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

  const start = url.searchParams.get("start") || defaultStart;
  const end = url.searchParams.get("end") || defaultEnd;
  console.log("📅 Fetching events from:", start, "to:", end);

  // Ensure we're fetching events only from the availability calendar we created/stored
  if (!availabilityCalendarId) {
    console.error("❌ Availability calendar ID is missing after creation attempt");
    return new Response(JSON.stringify({ error: "Availability calendar missing" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3.5️⃣ Fetch existing bookings for this guide to filter out already-booked slots
  const { data: existingBookings, error: bookingsError } = await supabase
    .from("guide_booking")
    .select("start_time, end_time, status")
    .eq("guide_id", guideId)
    .gte("end_time", start)
    .lte("start_time", end)
    .neq("status", "cancelled")
    .neq("status", "deleted");

  if (bookingsError) {
    console.error("Error fetching existing bookings:", bookingsError);
  }

  const bookedSlots = existingBookings || [];
  console.log("📅 Existing bookings for this guide:", bookedSlots.length, JSON.stringify(bookedSlots));

  // Helper function to check if two time ranges overlap
  // Handles both datetime strings (2026-01-28T08:00:00) and date-only strings (2026-01-28)
  function doTimesOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
    // Normalize date-only strings to full day ranges
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

  const calendarIdEscaped = encodeURIComponent(availabilityCalendarId);
  const eventsRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarIdEscaped}/events?singleEvents=true&orderBy=startTime&timeMin=${start}&timeMax=${end}`,
    { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
  );

  const events = await eventsRes.json();
  console.log("✅ Events fetched:", events.items?.length || 0);

  // --- FILTER: keep only events that look like availability entries ---
  // Keywords to identify availability events (common English/French variants + small typos)
  const availabilityKeywords = [
  // Original
  "available",
  "avalaible",
  "disponible",
  "dispo",
  "work",
  "availability",
  "libre",

  // English - main forms
  "free",
  "open",
  "ready",
  "can work",
  "at work",
  "working",
  "on duty",
  "active",
  "slot",
  "slots",
  "calendar free",
  "free time",
  "time available",
  "available time",

  // English - variations & typos
  "avail",
  "avl",
  "avail.",
  "avaible",
  "avialable",
  "availlable",
  "avbl",
  "freee",
  "frree",
  "wrk",
  "wokring",
  "workng",
  "on-duty",
  "onduty",
  "duty",

  // English - abbreviations
  "av",
  "a/v",
  "open slot",
  "free slot",
  "open slots",
  "free slots",
  "open-time",
  "free-time",

  // French - main forms
  "présent",
  "present",
  "prêt",
  "pret",
  "peut travailler",
  "peux travailler",
  "travail",
  "travaille",
  "au travail",
  "en service",
  "service",
  "horaire disponible",
  "crénau",
  "créneau",
  "créneaux",
  "creneau",
  "creneaux",
  "temps libre",
  "moment libre",
  "peut venir",
  "ok pour travailler",
  "ok travail",

  // French - variations & abbreviations
  "ok",
  "ok dispo",
  "dsp",
  "lib",
  "lbre",
  "trv",
  "serv",
  "srv",
  "prés",
  "prst",
  "availabilité",
  "dispon",
  "dispon.",
  "disponib",
  "disp.",
  "dispn",
  "ready fr",
  "on service", // fr-anglicism

  // Neutral/event-style words
  "open",
  "free",
  "busy=false",
  "not busy",
  "no event",
  "no events",
  "empty",
  "clear",
  "clear schedule",

  // Very common short tags guides use
  "ok",
  "yes",
  "y",
  "👍",
  "👋 dispo",
  "ok pour",
  "ok pour guide",
  "free guide",
  "guide dispo",
];


  function escapeRegExp(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Build a single case-insensitive regex from the keywords.
  const availabilityRegex = new RegExp(availabilityKeywords.map(escapeRegExp).join("|"), "i");

  const originalCount = events.items?.length || 0;
  let filteredItems = (events.items || []).filter((ev: Record<string, unknown>) => {
    // Check the most relevant textual fields: summary (title), description and location
    // Normalize and strip diacritics so matches like "disponible" still work with accents
    const summary = (ev.summary as string) || "";
    const description = (ev.description as string) || "";
    const location = (ev.location as string) || "";
    const raw = `${summary} ${description} ${location}`;
    const text = raw.normalize && typeof raw.normalize === "function"
      ? raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      : raw;
    return availabilityRegex.test(text);
  });

  console.log(`✅ Filtered events: kept ${filteredItems.length} of ${originalCount} (availability keywords)`);

  // 4️⃣ Filter out availability slots that are already booked
  const beforeBookingFilter = filteredItems.length;
  filteredItems = filteredItems.filter((ev: Record<string, unknown>) => {
    const eventStart = (ev.start as any)?.dateTime || (ev.start as any)?.date;
    const eventEnd = (ev.end as any)?.dateTime || (ev.end as any)?.date;
    
    if (!eventStart || !eventEnd) return false;
    
    // Check if this event overlaps with any existing booking
    const isBooked = bookedSlots.some(booking => 
      doTimesOverlap(eventStart, eventEnd, booking.start_time, booking.end_time)
    );
    
    if (isBooked) {
      console.log(`🚫 Filtering out booked slot: ${eventStart} - ${eventEnd}`);
    }
    
    return !isBooked;
  });

  console.log(`✅ After booking filter: kept ${filteredItems.length} of ${beforeBookingFilter} (removed already-booked slots)`);

  // Replace items with filtered set
  events.items = filteredItems;

  return new Response(JSON.stringify(events), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
});
