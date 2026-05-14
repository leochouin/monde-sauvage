// Supabase Edge Function: google-calendar-availability (v2 — Production-grade)
//
// PURPOSE:
// Fetches Google Calendar events for a guide and computes true availability
// by applying keyword-based detection + busy-event override + partial overlap splitting.
//
// AVAILABILITY ALGORITHM:
// 1. Fetch events from the dedicated "Monde Sauvage | Disponibilités" calendar ONLY
// 2. Classify each event as AVAILABILITY or BUSY using keyword word bank
// 3. Fetch existing guide_booking records (confirmed/pending)
// 4. For each availability block:
//    - Subtract all BUSY event time ranges
//    - Subtract all existing booking time ranges
//    - Split into remaining windows
// 5. Return only the net-available time windows
//
// KEYWORD WORD BANK (case-insensitive, accent-normalized):
// dispo, disponible, disponibilité, disponibilite, available, availability,
// free, open, slot
//
// RULES:
// - ONLY events matching keyword → availability blocks
// - ALL other events → busy / blocked time
// - Busy events OVERRIDE availability blocks
// - Partial overlaps → split availability windows accordingly
//
// CONNECTIVITY:
// - Checks calendar_connection_status before proceeding
// - Returns requiresReauth if disconnected

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// ── Availability Word Bank ───────────────────────────────────
// Only these keywords qualify an event as an availability block.
// Matched case-insensitive and accent-normalized.
const AVAILABILITY_KEYWORDS = [
  "dispo",
  "disponible",
  "disponibilité",
  "disponibilite",
  "available",
  "availability",
  "free",
  "open",
  "slot",
];

// Build a single regex from the word bank (accent-stripped matching done separately)
function buildAvailabilityRegex(): RegExp {
  const escaped = AVAILABILITY_KEYWORDS.map((k) =>
    k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  return new RegExp(escaped.join("|"), "i");
}

const availabilityRegex = buildAvailabilityRegex();

/**
 * Strip accents/diacritics for matching.
 * "disponibilité" → "disponibilite"
 */
function normalizeText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Check if an event's text fields contain any availability keyword.
 */
function isAvailabilityEvent(event: any): boolean {
  const summary = event.summary || "";
  const description = event.description || "";
  const location = event.location || "";
  const raw = `${summary} ${description} ${location}`;
  const normalized = normalizeText(raw);
  return availabilityRegex.test(normalized);
}

// ── Time interval types & utilities ──────────────────────────

interface TimeInterval {
  start: number; // Unix ms
  end: number;   // Unix ms
}

// ── Brussels timezone helpers ─────────────────────────────────
// Fishing guides operate in Europe/Brussels time.
// All-day availability events are expanded to BUSINESS_START–BUSINESS_END
// (local Brussels wall-clock) so that bookings created at those hours
// correctly cancel the dispo without leaving phantom midnight windows.

const BUSINESS_START_HOUR = 8;  // 08:00 Brussels
const BUSINESS_END_HOUR   = 16; // 16:00 Brussels

/**
 * Return true if the given date string (YYYY-MM-DD) falls within
 * Central European Summer Time (CEST = UTC+2) for Europe/Brussels.
 * CEST runs from the last Sunday of March to the last Sunday of October.
 */
function isDSTBrussels(dateStr: string): boolean {
  const [ys, ms, ds] = dateStr.split("-");
  const year = parseInt(ys, 10), month = parseInt(ms, 10), day = parseInt(ds, 10);
  if (month < 3 || month > 10) return false;
  if (month > 3 && month < 10) return true;
  const lastSunday = (y: number, m: number): number => {
    const lastDay = new Date(y, m, 0).getDate();
    return lastDay - new Date(y, m - 1, lastDay).getDay();
  };
  if (month === 3) return day >= lastSunday(year, 3);
  if (month === 10) return day < lastSunday(year, 10);
  return false;
}

/**
 * Return the UTC millisecond timestamp for a given Brussels wall-clock
 * hour on a specific date string (YYYY-MM-DD).
 */
function brusselsHourToUTC(dateStr: string, hour: number): number {
  const offsetHours = isDSTBrussels(dateStr) ? 2 : 1;
  const utcHour = hour - offsetHours;
  return new Date(`${dateStr}T${String(utcHour).padStart(2, "0")}:00:00Z`).getTime();
}

/**
 * Expand an all-day date range (startDate inclusive, endDate exclusive as
 * returned by Google Calendar) into per-day business-hours intervals
 * (BUSINESS_START_HOUR–BUSINESS_END_HOUR Brussels time).
 */
function expandAllDayToBusinessHours(startDate: string, endDate: string): TimeInterval[] {
  const intervals: TimeInterval[] = [];
  const endExcl = new Date(`${endDate}T00:00:00Z`);
  const cur = new Date(`${startDate}T00:00:00Z`);
  while (cur < endExcl) {
    const ds = cur.toISOString().slice(0, 10);
    const s = brusselsHourToUTC(ds, BUSINESS_START_HOUR);
    const e = brusselsHourToUTC(ds, BUSINESS_END_HOUR);
    if (e > s) intervals.push({ start: s, end: e });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return intervals;
}

/**
 * Parse a Google Calendar event's start/end into a TimeInterval.
 * For all-day events this returns a midnight-to-midnight interval;
 * call expandAllDayToBusinessHours directly when you need per-day
 * business-hours intervals for availability blocks.
 */
function eventToInterval(event: any): TimeInterval | null {
  const startStr = event.start?.dateTime || event.start?.date;
  const endStr = event.end?.dateTime || event.end?.date;
  if (!startStr || !endStr) return null;

  let start: number, end: number;

  if (!startStr.includes("T")) {
    // All-day event: treat as midnight-to-midnight UTC
    start = new Date(`${startStr}T00:00:00Z`).getTime();
    end = new Date(`${endStr}T00:00:00Z`).getTime(); // end date is exclusive in Google
  } else {
    start = new Date(startStr).getTime();
    end = new Date(endStr).getTime();
  }

  if (isNaN(start) || isNaN(end) || start >= end) return null;
  return { start, end };
}

/**
 * Subtract a set of busy intervals from a single availability interval.
 * Returns the remaining available sub-intervals after all overlaps are removed.
 *
 * Example:
 *   availability: [08:00 — 17:00]
 *   busy:         [10:00 — 11:00], [14:00 — 15:30]
 *   result:       [08:00 — 10:00], [11:00 — 14:00], [15:30 — 17:00]
 */
function subtractIntervals(
  avail: TimeInterval,
  busyList: TimeInterval[]
): TimeInterval[] {
  // Sort busy intervals by start time
  const sorted = [...busyList]
    .filter((b) => b.start < avail.end && b.end > avail.start) // Only overlapping
    .sort((a, b) => a.start - b.start);

  if (sorted.length === 0) return [avail];

  const result: TimeInterval[] = [];
  let cursor = avail.start;

  for (const busy of sorted) {
    if (busy.start > cursor) {
      // Gap before this busy block
      result.push({ start: cursor, end: Math.min(busy.start, avail.end) });
    }
    cursor = Math.max(cursor, busy.end);
    if (cursor >= avail.end) break;
  }

  // Remaining tail after last busy block
  if (cursor < avail.end) {
    result.push({ start: cursor, end: avail.end });
  }

  // Filter out zero-width or negative intervals
  return result.filter((r) => r.end - r.start > 0);
}

/**
 * Convert a TimeInterval back to ISO strings for the API response.
 */
function intervalToEvent(
  interval: TimeInterval,
  originalEvent: any
): any {
  return {
    id: `${originalEvent.id}_split_${interval.start}`,
    summary: originalEvent.summary || "Available",
    description: originalEvent.description || "",
    start: { dateTime: new Date(interval.start).toISOString() },
    end: { dateTime: new Date(interval.end).toISOString() },
    status: "confirmed",
    _type: "availability",
    _originalEventId: originalEvent.id,
    htmlLink: originalEvent.htmlLink,
  };
}

// ── Main Handler ─────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
  console.log("📩 [AVAILABILITY] Request received");

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const url = new URL(req.url);
  const guideId =
    url.searchParams.get("guide_id") ||
    url.searchParams.get("id") ||
    url.searchParams.get("uuid") ||
    url.searchParams.get("guide") ||
    url.searchParams.get("guideId");

  if (!guideId) {
    return jsonResponse({ error: "Missing guide_id" }, 400);
  }

  console.log(`🧭 [AVAILABILITY] Guide ID: ${guideId}`);

  // ── 1. Check calendar connection status ────────────────────

  const { data: guideRow, error: guideError } = await supabase
    .from("guide")
    .select("calendar_connection_status, availability_calendar_id")
    .eq("id", guideId)
    .single();

  if (guideError || !guideRow) {
    return jsonResponse({ error: "Guide not found" }, 404);
  }

  if (guideRow.calendar_connection_status === "disconnected") {
    console.warn(
      `⚠️ [AVAILABILITY] Guide ${guideId} is calendar_disconnected — returning empty`
    );
    return jsonResponse({
      error: "Calendar disconnected",
      description:
        "This guide's Google Calendar connection is currently inactive. Please reconnect.",
      requiresReauth: true,
      connection_status: "disconnected",
      items: [],
    }, 401);
  }

  // ── 2. Get access token ────────────────────────────────────

  const tokenRefreshUrl = `${SUPABASE_URL}/functions/v1/refresh-google-token?guideId=${guideId}`;
  const tokenRefreshRes = await fetch(tokenRefreshUrl, {
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });

  const tokenData = await tokenRefreshRes.json();

  if (!tokenRefreshRes.ok || tokenData.requiresReauth) {
    console.error(`❌ [AVAILABILITY] Token refresh failed for guide ${guideId}`);
    return jsonResponse(
      {
        error: tokenData.error || "Token expired",
        description:
          tokenData.description ||
          "Your Google Calendar connection has expired. Please reconnect.",
        requiresReauth: true,
        connection_status: tokenData.connection_status || "disconnected",
        items: [],
      },
      401
    );
  }

  const accessToken = tokenData.access_token;
  console.log(
    `✅ [AVAILABILITY] Access token obtained ${tokenData.cached ? "(cached)" : "(fresh)"}`
  );

  // ── 3. Ensure availability calendar exists ─────────────────

  let availabilityCalendarId = guideRow.availability_calendar_id;
  const EXPECTED_CALENDAR_NAME = "Monde Sauvage | Disponibilités";

  if (availabilityCalendarId) {
    // Verify it still exists
    const verifyRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(availabilityCalendarId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!verifyRes.ok) {
      console.warn(`⚠️ [AVAILABILITY] Stored calendar not found (${verifyRes.status}), creating new one`);
      availabilityCalendarId = null;
    } else {
      const calData = await verifyRes.json();
      if (calData.summary?.toLowerCase() !== EXPECTED_CALENDAR_NAME.toLowerCase()) {
        console.warn(`⚠️ [AVAILABILITY] Calendar name mismatch ("${calData.summary}" vs "${EXPECTED_CALENDAR_NAME}"), creating new one`);
        availabilityCalendarId = null;
      }
    }
  }

  if (!availabilityCalendarId) {
    const createRes = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: EXPECTED_CALENDAR_NAME,
          timeZone: "Europe/Brussels",
        }),
      }
    );
    if (createRes.ok) {
      const created = await createRes.json();
      availabilityCalendarId = created.id;
      await supabase
        .from("guide")
        .update({ availability_calendar_id: availabilityCalendarId })
        .eq("id", guideId);
      console.log(`📅 [AVAILABILITY] Created new availability calendar: ${availabilityCalendarId}`);
    } else {
      console.error(`❌ [AVAILABILITY] Failed to create calendar`);
      return jsonResponse({ error: "Availability calendar missing" }, 500);
    }
  }

  // ── 3b. Ensure booking calendar also exists (idempotent) ───
  // This ensures the "Monde Sauvage | Réservations" calendar is created
  // alongside the availability calendar, even if the guide hasn't booked yet.
  {
    const { data: guideBookingRow } = await supabase
      .from("guide")
      .select("booking_calendar_id")
      .eq("id", guideId)
      .single();

    let bookingCalendarId = guideBookingRow?.booking_calendar_id;
    if (!bookingCalendarId) {
      try {
        const createBookingRes = await fetch(
          "https://www.googleapis.com/calendar/v3/calendars",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              summary: "Monde Sauvage | Réservations",
              timeZone: "Europe/Brussels",
            }),
          }
        );
        if (createBookingRes.ok) {
          const createdBooking = await createBookingRes.json();
          bookingCalendarId = createdBooking.id;
          await supabase
            .from("guide")
            .update({ booking_calendar_id: bookingCalendarId })
            .eq("id", guideId);
          console.log(`📅 [AVAILABILITY] Also created booking calendar: ${bookingCalendarId}`);
        }
      } catch (err) {
        console.warn(`⚠️ [AVAILABILITY] Could not create booking calendar (non-fatal):`, err);
      }
    }
  }

  // ── 4. Determine time range ────────────────────────────────

  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();
  const start = url.searchParams.get("start") || defaultStart;
  const end = url.searchParams.get("end") || defaultEnd;

  console.log(`📅 [AVAILABILITY] Fetching events from ${start} to ${end}`);

  // ── 5. Fetch events from the "Monde Sauvage | Disponibilités" calendar ONLY ──

  const availRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(availabilityCalendarId)}/events?singleEvents=true&orderBy=startTime&timeMin=${start}&timeMax=${end}&maxResults=2500`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  const availEvents = availRes.ok ? await availRes.json() : { items: [] };

  const allEvents: any[] = (availEvents.items || []).map((ev: any) => {
    ev._source = "availability_cal";
    return ev;
  });

  console.log(
    `📊 [AVAILABILITY] Total events: ${allEvents.length} (from Monde Sauvage | Disponibilités calendar)`
  );

  // ── 6. Classify events into availability vs busy ───────────

  const availabilityBlocks: { event: any; interval: TimeInterval }[] = [];
  const busyBlocks: TimeInterval[] = [];

  for (const event of allEvents) {
    // Skip cancelled events
    if (event.status === "cancelled") continue;

    // Skip system booking events (managed via DB)
    // Check 1: Extended properties tag (most reliable — set on creation)
    const extPrivate = event.extendedProperties?.private || {};
    if (extPrivate.source === "monde-sauvage-booking-system" || extPrivate.mondeSauvageBookingId) {
      console.log(`⏩ [AVAILABILITY] Skipping system booking event (extendedProperties): "${event.summary}"`);
      continue;
    }
    // Check 2: Description markers (legacy events / fallback)
    const desc = (event.description || "") as string;
    if (desc.includes("Booking ID:") || desc.includes("Monde Sauvage booking system")) {
      console.log(`⏩ [AVAILABILITY] Skipping system booking event (description): "${event.summary}"`);
      continue;
    }

    const startStr = event.start?.dateTime || event.start?.date;
    const endStr = event.end?.dateTime || event.end?.date;
    const isAllDay = startStr && !startStr.includes("T");

    if (isAvailabilityEvent(event)) {
      if (isAllDay && startStr && endStr) {
        // All-day availability event → expand to per-day 08:00–16:00 Brussels
        const dailyIntervals = expandAllDayToBusinessHours(startStr, endStr);
        for (const di of dailyIntervals) {
          availabilityBlocks.push({ event, interval: di });
          console.log(
            `✅ [AVAILABILITY] AVAIL (all-day→8h): "${event.summary}" [${new Date(di.start).toISOString()} — ${new Date(di.end).toISOString()}]`
          );
        }
      } else {
        const interval = eventToInterval(event);
        if (!interval) continue;
        availabilityBlocks.push({ event, interval });
        console.log(
          `✅ [AVAILABILITY] AVAIL: "${event.summary}" [${new Date(interval.start).toISOString()} — ${new Date(interval.end).toISOString()}]`
        );
      }
    } else {
      const interval = eventToInterval(event);
      if (!interval) continue;
      busyBlocks.push(interval);
      console.log(
        `🚫 [AVAILABILITY] BUSY:  "${event.summary}" [${new Date(interval.start).toISOString()} — ${new Date(interval.end).toISOString()}]`
      );
    }
  }

  // ── 7. Fetch existing bookings (they also block availability) ──
  // Standard overlap: booking_start < range_end AND booking_end > range_start
  // Also exclude soft-deleted rows (deleted_at IS NOT NULL)

  const { data: existingBookings } = await supabase
    .from("guide_booking")
    .select("start_time, end_time, status")
    .eq("guide_id", guideId)
    .is("deleted_at", null)
    .lt("start_time", end)
    .gt("end_time", start)
    .not("status", "in", '("cancelled","deleted")');

  const bookingIntervals: TimeInterval[] = (existingBookings || []).map((b: any) => {
    let s = new Date(b.start_time).getTime();
    let e = new Date(b.end_time).getTime();
    // Handle date-only values: DATE columns resolve to midnight UTC,
    // so start===end (zero length). Expand to block the full day.
    if (!isNaN(s) && !isNaN(e) && s >= e) {
      e = s + 24 * 60 * 60 * 1000;
      console.log(`  ⚠️ Date-only booking expanded: ${new Date(s).toISOString()} → ${new Date(e).toISOString()}`);
    }
    return { start: s, end: e };
  });

  console.log(`📅 [AVAILABILITY] Existing bookings: ${bookingIntervals.length}`);
  for (const b of existingBookings || []) {
    console.log(`  📙 [AVAILABILITY] DB BOOKING: status=${b.status} ${b.start_time} → ${b.end_time}`);
  }

  // Combine busy + bookings into one blocker list
  const allBlockers = [...busyBlocks, ...bookingIntervals];

  // ── 8. Compute net availability (subtract blockers) ────────

  const netAvailability: any[] = [];

  for (const { event, interval } of availabilityBlocks) {
    const remaining = subtractIntervals(interval, allBlockers);
    console.log(`  🧮 [AVAILABILITY] Subtract: avail "${event.summary}" [${new Date(interval.start).toISOString()} → ${new Date(interval.end).toISOString()}] minus ${allBlockers.length} blockers → ${remaining.length} windows`);
    for (const window of remaining) {
      console.log(`    ✅ Remaining: ${new Date(window.start).toISOString()} → ${new Date(window.end).toISOString()} (${Math.round((window.end - window.start) / 60000)}min)`);
      // Only include windows >= 15 minutes
      if (window.end - window.start >= 15 * 60 * 1000) {
        netAvailability.push(intervalToEvent(window, event));
      }
    }
  }

  console.log(
    `✅ [AVAILABILITY] Net availability windows: ${netAvailability.length} ` +
    `(from ${availabilityBlocks.length} blocks, minus ${allBlockers.length} blockers)`
  );

  // ── 9. Return response ─────────────────────────────────────

  return new Response(
    JSON.stringify({
      items: netAvailability,
      summary: {
        total_calendar_events: allEvents.length,
        availability_blocks: availabilityBlocks.length,
        busy_blocks: busyBlocks.length,
        existing_bookings: bookingIntervals.length,
        net_availability_windows: netAvailability.length,
      },
      connection_status: "connected",
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ [AVAILABILITY] Unhandled error:", message);
    return jsonResponse({ error: "Internal server error", description: message }, 500);
  }
});

// ── Helper ───────────────────────────────────────────────────

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
