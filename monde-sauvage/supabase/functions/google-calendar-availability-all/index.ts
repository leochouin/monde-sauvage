import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// ── Availability Keyword Matching ────────────────────────────
// Same word bank used in the per-guide endpoint — events whose
// summary/description/location match these are availability blocks.
const AVAILABILITY_KEYWORDS = /dispo|disponible|disponibilit[eé]|available|availability|free|open|slot/i;

function normalizeText(text: string): string {
  return (text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isAvailabilityEvent(event: any): boolean {
  const raw = `${event.summary || ""} ${event.description || ""} ${event.location || ""}`;
  return AVAILABILITY_KEYWORDS.test(normalizeText(raw));
}

// ── Time interval helpers ────────────────────────────────────

interface TimeInterval {
  start: number; // Unix ms
  end: number;
}

function eventToInterval(event: any): TimeInterval | null {
  const startStr = event.start?.dateTime || event.start?.date;
  const endStr = event.end?.dateTime || event.end?.date;
  if (!startStr || !endStr) return null;

  let s: number, e: number;
  if (!startStr.includes("T")) {
    // All-day event: use explicit Z suffix for consistent UTC interpretation
    s = new Date(`${startStr}T00:00:00Z`).getTime();
    e = new Date(`${endStr}T00:00:00Z`).getTime(); // end date exclusive in Google
  } else {
    s = new Date(startStr).getTime();
    e = new Date(endStr).getTime();
  }
  if (isNaN(s) || isNaN(e) || s >= e) return null;
  return { start: s, end: e };
}

/**
 * Subtract busy intervals from an availability interval.
 * Returns remaining sub-windows after removing all overlaps.
 */
function subtractIntervals(avail: TimeInterval, busyList: TimeInterval[]): TimeInterval[] {
  const sorted = [...busyList]
    .filter((b) => b.start < avail.end && b.end > avail.start)
    .sort((a, b) => a.start - b.start);

  if (sorted.length === 0) return [avail];

  const result: TimeInterval[] = [];
  let cursor = avail.start;

  for (const busy of sorted) {
    if (busy.start > cursor) {
      result.push({ start: cursor, end: Math.min(busy.start, avail.end) });
    }
    cursor = Math.max(cursor, busy.end);
    if (cursor >= avail.end) break;
  }
  if (cursor < avail.end) {
    result.push({ start: cursor, end: avail.end });
  }
  // Only keep windows >= 15 minutes
  return result.filter((r) => r.end - r.start >= 15 * 60 * 1000);
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
  // Only include guides with active calendar connections
  const { data: guides } = await supabase
    .from("guide")
    .select("id, name, google_refresh_token, availability_calendar_id, calendar_connection_status")
    .not("google_refresh_token", "is", null);

  // Filter out disconnected guides — they should not appear as available
  const activeGuides = (guides || []).filter((g: any) => 
    g.calendar_connection_status !== 'disconnected'
  );
  const disconnectedGuides = (guides || []).filter((g: any) => 
    g.calendar_connection_status === 'disconnected'
  );
  
  if (disconnectedGuides.length > 0) {
    console.warn(`⚠️ ${disconnectedGuides.length} guide(s) excluded due to disconnected calendar: ${disconnectedGuides.map((g: any) => g.name).join(', ')}`);
  }

  // 2️⃣ Fetch ALL existing bookings for all guides in the date range
  // Standard overlap: reservation_start < requested_end AND reservation_end > requested_start
  // Also exclude soft-deleted rows (deleted_at IS NOT NULL)
  const { data: existingBookings, error: bookingsError } = await supabase
    .from("guide_booking")
    .select("guide_id, start_time, end_time, status")
    .is("deleted_at", null)
    .lt("start_time", endISO)    // booking starts before search end
    .gt("end_time", startISO)    // booking ends after search start
    .not("status", "in", '("cancelled","deleted")');

  if (bookingsError) {
    console.error("Error fetching existing bookings:", bookingsError);
  }

  console.log("Total bookings found:", existingBookings?.length || 0);

  // Create a map of guide_id -> array of booked time intervals
  const bookedSlotsMap = new Map<string, Array<{start: string, end: string, status: string}>>();
  const bookedIntervalsMap = new Map<string, TimeInterval[]>();

  if (existingBookings) {
    for (const booking of existingBookings) {
      // Raw slots for backward-compat response
      const guideBookings = bookedSlotsMap.get(booking.guide_id) || [];
      guideBookings.push({
        start: booking.start_time,
        end: booking.end_time,
        status: booking.status,
      });
      bookedSlotsMap.set(booking.guide_id, guideBookings);

      // Parsed intervals for server-side subtraction
      let s = new Date(booking.start_time).getTime();
      let e = new Date(booking.end_time).getTime();
      // Handle date-only values: DATE columns resolve to midnight UTC,
      // so start===end (zero length). Expand to block the full day.
      if (!isNaN(s) && !isNaN(e) && s >= e) {
        e = s + 24 * 60 * 60 * 1000; // next day midnight UTC
        console.log(`  ⚠️ Date-only booking detected for guide ${booking.guide_id}, expanded to full day: ${new Date(s).toISOString()} → ${new Date(e).toISOString()}`);
      }
      if (!isNaN(s) && !isNaN(e) && s < e) {
        const intervals = bookedIntervalsMap.get(booking.guide_id) || [];
        intervals.push({ start: s, end: e });
        bookedIntervalsMap.set(booking.guide_id, intervals);
      }
    }
  }
  console.log("Existing bookings by guide:", Object.fromEntries(bookedSlotsMap));

  const results: any[] = [];

  // Add disconnected guides to results as explicitly unavailable
  for (const guide of disconnectedGuides) {
    results.push({
      guide_id: guide.id,
      name: guide.name,
      events: [],
      all_events: [],
      booked_slots: [],
      net_available_windows: 0,
      is_available: false,
      connection_status: 'disconnected',
      error: 'Calendar disconnected — guide is temporarily unavailable',
    });
  }

  for (const guide of activeGuides) {
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

      if (!eventsRes.ok) {
        console.error(`Calendar API error for guide ${guide.id}:`, events);
        results.push({
          guide_id: guide.id,
          name: guide.name,
          events: [],
          available_events: [],
          net_available_windows: 0,
          is_available: false,
          error: events.error?.message || "Calendar API error",
        });
        continue;
      }

      const allEvents = events.items || [];
      const guideBookedSlots = bookedSlotsMap.get(guide.id) || [];
      const guideBookedIntervals = bookedIntervalsMap.get(guide.id) || [];

      // ── 5️⃣ Server-side availability computation ──────────────
      // Classify each calendar event as AVAILABILITY or BUSY using
      // the same keyword matching as the per-guide endpoint.
      // Then subtract bookings + busy events from availability windows
      // to compute NET availability. A guide is only shown as available
      // if they have at least one remaining availability window.
      const availabilityBlocks: { event: any; interval: TimeInterval }[] = [];
      const busyBlocks: TimeInterval[] = [];

      for (const event of allEvents) {
        if (event.status === "cancelled") continue;

        // Skip system booking events (managed via DB, not availability)
        const extPrivate = event.extendedProperties?.private || {};
        if (extPrivate.source === "monde-sauvage-booking-system" || extPrivate.mondeSauvageBookingId) continue;
        const desc = (event.description || "") as string;
        if (desc.includes("Booking ID:") || desc.includes("Monde Sauvage booking system")) continue;

        const interval = eventToInterval(event);
        if (!interval) continue;

        if (isAvailabilityEvent(event)) {
          availabilityBlocks.push({ event, interval });
        } else {
          busyBlocks.push(interval);
        }
      }

      // Combine busy calendar events + database bookings as blockers
      const allBlockers: TimeInterval[] = [...busyBlocks, ...guideBookedIntervals];

      // ── DEBUG: log exact time ranges being compared ──
      for (const { event, interval } of availabilityBlocks) {
        console.log(`  📗 AVAIL BLOCK: "${event.summary}" ${new Date(interval.start).toISOString()} → ${new Date(interval.end).toISOString()}`);
      }
      for (const b of busyBlocks) {
        console.log(`  📕 BUSY BLOCK: ${new Date(b.start).toISOString()} → ${new Date(b.end).toISOString()}`);
      }
      for (const b of guideBookedIntervals) {
        console.log(`  📙 DB BOOKING: ${new Date(b.start).toISOString()} → ${new Date(b.end).toISOString()}`);
      }

      // Compute net availability by subtracting all blockers
      let netAvailableWindows = 0;
      for (const { event, interval } of availabilityBlocks) {
        const remaining = subtractIntervals(interval, allBlockers);
        console.log(`  🧮 Subtract: avail [${new Date(interval.start).toISOString()} → ${new Date(interval.end).toISOString()}] minus ${allBlockers.length} blockers → ${remaining.length} windows`);
        for (const w of remaining) {
          console.log(`    ✅ Remaining window: ${new Date(w.start).toISOString()} → ${new Date(w.end).toISOString()} (${Math.round((w.end - w.start) / 60000)}min)`);
        }
        netAvailableWindows += remaining.length;
      }

      const hasAvailability = netAvailableWindows > 0;
      console.log(
        `Guide ${guide.name}: ${allEvents.length} events, ` +
        `${availabilityBlocks.length} avail blocks, ${busyBlocks.length} busy blocks, ` +
        `${guideBookedIntervals.length} bookings → ${netAvailableWindows} net windows → ` +
        `${hasAvailability ? "AVAILABLE" : "HIDDEN"}`
      );

      results.push({
        guide_id: guide.id,
        name: guide.name,
        events: allEvents,
        all_events: allEvents,
        booked_slots: guideBookedSlots,
        net_available_windows: netAvailableWindows,
        is_available: hasAvailability,
      });

    } catch (err) {
      results.push({
        guide_id: guide.id,
        error: String(err),
        net_available_windows: 0,
        is_available: false,
      });
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
