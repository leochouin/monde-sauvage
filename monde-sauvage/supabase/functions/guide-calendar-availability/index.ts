// Supabase Edge Function: guide-calendar-availability
// Checks Google Calendar for conflicting events in a time range
// Used for double-checking availability before creating bookings

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

  console.log("🔍 Checking guide calendar availability");

  try {
    const SUPABASE_URL = Deno.env.get("URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const url = new URL(req.url);
    const guide_id = url.searchParams.get("guide_id");
    const start_time = url.searchParams.get("start_time");
    const end_time = url.searchParams.get("end_time");

    if (!guide_id || !start_time || !end_time) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`📅 Checking availability for guide: ${guide_id}`);
    console.log(`   Time range: ${start_time} to ${end_time}`);

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

    // Query Google Calendar for events in time range
    console.log("📅 Fetching events from Google Calendar...");
    
    const calendarApiUrl = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    calendarApiUrl.searchParams.set("timeMin", start_time);
    calendarApiUrl.searchParams.set("timeMax", end_time);
    calendarApiUrl.searchParams.set("singleEvents", "true");
    calendarApiUrl.searchParams.set("orderBy", "startTime");

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
    const events = calendarData.items || [];

    // Filter out cancelled events
    const activeEvents = events.filter((event: any) => event.status !== "cancelled");

    console.log(`📊 Found ${activeEvents.length} conflicting events`);

    // Format conflicts
    const conflicts = activeEvents.map((event: any) => ({
      id: event.id,
      summary: event.summary || "Untitled Event",
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
      link: event.htmlLink
    }));

    return new Response(
      JSON.stringify({
        available: conflicts.length === 0,
        conflicts,
        message: conflicts.length === 0 
          ? "Guide is available for this time slot"
          : `Found ${conflicts.length} conflicting event(s)`
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("❌ Error checking calendar availability:", error);
    
    return new Response(
      JSON.stringify({ 
        error: error.message || "Failed to check calendar availability",
        details: error.toString()
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
