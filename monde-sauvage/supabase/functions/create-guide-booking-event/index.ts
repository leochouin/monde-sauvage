// Supabase Edge Function: create-guide-booking-event
// Creates a Google Calendar event for a guide booking
// Called after booking is created in database

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  console.log("📩 Creating Google Calendar event for guide booking");

  try {
    const SUPABASE_URL = Deno.env.get("URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse request
    const {
      booking_id,
      guide_id,
      start_time,
      end_time,
      customer_name,
      customer_email,
      trip_type,
      notes
    } = await req.json();

    if (!booking_id || !guide_id || !start_time || !end_time || !customer_name) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`📝 Creating event for booking: ${booking_id}`);

    // 1️⃣ Get access token
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

    // 2️⃣ Get guide email for calendar ID
    const { data: guide, error: guideError } = await supabase
      .from("guide")
      .select("email, name")
      .eq("id", guide_id)
      .single();

    if (guideError || !guide) {
      throw new Error("Guide not found");
    }

    const calendarId = guide.email; // Primary calendar

    // 3️⃣ Create event object
    const eventTitle = trip_type 
      ? `${trip_type} - ${customer_name}`
      : customer_name;

    const eventDescription = [
      `Booking ID: ${booking_id}`,
      customer_email ? `Email: ${customer_email}` : '',
      notes ? `\nNotes: ${notes}` : '',
      '\n---',
      'Created via Monde Sauvage booking system'
    ].filter(Boolean).join('\n');

    const event = {
      summary: eventTitle,
      description: eventDescription,
      start: {
        dateTime: start_time,
        timeZone: "America/Montreal" // Adjust as needed
      },
      end: {
        dateTime: end_time,
        timeZone: "America/Montreal"
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 24 * 60 }, // 1 day before
          { method: "popup", minutes: 60 }, // 1 hour before
        ],
      }
    };

    // Add attendee if email provided
    if (customer_email) {
      event.attendees = [
        { email: customer_email }
      ];
    }

    // 4️⃣ Create event in Google Calendar
    console.log("📅 Creating event in Google Calendar...");
    
    const calendarApiUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

    const createRes = await fetch(calendarApiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });

    if (!createRes.ok) {
      const errorData = await createRes.json();
      throw new Error(`Google Calendar API error: ${errorData.error?.message || 'Unknown error'}`);
    }

    const createdEvent = await createRes.json();
    console.log(`✅ Event created: ${createdEvent.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        event_id: createdEvent.id,
        event_link: createdEvent.htmlLink,
        message: "Google Calendar event created successfully"
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("❌ Error creating calendar event:", error);
    
    return new Response(
      JSON.stringify({ 
        error: error.message || "Failed to create calendar event",
        details: error.toString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
