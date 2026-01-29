// Supabase Edge Function: sync-guide-calendar
// Syncs guide bookings bidirectionally with Google Calendar
// 
// WORKFLOW:
// 1. Fetch all events from guide's Google Calendar
// 2. Compare with guide_booking table using google_event_id
// 3. Detect deletions (exists in DB but not in Calendar)
// 4. Detect new events (exists in Calendar but not in DB)
// 5. Update database to reflect changes
// 
// SECURITY:
// - Paid bookings cannot be deleted by calendar sync
// - Deletions are soft-deleted (marked, not removed)
// - All changes are logged for audit trail

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SyncResult {
  deletedBookings: string[];
  newBookings: string[];
  updatedBookings: string[];
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
      return new Response(
        JSON.stringify({ error: "Missing guide_id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`📋 Syncing bookings for guide: ${guide_id}`);

    const syncResult: SyncResult = {
      deletedBookings: [],
      newBookings: [],
      updatedBookings: [],
      errors: [],
      protectedBookings: [],
    };

    // 1️⃣ Get guide's Google Calendar access token
    console.log("🔑 Getting access token...");
    const tokenUrl = `${SUPABASE_URL}/functions/v1/refresh-google-token?guideId=${guide_id}`;
    
    const tokenRes = await fetch(tokenUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    if (!tokenRes.ok) {
      const errorData = await tokenRes.json();
      console.log("❌ Failed to get access token:", errorData);
      
      return new Response(
        JSON.stringify({ 
          error: "Failed to authenticate with Google Calendar",
          requiresAuth: errorData.requiresReauth || false
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    console.log("✅ Access token obtained");

    // 2️⃣ Get guide's email to fetch their primary calendar
    const { data: guide, error: guideError } = await supabase
      .from("guide")
      .select("email")
      .eq("id", guide_id)
      .single();

    if (guideError || !guide) {
      throw new Error("Guide not found");
    }

    const calendarId = guide.email; // Primary calendar uses email as ID

    // 3️⃣ Fetch all events from Google Calendar (next 6 months)
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

    const calendarRes = await fetch(calendarApiUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!calendarRes.ok) {
      const errorData = await calendarRes.json();
      throw new Error(`Google Calendar API error: ${errorData.error?.message || 'Unknown error'}`);
    }

    const calendarData = await calendarRes.json();
    const calendarEvents = calendarData.items || [];
    console.log(`📊 Found ${calendarEvents.length} events in Google Calendar`);

    // 4️⃣ Get all active bookings from database
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

    // 5️⃣ Create maps for comparison
    const calendarEventMap = new Map();
    calendarEvents.forEach((event: any) => {
      if (event.id) {
        calendarEventMap.set(event.id, event);
      }
    });

    const dbBookingMap = new Map();
    dbBookings?.forEach((booking: any) => {
      if (booking.google_event_id) {
        dbBookingMap.set(booking.google_event_id, booking);
      }
    });

    // 6️⃣ DETECT DELETIONS: Events in DB but not in Calendar
    console.log("🔍 Checking for deleted events...");
    
    for (const booking of dbBookings || []) {
      // Skip bookings that were created in the system without Google Calendar sync
      if (!booking.google_event_id) {
        continue;
      }

      // If event doesn't exist in calendar anymore, it was deleted
      if (!calendarEventMap.has(booking.google_event_id)) {
        console.log(`🗑️ Event deleted from calendar: ${booking.google_event_id}`);

        // SECURITY: Check if booking is paid
        if (booking.is_paid) {
          console.log(`⚠️ Cannot delete paid booking: ${booking.id}`);
          syncResult.protectedBookings.push(booking.id);
          
          // Optionally notify admin/customer
          // TODO: Send notification about paid booking deletion attempt
          continue;
        }

        // Soft delete the booking
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

    // 7️⃣ DETECT NEW EVENTS: Events in Calendar but not in DB
    console.log("🔍 Checking for new events...");
    
    for (const event of calendarEvents) {
      // Skip if event already exists in DB
      if (dbBookingMap.has(event.id)) {
        continue;
      }

      // Skip cancelled events
      if (event.status === "cancelled") {
        continue;
      }

      // Extract event details
      const startTime = event.start?.dateTime || event.start?.date;
      const endTime = event.end?.dateTime || event.end?.date;
      const summary = event.summary || "Untitled Event";

      if (!startTime || !endTime) {
        console.warn(`⚠️ Event ${event.id} missing start/end time, skipping`);
        continue;
      }

      console.log(`➕ New event found: ${summary} (${event.id})`);

      // Create new booking from calendar event
      const { data: newBooking, error: createError } = await supabase
        .from("guide_booking")
        .insert({
          guide_id: guide_id,
          start_time: startTime,
          end_time: endTime,
          status: "confirmed", // Events in calendar are considered confirmed
          source: "google", // Came from Google Calendar
          google_event_id: event.id,
          customer_name: summary, // Use event title as customer name
          notes: event.description || "[AUTO-SYNC] Imported from Google Calendar",
          synced_at: new Date().toISOString()
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

    // 8️⃣ UPDATE SYNCED TIMESTAMP
    const { error: updateSyncError } = await supabase
      .from("guide_booking")
      .update({ synced_at: new Date().toISOString() })
      .eq("guide_id", guide_id)
      .is("deleted_at", null);

    if (updateSyncError) {
      console.warn("⚠️ Could not update sync timestamps:", updateSyncError);
    }

    // 9️⃣ Return sync results
    console.log("✅ Sync completed");
    console.log(`   - Deleted: ${syncResult.deletedBookings.length}`);
    console.log(`   - New: ${syncResult.newBookings.length}`);
    console.log(`   - Protected: ${syncResult.protectedBookings.length}`);
    console.log(`   - Errors: ${syncResult.errors.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        syncResult,
        message: `Sync completed: ${syncResult.newBookings.length} new, ${syncResult.deletedBookings.length} deleted, ${syncResult.protectedBookings.length} protected`
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("❌ Error in sync-guide-calendar:", error);
    
    return new Response(
      JSON.stringify({ 
        error: error.message || "Failed to sync with Google Calendar",
        details: error.toString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
