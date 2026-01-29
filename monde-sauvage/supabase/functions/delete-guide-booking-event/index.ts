// Supabase Edge Function: delete-guide-booking-event
// Deletes a Google Calendar event when booking is cancelled

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

  console.log("📩 Deleting Google Calendar event for guide booking");

  try {
    const SUPABASE_URL = Deno.env.get("URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { event_id, guide_id } = await req.json();

    if (!event_id || !guide_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`🗑️ Deleting event: ${event_id}`);

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

    // Delete event from Google Calendar
    console.log("📅 Deleting event from Google Calendar...");
    
    const calendarApiUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event_id)}`;

    const deleteRes = await fetch(calendarApiUrl, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!deleteRes.ok && deleteRes.status !== 404) {
      // 404 means already deleted, which is fine
      const errorData = await deleteRes.json();
      throw new Error(`Google Calendar API error: ${errorData.error?.message || 'Unknown error'}`);
    }

    console.log(`✅ Event deleted: ${event_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Google Calendar event deleted successfully"
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("❌ Error deleting calendar event:", error);
    
    return new Response(
      JSON.stringify({ 
        error: error.message || "Failed to delete calendar event",
        details: error.toString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
