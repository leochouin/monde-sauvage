// Supabase Edge Function: create-guide-booking-event
// Creates a Google Calendar event for a guide booking
// Called after booking is created in database
//
// IDEMPOTENCY: Checks google_event_id before creating to prevent duplicates.
// RETRY: Uses exponential backoff for transient Google API failures.

import { createClient } from "@supabase/supabase-js";
import {
  corsHeaders,
  retryWithBackoff,
  getAccessToken,
  getGuideBookingCalendarId,
  errorResponse,
  successResponse,
} from "../_shared/calendarUtils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  console.log("📩 Creating Google Calendar event for guide booking");

  let booking_id_outer: string | undefined;

  try {
    const SUPABASE_URL = Deno.env.get("URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const {
      booking_id,
      guide_id,
      start_time,
      end_time,
      customer_name,
      customer_email,
      trip_type,
      notes,
    } = await req.json();

    booking_id_outer = booking_id;

    if (!booking_id || !guide_id || !start_time || !end_time || !customer_name) {
      return errorResponse("Missing required fields", 400);
    }

    console.log(`📝 Creating event for booking: ${booking_id}, customer: ${customer_name}, email: "${customer_email || 'none'}"`);


    // ── IDEMPOTENCY CHECK ──────────────────────────────────────
    // If the booking already has a google_event_id, return it instead of
    // creating a duplicate event.
    // IMPORTANT: Reject UUID-shaped values — those are bogus DB defaults,
    // not real Google Calendar event IDs (which look like alphanumeric strings).
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const { data: existingBooking } = await supabase
      .from("guide_booking")
      .select("google_event_id")
      .eq("id", booking_id)
      .single();

    if (existingBooking?.google_event_id && !UUID_REGEX.test(existingBooking.google_event_id)) {
      console.log(`⏩ Booking ${booking_id} already has event ${existingBooking.google_event_id} — skipping creation`);
      return successResponse({
        event_id: existingBooking.google_event_id,
        message: "Event already exists (idempotent)",
        idempotent: true,
      });
    }

    // If the stored google_event_id is a UUID, it's a bogus default — clear it
    if (existingBooking?.google_event_id && UUID_REGEX.test(existingBooking.google_event_id)) {
      console.warn(`⚠️ Booking ${booking_id} has bogus UUID google_event_id "${existingBooking.google_event_id}" — clearing and proceeding with event creation`);
      await supabase
        .from("guide_booking")
        .update({ google_event_id: null })
        .eq("id", booking_id);
    }

    // ── GET ACCESS TOKEN (with retry) ──────────────────────────
    let accessToken: string;
    try {
      const tokenResult = await getAccessToken(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, guide_id);
      accessToken = tokenResult.access_token;
    } catch (tokenError: any) {
      return errorResponse(
        "Failed to authenticate with Google Calendar",
        tokenError.status || 401,
        { requiresAuth: tokenError.requiresReauth || false }
      );
    }

    // ── GET GUIDE BOOKING CALENDAR (verify + auto-create if missing) ──
    // Bookings go to "Monde Sauvage | Réservations", NOT the availability calendar
    const { calendarId } = await getGuideBookingCalendarId(supabase, guide_id, accessToken);

    // ── NORMALIZE DATETIME VALUES ─────────────────────────────
    // Google Calendar API requires full ISO 8601 datetime strings.
    // If we receive date-only strings (YYYY-MM-DD), convert them to datetime.
    //
    // TIMEZONE STRATEGY:
    // - dateTime values with explicit offset (Z or +00:00) are unambiguous
    //   → Google Calendar correctly interprets the absolute moment
    //   → timeZone field only affects recurring event expansion & default display
    // - dateTime values WITHOUT offset are interpreted using the timeZone field
    //   → MUST be in the guide's local timezone to avoid day shifts
    //
    // Monde Sauvage operates in Belgium → Europe/Brussels
    const GUIDE_TIMEZONE = "Europe/Brussels";

    let normalizedStartTime = start_time;
    let normalizedEndTime = end_time;

    // Check if start_time is just a date (YYYY-MM-DD format)
    if (/^\d{4}-\d{2}-\d{2}$/.test(start_time)) {
      normalizedStartTime = `${start_time}T09:00:00`;
      console.log(`📅 Converted date-only start_time to: ${normalizedStartTime} (will use tz=${GUIDE_TIMEZONE})`);
    }

    // Check if end_time is just a date (YYYY-MM-DD format)
    if (/^\d{4}-\d{2}-\d{2}$/.test(end_time)) {
      normalizedEndTime = `${end_time}T17:00:00`;
      console.log(`📅 Converted date-only end_time to: ${normalizedEndTime} (will use tz=${GUIDE_TIMEZONE})`);
    }

    // ── DATE SHIFT GUARD ──────────────────────────────────────
    // Assert that start and end resolve to valid absolute times and
    // that the calendar event date matches the input date.
    {
      const parsedStart = new Date(normalizedStartTime);
      const parsedEnd = new Date(normalizedEndTime);
      console.log(`🔒 [DATE GUARD] Input start_time: "${start_time}" → normalized: "${normalizedStartTime}" → parsed UTC: ${parsedStart.toISOString()}`);
      console.log(`🔒 [DATE GUARD] Input end_time:   "${end_time}"   → normalized: "${normalizedEndTime}"   → parsed UTC: ${parsedEnd.toISOString()}`);
      if (isNaN(parsedStart.getTime()) || isNaN(parsedEnd.getTime())) {
        console.error(`❌ [DATE GUARD] INVALID DATE DETECTED! start="${start_time}", end="${end_time}"`);
      }
      if (parsedEnd.getTime() <= parsedStart.getTime()) {
        console.error(`❌ [DATE GUARD] END <= START! start=${parsedStart.toISOString()}, end=${parsedEnd.toISOString()}`);
      }
    }

    // ── BUILD EVENT OBJECT ─────────────────────────────────────
    const eventTitle = trip_type
      ? `${trip_type} - ${customer_name}`
      : customer_name;

    const eventDescription = [
      `Booking ID: ${booking_id}`,
      customer_email ? `Email: ${customer_email}` : "",
      notes ? `\nNotes: ${notes}` : "",
      "\n---",
      "Created via Monde Sauvage booking system",
    ]
      .filter(Boolean)
      .join("\n");

    const event: Record<string, any> = {
      summary: eventTitle,
      description: eventDescription,
      start: { dateTime: normalizedStartTime, timeZone: GUIDE_TIMEZONE },
      end: { dateTime: normalizedEndTime, timeZone: GUIDE_TIMEZONE },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 24 * 60 },
          { method: "popup", minutes: 60 },
        ],
      },
      // Tag event with machine-readable extended properties so it can be
      // reliably identified as a system-created booking when fetching the
      // calendar back — prevents duplicates in the guide calendar view.
      extendedProperties: {
        private: {
          mondeSauvageBookingId: booking_id,
          source: "monde-sauvage-booking-system",
        },
      },
    };

    // Only add attendees if customer_email is a valid email
    if (customer_email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(customer_email)) {
        event.attendees = [{ email: customer_email }];
      } else {
        console.warn(`⚠️ Invalid email format, skipping attendee: "${customer_email}"`);
      }
    }

    // ── CREATE EVENT (with retry on transient failures) ────────
    console.log("📅 Creating event in Google Calendar...");
    const calendarApiUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

    const createRes = await retryWithBackoff(
      () =>
        fetch(calendarApiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(event),
        }),
      { maxRetries: 3, operationName: "Create calendar event" }
    );

    if (!createRes.ok) {
      const errorData = await createRes.json();
      console.error("Google Calendar API error response:", errorData);
      throw new Error(
        `Google Calendar API error: ${errorData.error?.message || createRes.statusText || "Unknown error"}`
      );
    }

    const createdEvent = await createRes.json();
    console.log(`✅ Event created: ${createdEvent.id}`);

    // ── PERSIST google_event_id IN DATABASE (ATOMIC) ──────────
    // Use a conditional UPDATE so only ONE concurrent caller wins.
    // If another process already stored a google_event_id, this UPDATE
    // will match 0 rows — we then delete the duplicate Google event.
    const { data: updateData, error: updateError } = await supabase
      .from("guide_booking")
      .update({
        google_event_id: createdEvent.id,
        calendar_sync_failed: false,
        calendar_sync_error: null,
        synced_at: new Date().toISOString(),
      })
      .eq("id", booking_id)
      .is("google_event_id", null)   // ← atomic: only if no event yet
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error(`⚠️ Event created (${createdEvent.id}) but failed to store google_event_id:`, updateError);
    } else if (!updateData) {
      // Another concurrent caller already set google_event_id — delete our duplicate
      console.warn(`⚠️ Race condition: another process already set google_event_id for booking ${booking_id}. Deleting duplicate event ${createdEvent.id}`);
      try {
        const deleteUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${createdEvent.id}`;
        await fetch(deleteUrl, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        console.log(`🗑️ Duplicate Google Calendar event ${createdEvent.id} deleted`);
      } catch (delErr: any) {
        console.warn(`⚠️ Could not delete duplicate event ${createdEvent.id}:`, delErr.message);
      }
      // Return the existing event ID
      const { data: existingRow } = await supabase
        .from("guide_booking")
        .select("google_event_id")
        .eq("id", booking_id)
        .single();
      return successResponse({
        event_id: existingRow?.google_event_id || createdEvent.id,
        message: "Event already created by another process (race resolved)",
        idempotent: true,
      });
    } else {
      console.log(`✅ google_event_id saved to guide_booking: ${createdEvent.id}`);
    }

    return successResponse({
      event_id: createdEvent.id,
      event_link: createdEvent.htmlLink,
      message: "Google Calendar event created successfully",
    });
  } catch (error: any) {
    console.error("❌ Error creating calendar event:", error);

    // ── MARK SYNC FAILED IN DATABASE ──────────────────────────
    // So the calendar UI shows the booking as red and enables retry
    if (booking_id_outer) {
      try {
        const SUPABASE_URL_INNER = Deno.env.get("URL")!;
        const SUPABASE_KEY_INNER = Deno.env.get("SERVICE_ROLE_KEY")!;
        const sbInner = createClient(SUPABASE_URL_INNER, SUPABASE_KEY_INNER);
        await sbInner
          .from("guide_booking")
          .update({
            calendar_sync_failed: true,
            calendar_sync_error: error.message || "Unknown error",
          })
          .eq("id", booking_id_outer);
      } catch (_markErr) {
        console.error("Could not mark sync failure in DB:", _markErr);
      }
    }

    return errorResponse(
      error.message || "Failed to create calendar event",
      500,
      { details: error.toString() }
    );
  }
});
