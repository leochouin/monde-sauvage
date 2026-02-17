// Supabase Edge Function: google-calendar-availability
// This function fetches Google Calendar events for a guide using their refresh token.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";
Deno.serve(async (req)=>{
  console.log("📩 Received request");
  // Read secrets inside the handler
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: allGuides } = await supabase.from("guide").select("*");
  console.log("All guides in DB:", allGuides);
  const url = new URL(req.url);
  const guideId = url.searchParams.get("guide_id") || url.searchParams.get("id") || url.searchParams.get("uuid") || url.searchParams.get("guide") || null;
  if (!guideId) {
    console.log("❌ Missing guide_id");
    return new Response(JSON.stringify({
      error: "Missing guide_id"
    }), {
      status: 400
    });
  }
  console.log("🧭 Guide ID:", guideId);
  // 1️⃣ Get guide’s refresh token
  const { data, error } = await supabase.from("guide").select("google_refresh_token").eq("id", guideId).single();
  if (error || !data || !data.google_refresh_token) {
    console.log("❌ Guide not found or refresh token missing:", error);
    return new Response(JSON.stringify({
      error: "Guide not found or refresh token missing"
    }), {
      status: 404
    });
  }
  console.log("🔑 Refresh token found:", data.google_refresh_token.slice(0, 10) + "...");
  // 2️⃣ Exchange refresh token for new access token
  console.log("🔄 Requesting new access token...");
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: data.google_refresh_token,
      grant_type: "refresh_token"
    })
  });
  const tokenData = await tokenRes.json();
  console.log("📡 Token response from Google:", tokenData);
  if (!tokenData.access_token) {
    console.log("❌ Failed to get access token");
    return new Response(JSON.stringify({
      error: tokenData.error,
      description: tokenData.error_description
    }), {
      status: 400,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  // 3️⃣ Fetch events from Google Calendar
  // Use the start/end params from the request, or default to now + 7 days
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  
  const timeMin = startParam || new Date().toISOString();
  const timeMax = endParam || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  
  console.log("📅 Fetching events from:", timeMin, "to:", timeMax);
  const eventsRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}`, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`
    }
  });
  const events = await eventsRes.json();
  console.log("✅ Events fetched:", events.items?.length || 0);
  return new Response(JSON.stringify(events), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
});
