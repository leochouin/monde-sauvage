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

    // Format dates for Google Calendar (all-day events use date format, not dateTime)
    const startDateObj = new Date(start_date);
    const endDateObj = new Date(end_date);

    // Create event object
    const event = {
      summary: `${chalet_name} - ${customer_name}`,
      description: notes 
        ? `Réservation par ${customer_name}\nEmail: ${customer_email}\n\nNotes: ${notes}`
        : `Réservation par ${customer_name}\nEmail: ${customer_email}`,
      start: {
        date: start_date, // Use 'date' for all-day events
      },
      end: {
        date: end_date, // Use 'date' for all-day events
      },
      attendees: customer_email ? [{ email: customer_email }] : [],
      // Mark as busy to block time
      transparency: "opaque",
      // Add metadata to identify this as a website booking
      extendedProperties: {
        private: {
          booking_id: booking_id.toString(),
          source: "monde_sauvage_website"
        }
      }
    };

    const createEventRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      }
    );

    if (!createEventRes.ok) {
      const errorText = await createEventRes.text();
      console.log("❌ Failed to create Google Calendar event:", createEventRes.status);
      console.log("Error details:", errorText);
      
      return new Response(
        JSON.stringify({ 
          error: "Failed to create Google Calendar event",
          details: errorText
        }),
        {
          status: createEventRes.status,
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
