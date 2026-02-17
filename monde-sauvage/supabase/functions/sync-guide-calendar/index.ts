// Supabase Edge Function: sync-guide-calendar
// Syncs guide bookings bidirectionally with Google Calendar
// 
// WORKFLOW:
// 1. Fetch all events from guide's availability calendar (not primary)
// 2. Compare with guide_booking table using google_event_id
// 3. Detect deletions (exists in DB but not in Calendar)
// 4. Detect new events (exists in Calendar but not in DB)
// 5. Detect modifications (event times/title changed in Calendar)
// 6. Retry failed calendar syncs for bookings with calendar_sync_failed=true
// 7. Update database to reflect changes
// 
// SECURITY:
// - Paid bookings cannot be deleted by calendar sync
// - Deletions are soft-deleted (marked, not removed)
// - All changes are logged for audit trail

import { createClient } from "@supabase/supabase-js";
import {
  corsHeaders,
  retryWithBackoff,
  getAccessToken,
  getGuideCalendarId,
  errorResponse,
  successResponse,
} from "../_shared/calendarUtils.ts";

interface SyncResult {
  deletedBookings: string[];
  newBookings: string[];
  updatedBookings: string[];
  retriedBookings: string[];
  errors: string[];
  protectedBookings: string[]; // Paid bookings that couldn't be deleted
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  console.log("🔄 Starting Google Calendar sync for guide bookings");

  try {
    const SUPABASE_URL = Deno.env.get("URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse request body
    const { guide_id } = await req.json();

    if (!guide_id) {
      return errorResponse("Missing guide_id", 400);
    }

    console.log(`📋 Syncing bookings for guide: ${guide_id}`);

    const syncResult: SyncResult = {
      deletedBookings: [],
      newBookings: [],
      updatedBookings: [],
      retriedBookings: [],
      errors: [],
      protectedBookings: [],
    };

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

    // ── GET GUIDE CALENDAR (verify + auto-create if missing) ───
    const { calendarId } = await getGuideCalendarId(supabase, guide_id, accessToken);

    // ── FETCH GOOGLE CALENDAR EVENTS ───────────────────────────
    console.log("📅 Fetching events from Google Calendar...");
    
    const now = new Date();
    const sixMonthsLater = new Date();
    sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);

    const calendarApiUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/" + 
      encodeURIComponent(calendarId) + "/events");
    
    calendarApiUrl.searchParams.set("timeMin", now.toISOString());
    calendarApiUrl.searchParams.set("timeMax", sixMonthsLater.toISOString());
    calendarApiUrl.searchParams.set("singleEvents", "true");
    calendarApiUrl.searchParams.set("maxResults", "500");

    const calendarRes = await retryWithBackoff(
      () => fetch(calendarApiUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      { maxRetries: 2, operationName: "Fetch calendar events" }
    );

    if (!calendarRes.ok) {
      const errorData = await calendarRes.json();
      throw new Error(`Google Calendar API error: ${errorData.error?.message || 'Unknown error'}`);
    }

    const calendarData = await calendarRes.json();
    const calendarEvents = calendarData.items || [];
    console.log(`📊 Found ${calendarEvents.length} events in Google Calendar`);

    // ── FETCH DB BOOKINGS ──────────────────────────────────────
    const { data: dbBookings, error: dbError } = await supabase
      .from("guide_booking")
      .select("*")
      .eq("guide_id", guide_id)
      .is("deleted_at", null)
      .gte("end_time", now.toISOString());

    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`);
    }

    console.log(`📊 Found ${dbBookings?.length || 0} bookings in database`);

    // ── BUILD LOOKUP MAPS ──────────────────────────────────────
    const calendarEventMap = new Map();
    calendarEvents.forEach((event: any) => {
      if (event.id) calendarEventMap.set(event.id, event);
    });

    const dbBookingMap = new Map();
    dbBookings?.forEach((booking: any) => {
      if (booking.google_event_id) {
        dbBookingMap.set(booking.google_event_id, booking);
      }
    });

    // ── DETECT DELETIONS ───────────────────────────────────────
    console.log("🔍 Checking for deleted events...");
    
    for (const booking of dbBookings || []) {
      if (!booking.google_event_id) continue;

      if (!calendarEventMap.has(booking.google_event_id)) {
        console.log(`🗑️ Event deleted from calendar: ${booking.google_event_id}`);

        if (booking.is_paid) {
          console.log(`⚠️ Cannot delete paid booking: ${booking.id}`);
          syncResult.protectedBookings.push(booking.id);
          continue;
        }

        const { error: deleteError } = await supabase
          .from("guide_booking")
          .update({
            status: "deleted",
            deleted_at: new Date().toISOString(),
            notes: booking.notes 
              ? `${booking.notes}\n\n[AUTO-SYNC] Event deleted from Google Calendar`
              : "[AUTO-SYNC] Event deleted from Google Calendar"
          })
          .eq("id", booking.id);

        if (deleteError) {
          console.error(`❌ Failed to delete booking ${booking.id}:`, deleteError);
          syncResult.errors.push(`Failed to delete booking ${booking.id}`);
        } else {
          syncResult.deletedBookings.push(booking.id);
          console.log(`✅ Soft deleted booking: ${booking.id}`);
        }
      }
    }

    // ── DETECT MODIFICATIONS ───────────────────────────────────
    console.log("🔍 Checking for modified events...");

    for (const booking of dbBookings || []) {
      if (!booking.google_event_id) continue;

      const calEvent = calendarEventMap.get(booking.google_event_id);
      if (!calEvent) continue; // Already handled in deletion check

      const calStart = calEvent.start?.dateTime || calEvent.start?.date;
      const calEnd = calEvent.end?.dateTime || calEvent.end?.date;
      const calSummary = calEvent.summary || "";

      // Compare timestamps (normalize to ms)
      const dbStartMs = new Date(booking.start_time).getTime();
      const dbEndMs = new Date(booking.end_time).getTime();
      const calStartMs = calStart ? new Date(calStart).getTime() : dbStartMs;
      const calEndMs = calEnd ? new Date(calEnd).getTime() : dbEndMs;

      const timeChanged = Math.abs(dbStartMs - calStartMs) > 60000 || Math.abs(dbEndMs - calEndMs) > 60000;
      const titleChanged = calSummary && booking.customer_name && !calSummary.includes(booking.customer_name);

      if (timeChanged || titleChanged) {
        console.log(`📝 Event modified in calendar: ${booking.google_event_id}`);

        const updatePayload: Record<string, any> = {
          updated_at: new Date().toISOString(),
          synced_at: new Date().toISOString(),
        };

        if (timeChanged) {
          updatePayload.start_time = calStart;
          updatePayload.end_time = calEnd;
          updatePayload.notes = (booking.notes || "") + 
            `\n[AUTO-SYNC] Time updated from Google Calendar on ${new Date().toISOString()}`;
        }

        const { error: updateError } = await supabase
          .from("guide_booking")
          .update(updatePayload)
          .eq("id", booking.id);

        if (updateError) {
          console.error(`❌ Failed to update booking ${booking.id}:`, updateError);
          syncResult.errors.push(`Failed to update booking ${booking.id}`);
        } else {
          syncResult.updatedBookings.push(booking.id);
          console.log(`✅ Updated booking: ${booking.id}`);
        }
      }
    }

    // ── DETECT NEW EVENTS ──────────────────────────────────────
    console.log("🔍 Checking for new events...");
    
    for (const event of calendarEvents) {
      if (dbBookingMap.has(event.id)) continue;
      if (event.status === "cancelled") continue;

      const startTime = event.start?.dateTime || event.start?.date;
      const endTime = event.end?.dateTime || event.end?.date;
      const summary = event.summary || "Untitled Event";

      if (!startTime || !endTime) {
        console.warn(`⚠️ Event ${event.id} missing start/end time, skipping`);
        continue;
      }

      console.log(`➕ New event found: ${summary} (${event.id})`);

      const { data: newBooking, error: createError } = await supabase
        .from("guide_booking")
        .insert({
          guide_id: guide_id,
          start_time: startTime,
          end_time: endTime,
          status: "confirmed",
          source: "google",
          google_event_id: event.id,
          customer_name: summary,
          notes: event.description || "[AUTO-SYNC] Imported from Google Calendar",
          synced_at: new Date().toISOString(),
          calendar_sync_failed: false,
          calendar_sync_attempts: 0,
        })
        .select()
        .single();

      if (createError) {
        console.error(`❌ Failed to create booking for event ${event.id}:`, createError);
        syncResult.errors.push(`Failed to create booking for event ${event.id}`);
      } else {
        syncResult.newBookings.push(newBooking.id);
        console.log(`✅ Created booking: ${newBooking.id}`);
      }
    }

    // ── RETRY FAILED CALENDAR SYNCS ────────────────────────────
    console.log("🔄 Retrying failed calendar syncs...");

    const { data: failedBookings } = await supabase
      .from("guide_booking")
      .select("*")
      .eq("guide_id", guide_id)
      .eq("calendar_sync_failed", true)
      .is("deleted_at", null)
      .is("google_event_id", null)
      .lt("calendar_sync_attempts", 5); // Max 5 retry attempts

    for (const booking of failedBookings || []) {
      console.log(`🔄 Retrying calendar sync for booking ${booking.id} (attempt ${booking.calendar_sync_attempts + 1})`);

      try {
        const createEventUrl = `${SUPABASE_URL}/functions/v1/create-guide-booking-event`;
        const eventRes = await fetch(createEventUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            booking_id: booking.id,
            guide_id: booking.guide_id,
            start_time: booking.start_time,
            end_time: booking.end_time,
            customer_name: booking.customer_name,
            customer_email: booking.customer_email,
            trip_type: booking.trip_type,
            notes: booking.notes,
          }),
        });

        if (eventRes.ok) {
          const eventData = await eventRes.json();
          await supabase
            .from("guide_booking")
            .update({
              google_event_id: eventData.event_id,
              calendar_sync_failed: false,
              calendar_sync_error: null,
              calendar_sync_attempts: booking.calendar_sync_attempts + 1,
              synced_at: new Date().toISOString(),
            })
            .eq("id", booking.id);

          syncResult.retriedBookings.push(booking.id);
          console.log(`✅ Retry succeeded for booking ${booking.id}: event ${eventData.event_id}`);
        } else {
          const errorData = await eventRes.json();
          await supabase
            .from("guide_booking")
            .update({
              calendar_sync_attempts: booking.calendar_sync_attempts + 1,
              calendar_sync_error: errorData.error || "Unknown error",
            })
            .eq("id", booking.id);

          syncResult.errors.push(`Retry failed for booking ${booking.id}: ${errorData.error}`);
        }
      } catch (retryError: any) {
        await supabase
          .from("guide_booking")
          .update({
            calendar_sync_attempts: booking.calendar_sync_attempts + 1,
            calendar_sync_error: retryError.message,
          })
          .eq("id", booking.id);

        syncResult.errors.push(`Retry error for booking ${booking.id}: ${retryError.message}`);
      }
    }

    // ── UPDATE SYNCED TIMESTAMP ────────────────────────────────
    await supabase
      .from("guide_booking")
      .update({ synced_at: new Date().toISOString() })
      .eq("guide_id", guide_id)
      .eq("calendar_sync_failed", false)
      .is("deleted_at", null);

    // ── RETURN RESULTS ─────────────────────────────────────────
    console.log("✅ Sync completed");
    console.log(`   - Deleted: ${syncResult.deletedBookings.length}`);
    console.log(`   - New: ${syncResult.newBookings.length}`);
    console.log(`   - Updated: ${syncResult.updatedBookings.length}`);
    console.log(`   - Retried: ${syncResult.retriedBookings.length}`);
    console.log(`   - Protected: ${syncResult.protectedBookings.length}`);
    console.log(`   - Errors: ${syncResult.errors.length}`);

    return successResponse({
      syncResult,
      message: `Sync completed: ${syncResult.newBookings.length} new, ${syncResult.deletedBookings.length} deleted, ${syncResult.updatedBookings.length} updated, ${syncResult.retriedBookings.length} retried, ${syncResult.protectedBookings.length} protected`,
    });
  } catch (error: any) {
    console.error("❌ Error in sync-guide-calendar:", error);

    return errorResponse(
      error.message || "Failed to sync with Google Calendar",
      500,
      { details: error.toString() }
    );
  }
});
