// Supabase Edge Function: chalet-calendar-events
// This function fetches Google Calendar events for a chalet

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

  console.log("📩 Received chalet calendar events request");

  try {
    // Read environment variables
    const SUPABASE_URL = Deno.env.get("URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const url = new URL(req.url);
    const calendarId = url.searchParams.get("calendar_id");
    const chaletId = url.searchParams.get("chalet_id");
    const startDate = url.searchParams.get("start_date");
    const endDate = url.searchParams.get("end_date");

    if (!calendarId || !chaletId) {
      console.log("❌ Missing calendar_id or chalet_id");
      return new Response(JSON.stringify({ error: "Missing calendar_id or chalet_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("🏠 Chalet ID:", chaletId);
    console.log("📅 Calendar ID:", calendarId);
    console.log("📆 Date range:", startDate, "to", endDate);

    // Get the chalet to get establishment info
    let chalet = null;
    let chaletError = null;

    // Try with capital C and 'key' column
    let response = await supabase
      .from("Chalets")
      .select("etablishment_id")
      .eq("key", chaletId)
      .single();

    if (response.error) {
      // Try with lowercase and 'key' column
      response = await supabase
        .from("chalets")
        .select("etablishment_id")
        .eq("key", chaletId)
        .single();
    }

    if (response.error) {
      // Try with 'id' column
      response = await supabase
        .from("chalets")
        .select("etablishment_id")
        .eq("id", chaletId)
        .single();
    }

    chalet = response.data;
    chaletError = response.error;

    if (chaletError || !chalet) {
      console.log("❌ Chalet not found:", chaletError);
      return new Response(JSON.stringify({ error: "Chalet not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the establishment's Google Calendar ID (refresh token)
    const establishmentId = chalet.etablishment_id;
    console.log("🏢 Establishment ID:", establishmentId);

    if (!establishmentId) {
      console.log("❌ No establishment_id found in chalet");
      return new Response(
        JSON.stringify({ 
          error: "Could not determine chalet's establishment",
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

    // Use the centralized refresh-google-token function with automatic caching
    console.log("🔄 Calling refresh-google-token function...");
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
      
      // Only return requiresAuth if the refresh function says so
      if (errorData.requiresReauth) {
        return new Response(
          JSON.stringify({ 
            error: "Failed to refresh access token. Please reconnect your Google Calendar.",
            requiresAuth: true 
          }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      
      // For other errors, return a more generic error without forcing reconnection
      return new Response(
        JSON.stringify({ 
          error: errorData.error || "Failed to refresh access token",
        }),
        {
          status: tokenRes.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    console.log(`✅ Access token obtained ${tokenData.cached ? '(cached)' : '(refreshed)'}`);

    // Fetch calendar events from Google Calendar API
    console.log("📆 Fetching calendar events...");
    
    // Use provided date range if available, otherwise default to now + 6 months
    let timeMin, timeMax;
    if (startDate && endDate) {
      timeMin = new Date(startDate);
      timeMax = new Date(endDate);
    } else {
      timeMin = new Date();
      timeMax = new Date();
      timeMax.setMonth(timeMax.getMonth() + 6);
    }

    const calendarApiUrl = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
    );
    calendarApiUrl.searchParams.set("timeMin", timeMin.toISOString());
    calendarApiUrl.searchParams.set("timeMax", timeMax.toISOString());
    calendarApiUrl.searchParams.set("singleEvents", "true");
    calendarApiUrl.searchParams.set("orderBy", "startTime");
    calendarApiUrl.searchParams.set("maxResults", "50");

    const eventsRes = await fetch(calendarApiUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!eventsRes.ok) {
      console.log("❌ Failed to fetch calendar events:", eventsRes.status);
      const errorText = await eventsRes.text();
      console.log("Error details:", errorText);
      
      return new Response(
        JSON.stringify({ error: "Failed to fetch calendar events" }),
        {
          status: eventsRes.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const eventsData = await eventsRes.json();
    console.log(`✅ Found ${eventsData.items?.length || 0} events`);

    // Sync events to bookings table
    const events = eventsData.items || [];
    console.log("📥 Syncing events to bookings table...");

    for (const event of events) {
      // Skip events without start dates
      if (!event.start?.dateTime && !event.start?.date) {
        console.log("⏭️ Skipping event without start date:", event.id);
        continue;
      }

      const startDate = event.start.dateTime || event.start.date;
      const endDate = event.end?.dateTime || event.end?.date || startDate;

      // Check if booking already exists
      const { data: existingBooking } = await supabase
        .from("bookings")
        .select("id, status, source")
        .eq("google_event_id", event.id)
        .eq("chalet_id", chaletId)
        .single();

      if (existingBooking) {
        // Update existing booking if it's still from Google Calendar
        if (existingBooking.status === "confirmed" && existingBooking.source === "google") {
          const { error: updateError } = await supabase
            .from("bookings")
            .update({
              start_date: startDate,
              end_date: endDate,
              customer_name: event.summary || "Réservation Google Calendar",
              notes: event.description || null,
            })
            .eq("id", existingBooking.id);

          if (updateError) {
            console.error("❌ Failed to update booking:", updateError);
          } else {
            console.log("✅ Updated booking:", existingBooking.id);
          }
        } else {
          console.log("⏭️ Skipping non-Google booking:", existingBooking.id);
        }
      } else {
        // Create new booking
        const { error: insertError } = await supabase
          .from("bookings")
          .insert({
            chalet_id: chaletId,
            start_date: startDate,
            end_date: endDate,
            status: "confirmed",
            source: "google",
            google_event_id: event.id,
            customer_name: event.summary || "Réservation Google Calendar",
            customer_email: event.creator?.email || null,
            notes: event.description || null,
          });

        if (insertError) {
          console.error("❌ Failed to insert booking:", insertError);
        } else {
          console.log("✅ Created new booking for event:", event.id);
        }
      }
    }

    // Get all bookings from database to return
    // If date range is specified, only return overlapping bookings
    let bookingsQuery = supabase
      .from("bookings")
      .select("*")
      .eq("chalet_id", chaletId)
      .eq("status", "confirmed")
      .order("start_date", { ascending: true });

    if (startDate && endDate) {
      // Only return bookings that overlap with the requested date range
      // A booking overlaps if: start_date < endDate AND end_date > startDate
      console.log(`🔍 Filtering bookings for overlap with ${startDate} to ${endDate}`);
      bookingsQuery = bookingsQuery
        .lt("start_date", endDate)
        .gt("end_date", startDate);
    } else {
      // If no date range specified, return all future bookings
      bookingsQuery = bookingsQuery.gte("end_date", new Date().toISOString());
    }

    const { data: bookings, error: bookingsError } = await bookingsQuery;

    if (bookingsError) {
      console.error("❌ Failed to fetch bookings:", bookingsError);
    }

    console.log(`✅ Returning ${bookings?.length || 0} ${startDate && endDate ? 'overlapping' : 'future'} bookings from database`);

    return new Response(
      JSON.stringify({ 
        events: events,
        bookings: bookings || [],
        calendar_id: calendarId
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
