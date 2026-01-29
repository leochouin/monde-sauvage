// Supabase Edge Function: check-google-token
// This function checks if a guide's Google refresh token is still valid
// Returns status indicating if re-authentication is needed

import { createClient } from "@supabase/supabase-js";

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

  const SUPABASE_URL = Deno.env.get("URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const url = new URL(req.url);
  const guideId = url.searchParams.get("guideId");

  if (!guideId) {
    return new Response(JSON.stringify({ error: "Missing guideId" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Get guide's refresh token
  const { data: guide, error } = await supabase
    .from("guide")
    .select("google_refresh_token, google_token_created_at")
    .eq("id", guideId)
    .single();

  if (error || !guide) {
    return new Response(
      JSON.stringify({ 
        valid: false, 
        error: "Guide not found",
        requiresAuth: true
      }),
      {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // If no token exists, need to authenticate
  if (!guide.google_refresh_token) {
    return new Response(
      JSON.stringify({ 
        valid: false, 
        requiresAuth: true,
        message: "No Google Calendar connection found"
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Try to use the refresh token to get an access token
  try {
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

    // Token is invalid/expired
    if (tokenData.error === "invalid_grant" || !tokenData.access_token) {
      console.log(`Token invalid for guide ${guideId}. Clearing from database.`);
      
      // Clear the expired token
      await supabase
        .from("guide")
        .update({ 
          google_refresh_token: null,
          google_token_created_at: null 
        })
        .eq("id", guideId);

      return new Response(
        JSON.stringify({ 
          valid: false, 
          requiresAuth: true,
          error: "invalid_grant",
          message: "Google Calendar connection expired. Please reconnect."
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Token is valid
    return new Response(
      JSON.stringify({ 
        valid: true, 
        requiresAuth: false,
        message: "Google Calendar connection is active"
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Error checking token:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ 
        valid: false, 
        error: "Check failed",
        message: errorMessage
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
