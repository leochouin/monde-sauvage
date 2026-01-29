// Supabase Edge Function: google-calendar-oauth
// This function handles Google OAuth for Calendar access
// It asks for permission and stores the returned tokens.
import { createClient } from "@supabase/supabase-js";

// These are the Google API endpoints we'll use
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

// Start the Edge function
Deno.serve(async (req: Request) => {
  try {
    console.log("=== Google Calendar OAuth Function Started ===");
    console.log("Request URL:", req.url);
    
    // Check environment variables
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const REDIRECT_URI = Deno.env.get("REDIRECT_URI") || `https://fhpbftdkqnkncsagvsph.supabase.co/functions/v1/google-calendar-oauth`;
    
    console.log("Environment check:", {
      hasSupabaseUrl: !!SUPABASE_URL,
      hasServiceRoleKey: !!SUPABASE_SERVICE_ROLE_KEY,
      hasGoogleClientId: !!GOOGLE_CLIENT_ID,
      hasGoogleClientSecret: !!GOOGLE_CLIENT_SECRET,
    });
    
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("Missing Supabase credentials");
      return new Response(
        JSON.stringify({ error: "Missing Supabase configuration" }), 
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      console.error("Missing Google OAuth credentials");
      return new Response(
        JSON.stringify({ error: "Missing Google OAuth configuration" }), 
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const url = new URL(req.url);

    // 1️⃣ Step 1: Start OAuth (redirect user to Google)
    const code = url.searchParams.get("code");
      
    if (!code) {
      console.log("No code parameter - initiating OAuth flow");
      
      // Get guideId/establishmentId and redirect_to from initial request
      const guideId = url.searchParams.get("guideId");
      const establishmentId = url.searchParams.get("establishmentId");
      const redirectTo = url.searchParams.get("redirect_to") || "/map";
      
      console.log("OAuth params:", { guideId, establishmentId, redirectTo });
      
      if (!guideId && !establishmentId) {
        console.error("Missing guideId or establishmentId parameter");
        return new Response(JSON.stringify({ error: "Missing guideId or establishmentId" }), { 
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
      
      // Store guideId/establishmentId and redirect_to in the state parameter
      const state = JSON.stringify({ guideId, establishmentId, redirectTo });
      
      const authorizeUrl = new URL(AUTH_URL);
      authorizeUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
      authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("scope", "https://www.googleapis.com/auth/calendar");
      authorizeUrl.searchParams.set("access_type", "offline");
      authorizeUrl.searchParams.set("prompt", "consent");
      authorizeUrl.searchParams.set("state", state);
      
      console.log("Redirecting to Google with state:", state);
      return new Response(null, {
        status: 302,
        headers: { Location: authorizeUrl.toString() },
      });
    }

    // 2️⃣ Step 2: Exchange code for tokens
    console.log("Code parameter present - exchanging for tokens");
    
    // Retrieve guideId and redirectTo from state
    const stateParam = url.searchParams.get("state");
    if (!stateParam) {
      console.error("Missing state parameter");
      return new Response(JSON.stringify({ error: "Missing state parameter" }), { 
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    console.log("State parameter:", stateParam);
    
    let guideId, establishmentId, redirectTo;
    try {
      const parsed = JSON.parse(stateParam);
      guideId = parsed.guideId;
      establishmentId = parsed.establishmentId;
      redirectTo = parsed.redirectTo;
    } catch (err) {
      console.error("Failed to parse state:", err);
      return new Response(JSON.stringify({ error: "Invalid state parameter" }), { 
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    if (!guideId && !establishmentId) {
      console.error("Missing guideId and establishmentId in state");
      return new Response(JSON.stringify({ error: "Missing guideId or establishmentId in state" }), { 
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    console.log("Exchanging code for tokens...");
    const body = new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    });

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const tokenData = await tokenRes.json();
    console.log("Token response status:", tokenRes.status);
    console.log("Token data (without tokens):", { 
      error: tokenData.error, 
      hasAccessToken: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token 
    });

    if (tokenData.error) {
      console.error("Google token error:", tokenData.error_description || tokenData.error);
      return new Response(
        JSON.stringify({ error: tokenData.error_description || tokenData.error }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // 3️⃣ Step 3: Store refresh token with timestamp
    if (tokenData.refresh_token) {
      
      // Store for establishment if establishmentId is provided
      if (establishmentId) {
        console.log("Storing refresh token for establishment:", establishmentId);
        
        // Try to update with capital E table name
        let { error } = await supabase
          .from("Etablissement")
          .update({
            google_calendar_id: tokenData.refresh_token,
            google_token_created_at: new Date().toISOString(),
          })
          .eq("key", establishmentId);

        // If that fails, try lowercase table name
        if (error) {
          const result = await supabase
            .from("Etablissement")
            .update({
              google_calendar_id: tokenData.refresh_token,
              google_token_created_at: new Date().toISOString(),
            })
            .eq("key", establishmentId);
          
          error = result.error;
        }

        // Try with id column if key didn't work
        if (error) {
          const result = await supabase
            .from("Etablissement")
            .update({
              google_calendar_id: tokenData.refresh_token,
              google_token_created_at: new Date().toISOString(),
            })
            .eq("id", establishmentId);
          
          error = result.error;
        }

        if (error) {
          console.error("Supabase error:", error);
          return new Response(JSON.stringify({ error: error.message }), { 
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }

        console.log("Successfully stored refresh token for establishment, redirecting to:", redirectTo);
        
        return new Response(null, {
          status: 302,
          headers: { Location: redirectTo },
        });
      }
      
      // Store for guide if guideId is provided
      if (guideId) {
        console.log("Storing refresh token for guide:", guideId);
        
        const { error } = await supabase
          .from("guide")
          .upsert(
            {
              id: guideId,
              google_refresh_token: tokenData.refresh_token,
              google_token_created_at: new Date().toISOString(),
            },
            { onConflict: "id" }
          );

        if (error) {
          console.error("Supabase error:", error);
          return new Response(JSON.stringify({ error: error.message }), { 
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }

        console.log("Successfully stored refresh token for guide, redirecting to:", redirectTo);
        
        return new Response(null, {
          status: 302,
          headers: { Location: redirectTo },
        });
      }
    }

    console.error("No refresh token received from Google");
    return new Response(
      JSON.stringify({ error: "No refresh token received from Google" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
    
  } catch (error) {
    console.error("=== UNCAUGHT ERROR IN OAUTH FUNCTION ===");
    console.error("Error:", error);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    
    return new Response(
      JSON.stringify({ 
        error: "Internal server error", 
        message: error.message 
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
