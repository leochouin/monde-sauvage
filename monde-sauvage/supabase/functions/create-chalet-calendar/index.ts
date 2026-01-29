// Supabase Edge Function: create-chalet-calendar
// This function creates a new Google Calendar for a chalet and stores the calendar ID

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

  console.log("📩 Received create chalet calendar request");

  try {
    // Read environment variables
    const SUPABASE_URL = Deno.env.get("URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse request body
    const body = await req.json();
    const { chalet_id, chalet_name } = body;

    if (!chalet_id || !chalet_name) {
      console.log("❌ Missing chalet_id or chalet_name");
      return new Response(JSON.stringify({ error: "Missing chalet_id or chalet_name" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("🏠 Chalet ID:", chalet_id);
    console.log("📝 Chalet Name:", chalet_name);

    // Get the chalet to verify it exists and get owner info
    // Try both 'Chalets' and 'chalets' table names, and both 'key' and 'id' columns
    let chalet = null;
    let chaletError = null;

    // Try with capital C and 'key' column
    let response = await supabase
      .from("Chalets")
      .select("*, Etablissement!inner(owner_id)")
      .eq("key", chalet_id)
      .single();

    if (response.error) {
      // Try with lowercase and 'key' column
      response = await supabase
        .from("chalets")
        .select("*, etablissement:etablishment_id!inner(owner_id)")
        .eq("key", chalet_id)
        .single();
    }

    if (response.error) {
      // Try with lowercase and 'id' column
      response = await supabase
        .from("chalets")
        .select("*, etablissement:etablishment_id!inner(owner_id)")
        .eq("id", chalet_id)
        .single();
    }

    chalet = response.data;
    chaletError = response.error;

    if (chaletError || !chalet) {
      console.log("❌ Chalet not found:", chaletError);
      console.log("❌ Searched for chalet_id:", chalet_id);
      return new Response(JSON.stringify({ error: "Chalet not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if chalet already has a calendar
    if (chalet.google_calendar) {
      console.log("ℹ️ Chalet already has a calendar:", chalet.google_calendar);
      return new Response(
        JSON.stringify({ 
          calendar_id: chalet.google_calendar,
          message: "Calendar already exists" 
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get the establishment's Google Calendar ID (refresh token)
    const establishmentId = chalet.etablishment_id || chalet.establishment_id || chalet.etablissement_id;
    console.log("🏢 Establishment ID:", establishmentId);

    if (!establishmentId) {
      console.log("❌ No establishment_id found in chalet data");
      console.log("Chalet object:", JSON.stringify(chalet));
      return new Response(
        JSON.stringify({ 
          error: "Could not determine chalet's establishment. Please check database structure.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get the establishment's Google refresh token
    let establishmentData = null;
    
    // Try with capital E
    let estResponse = await supabase
      .from("Etablissement")
      .select("google_calendar_id")
      .eq("key", establishmentId)
      .single();

    if (estResponse.error) {
      // Try lowercase
      estResponse = await supabase
        .from("etablissement")
        .select("google_calendar_id")
        .eq("key", establishmentId)
        .single();
    }

    if (estResponse.error) {
      // Try with id column
      estResponse = await supabase
        .from("etablissement")
        .select("google_calendar_id")
        .eq("id", establishmentId)
        .single();
    }

    establishmentData = estResponse.data;

    if (estResponse.error || !establishmentData?.google_calendar_id) {
      console.log("❌ No Google Calendar connected to establishment");
      return new Response(
        JSON.stringify({ 
          error: "No Google Calendar access. Please connect your establishment's Google account first.",
          requiresAuth: true 
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("🔑 Refresh token found for establishment");

    // Exchange refresh token for access token
    console.log("🔄 Requesting new access token...");
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: establishmentData.google_calendar_id,
        grant_type: "refresh_token",
      }),
    });

    const tokenData = await tokenRes.json();
    console.log("📡 Token response status:", tokenRes.status);

    if (tokenData.error) {
      console.log("❌ Token error:", tokenData.error);
      
      // If refresh token is invalid, clear it from establishment
      if (tokenData.error === "invalid_grant") {
        // Try to clear from both possible table names
        await supabase
          .from("Etablissement")
          .update({ google_calendar_id: null })
          .eq("key", establishmentId);
        
        await supabase
          .from("etablissement")
          .update({ google_calendar_id: null })
          .eq("key", establishmentId);
      }
      
      return new Response(
        JSON.stringify({ 
          error: "Failed to refresh access token",
          requiresAuth: true 
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const accessToken = tokenData.access_token;
    console.log("✅ Access token obtained");

    // Create a new Google Calendar
    console.log("📅 Creating new Google Calendar...");
    
    const createCalendarRes = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: chalet_name,
          description: `Calendrier de réservations pour ${chalet_name}`,
          timeZone: "America/Toronto",
        }),
      }
    );

    if (!createCalendarRes.ok) {
      console.log("❌ Failed to create calendar:", createCalendarRes.status);
      const errorText = await createCalendarRes.text();
      console.log("Error details:", errorText);
      
      return new Response(
        JSON.stringify({ error: "Failed to create Google Calendar" }),
        {
          status: createCalendarRes.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const calendarData = await createCalendarRes.json();
    const calendarId = calendarData.id;
    console.log("✅ Calendar created with ID:", calendarId);

    // Update the chalet with the new calendar ID
    // Try both table names and column identifiers
    let updateResponse = await supabase
      .from("chalets")
      .update({ google_calendar: calendarId })
      .eq("key", chalet_id);

    if (updateResponse.error) {
      updateResponse = await supabase
        .from("chalets")
        .update({ google_calendar: calendarId })
        .eq("id", chalet_id);
    }

    if (updateResponse.error) {
      updateResponse = await supabase
        .from("Chalets")
        .update({ google_calendar: calendarId })
        .eq("key", chalet_id);
    }

    if (updateResponse.error) {
      console.error("❌ Failed to update chalet with calendar ID:", updateResponse.error);
      // Note: Calendar was created but DB update failed
      // We still return success with the calendar ID
      return new Response(
        JSON.stringify({ 
          calendar_id: calendarId,
          warning: "Calendar created but failed to save to database"
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("✅ Chalet updated with calendar ID");

    return new Response(
      JSON.stringify({ 
        calendar_id: calendarId,
        message: "Calendar created successfully"
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
