// =============================================================================
// Edge Function: stripe-dashboard-link
// =============================================================================
// Creates a temporary login link to the Stripe Express dashboard for a
// connected account (guide or establishment). The link is single-use and
// expires after a short time.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import {
  stripeRequest,
  corsHeaders,
  errorResponse,
  jsonResponse,
} from "../_shared/stripeUtils.ts";

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Authenticate the user via their JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("Missing authorization header", 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return errorResponse("Invalid or expired token", 401);
    }

    // 2. Parse request body
    const body = await req.json();
    const { guideId, establishmentId } = body;

    if (!guideId && !establishmentId) {
      return errorResponse("guideId or establishmentId is required");
    }

    let stripeAccountId: string | null = null;

    if (guideId) {
      // ── Guide dashboard link ──
      const { data: guide, error: fetchError } = await supabase
        .from("guide")
        .select("id, stripe_account_id, user_id")
        .eq("id", guideId)
        .eq("user_id", user.id)
        .single();

      if (fetchError || !guide) {
        return errorResponse("Guide not found or you don't own it", 404);
      }

      if (!guide.stripe_account_id) {
        return errorResponse("No Stripe account found. Please complete onboarding first.");
      }

      stripeAccountId = guide.stripe_account_id;
    } else if (establishmentId) {
      // ── Establishment dashboard link ──
      const { data: establishment, error: fetchError } = await supabase
        .from("Etablissement")
        .select("key, stripe_account_id, owner_id")
        .eq("key", establishmentId)
        .eq("owner_id", user.id)
        .single();

      if (fetchError || !establishment) {
        return errorResponse("Establishment not found or you don't own it", 404);
      }

      if (!establishment.stripe_account_id) {
        return errorResponse("No Stripe account found. Please complete onboarding first.");
      }

      stripeAccountId = establishment.stripe_account_id;
    }

    // 3. Create a login link for the connected account's Express dashboard
    console.log(`🔗 Creating Stripe dashboard link for account: ${stripeAccountId}`);

    const loginLink = await stripeRequest("POST", `/accounts/${stripeAccountId}/login_links`, {});

    console.log(`✅ Dashboard link created successfully`);

    return jsonResponse({
      url: loginLink.url as string,
    });

  } catch (err) {
    console.error("stripe-dashboard-link error:", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return errorResponse(message, 500);
  }
});
