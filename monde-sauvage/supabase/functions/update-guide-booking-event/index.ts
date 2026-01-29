// Supabase Edge Function: update-guide-booking-event
// Updates a Google Calendar event when booking is modified

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  console.log("📩 Updating Google Calendar event for guide booking");

  try {
    const SUPABASE_URL = Deno.env.get("URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const {
      booking_id,
      event_id,
      guide_id,
      updates
    } = await req.json();

    if (!event_id || !guide_id || !updates) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`📝 Updating event: ${event_id}`);

    // Get access token
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

    // Get guide email
    const { data: guide, error: guideError } = await supabase
      .from("guide")
      .select("email")
      .eq("id", guide_id)
      .single();

    if (guideError || !guide) {
      throw new Error("Guide not found");
    }

    const calendarId = guide.email;

    // Build update object
    const eventUpdate: any = {};

    if (updates.start_time || updates.end_time) {
      if (updates.start_time) {
        eventUpdate.start = {
          dateTime: updates.start_time,
          timeZone: "America/Montreal"
        };
      }
      if (updates.end_time) {
        eventUpdate.end = {
          dateTime: updates.end_time,
          timeZone: "America/Montreal"
        };
      }
    }

    if (updates.customer_name) {
      eventUpdate.summary = updates.customer_name;
    }

    if (updates.notes !== undefined) {
      eventUpdate.description = updates.notes;
    }

    // Update event in Google Calendar
    console.log("📅 Updating event in Google Calendar...");
    
    const calendarApiUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event_id)}`;

    const updateRes = await fetch(calendarApiUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventUpdate),
    });

    if (!updateRes.ok) {
      const errorData = await updateRes.json();
      throw new Error(`Google Calendar API error: ${errorData.error?.message || 'Unknown error'}`);
    }

    const updatedEvent = await updateRes.json();
    console.log(`✅ Event updated: ${updatedEvent.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        event_id: updatedEvent.id,
        message: "Google Calendar event updated successfully"
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("❌ Error updating calendar event:", error);
    
    return new Response(
      JSON.stringify({ 
        error: error.message || "Failed to update calendar event",
        details: error.toString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
