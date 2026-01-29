import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const url = new URL(req.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");

  if (!start || !end) {
    return new Response(JSON.stringify({ error: "Missing start or end" }), { 
      status: 400,
      headers: corsHeaders 
    });
  }

  // Convert YYYY-MM-DD to RFC3339 format (YYYY-MM-DDTHH:MM:SSZ)
  const startISO = start.includes('T') ? start : `${start}T00:00:00Z`;
  const endISO = end.includes('T') ? end : `${end}T23:59:59Z`;
  
  console.log(`Date conversion: ${start} -> ${startISO}, ${end} -> ${endISO}`);

  // 1️⃣ Fetch all guides that connected Google Calendar
  const { data: guides } = await supabase
    .from("guide")
    .select("id, name, google_refresh_token, availability_calendar_id")
    .not("google_refresh_token", "is", null);

  const results: any[] = [];

  for (const guide of guides) {
    try {
      // 2️⃣ Exchange refresh token → access token
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: guide.google_refresh_token,
          grant_type: "refresh_token",
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) continue;

      const calendarId = guide.availability_calendar_id;
      if (!calendarId) {
        console.log(`Guide ${guide.id} (${guide.name}) has no calendar ID`);
        continue;
      }

      console.log(`Fetching events for guide ${guide.id} (${guide.name}), calendar: ${calendarId}`);
      console.log(`Date range: ${startISO} to ${endISO}`);

      // 3️⃣ Fetch availability events
      const eventsRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(startISO)}&timeMax=${encodeURIComponent(endISO)}`,
        {
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
          },
        }
      );

      console.log(`Events API response status: ${eventsRes.status}`);
      const events = await eventsRes.json();
      console.log(`Events response:`, JSON.stringify(events, null, 2));

      if (!eventsRes.ok) {
        console.error(`Calendar API error for guide ${guide.id}:`, events);
        results.push({
          guide_id: guide.id,
          name: guide.name,
          events: [],
          is_available: false,
          error: events.error?.message || "Calendar API error",
        });
        continue;
      }

      results.push({
        guide_id: guide.id,
        name: guide.name,
        events: events.items || [],
        is_available: (events.items || []).length > 0,
      });

    } catch (err) {
      results.push({
        guide_id: guide.id,
        error: String(err),
        is_available: false,
      });
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
