// Supabase Edge Function: create-booking-calendar-event
// Creates a Google Calendar event when a booking is made on the website
// Bookings table is the source of truth, Google Calendar is synced

import { createClient } from "@supabase/supabase-js";

// CORS headers
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

  console.log("📩 Received create booking calendar event request");

  try {
    // Read environment variables
    const SUPABASE_URL = Deno.env.get("URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse request body
    const body = await req.json();
    const {
      booking_id,
      calendar_id,
      chalet_name,
      start_date,
      end_date,
      customer_name,
      customer_email,
      notes
    } = body;

    if (!booking_id || !calendar_id || !start_date || !end_date || !customer_name) {
      console.log("❌ Missing required fields");
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("📝 Creating Google Calendar event for booking:", booking_id);
    console.log("📅 Calendar ID:", calendar_id);
    console.log("📆 Dates:", start_date, "to", end_date);

    // Get the booking to find chalet and establishment
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("chalet_id")
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      console.log("❌ Booking not found:", bookingError);
      return new Response(
        JSON.stringify({ error: "Booking not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get the chalet to find establishment
    let chalet = null;
    let response = await supabase
      .from("chalets")
      .select("etablishment_id")
      .eq("key", booking.chalet_id)
      .single();

    if (response.error) {
      response = await supabase
        .from("Chalets")
        .select("etablishment_id")
        .eq("key", booking.chalet_id)
        .single();
    }

    chalet = response.data;

    if (!chalet) {
      console.log("❌ Chalet not found");
      return new Response(
        JSON.stringify({ error: "Chalet not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const establishmentId = chalet.etablishment_id;
    console.log("🏢 Establishment ID:", establishmentId);

    // Get establishment's Google Calendar access token
    console.log("🔄 Getting access token for establishment...");
    const tokenRefreshUrl = `${SUPABASE_URL}/functions/v1/refresh-google-token?establishmentId=${establishmentId}`;
    
    const tokenRes = await fetch(tokenRefreshUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    if (!tokenRes.ok) {
      const errorData = await tokenRes.json();
      console.log("❌ Token refresh error:", errorData);
      
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
    console.log(`✅ Access token obtained ${tokenData.cached ? '(cached)' : '(refreshed)'}`);

    // Create Google Calendar event
    console.log("📅 Creating Google Calendar event...");

    /** Google Calendar all-day events require `date` as YYYY-MM-DD only (not ISO timestamps). */
    const toGoogleAllDayDate = (raw: string): string => {
      const s = String(raw).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) {
        throw new Error(`Invalid date for Google Calendar: ${raw}`);
      }
      return d.toISOString().slice(0, 10);
    };

    let startDay: string;
    let endDay: string;
    try {
      startDay = toGoogleAllDayDate(start_date);
      endDay = toGoogleAllDayDate(end_date);
      if (startDay >= endDay) {
        return new Response(
          JSON.stringify({
            error: "Invalid date range for Google Calendar",
            details:
              "Pour une réservation « journée entière », la date de fin doit être après la date de début (fin exclusive).",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    } catch (e) {
      console.log("❌ Date parse error:", e);
      return new Response(
        JSON.stringify({
          error: "Invalid start_date or end_date",
          details: (e as Error).message,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create event object (all-day; end.date is exclusive per Google API — matches DB checkout day).
    // Ne pas mettre `attendees` ici : l’API refuse souvent les invitations depuis un sous-agenda
    // secondaire ou sans domaine G Workspace (403 / Invalid attendee). Le courriel reste dans la description.
    const descriptionLines = [
      `Réservation : ${customer_name}`,
      customer_email ? `Courriel : ${customer_email}` : null,
      notes ? `\nNotes :\n${notes}` : null,
    ].filter(Boolean).join("\n");

    const event = {
      summary: `${chalet_name} - ${customer_name}`,
      description: descriptionLines,
      start: {
        date: startDay,
      },
      end: {
        date: endDay,
      },
      transparency: "opaque",
      extendedProperties: {
        private: {
          booking_id: String(booking_id),
          source: "monde_sauvage_website",
        },
      },
    };

    // sendUpdates=none : pas d’e-mails aux participants (il n’y en a plus dans le corps).
    const eventsUrl =
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events?sendUpdates=none`;

    const createEventRes = await fetch(eventsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });

    if (!createEventRes.ok) {
      const errorText = await createEventRes.text();
      console.log("❌ Failed to create Google Calendar event:", createEventRes.status);
      console.log("Error details:", errorText);

      let googleMessage = errorText;
      try {
        const parsed = JSON.parse(errorText) as {
          error?: { message?: string; errors?: Array<{ reason?: string; message?: string }> };
        };
        googleMessage =
          parsed?.error?.message ||
          parsed?.error?.errors?.map((e) => e.message || e.reason).filter(Boolean).join("; ") ||
          errorText;
      } catch {
        // garder errorText brut
      }

      return new Response(
        JSON.stringify({
          error: "Failed to create Google Calendar event",
          details: googleMessage,
        }),
        {
          status: createEventRes.status > 599 ? 502 : createEventRes.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const createdEvent = await createEventRes.json();
    console.log("✅ Google Calendar event created:", createdEvent.id);

    // Update the booking with the Google event ID
    const { error: updateError } = await supabase
      .from("bookings")
      .update({ google_event_id: createdEvent.id })
      .eq("id", booking_id);

    if (updateError) {
      console.warn("⚠️ Failed to update booking with Google event ID:", updateError);
      // Don't fail the request - event was created successfully
    } else {
      console.log("✅ Booking updated with Google event ID");
    }

    return new Response(
      JSON.stringify({
        success: true,
        event_id: createdEvent.id,
        event_link: createdEvent.htmlLink,
        message: "Booking synced to Google Calendar successfully"
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("=== ERROR ===");
    console.error("Error:", error);
    console.error("Message:", (error as Error).message);
    
    return new Response(
      JSON.stringify({ 
        error: "Internal server error",
        message: (error as Error).message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
