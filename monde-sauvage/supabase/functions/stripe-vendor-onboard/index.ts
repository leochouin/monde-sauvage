// =============================================================================
// Edge Function: stripe-vendor-onboard
// =============================================================================
// Creates a Stripe Connect Express account for a vendor (Etablissement) and
// returns the onboarding URL. The vendor is redirected to Stripe to complete
// identity verification, then back to our app.
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
    const FRONTEND_URL = Deno.env.get("FRONTEND_URL") || "http://localhost:5173";

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
    const { establishmentId, guideId } = body;

    if (!establishmentId && !guideId) {
      return errorResponse("establishmentId or guideId is required");
    }

    const isGuide = !!guideId;
    let stripeAccountId: string | null = null;
    let entityEmail: string | null = null;
    let entityName: string | null = null;
    const entityId = isGuide ? guideId : establishmentId;

    if (isGuide) {
      // ── Guide onboarding ──
      const { data: guide, error: fetchError } = await supabase
        .from("guide")
        .select("*")
        .eq("id", guideId)
        .eq("user_id", user.id)
        .single();

      if (fetchError || !guide) {
        return errorResponse("Guide not found or you don't own it", 404);
      }

      stripeAccountId = guide.stripe_account_id;
      entityEmail = guide.email || user.email;
      entityName = guide.name;

      if (!stripeAccountId) {
        console.log("Creating new Stripe Connect account for guide:", guide.name);

        const account = await stripeRequest("POST", "/accounts", {
          type: "express",
          country: "CA",
          email: entityEmail,
          capabilities: {
            card_payments: { requested: "true" },
            transfers: { requested: "true" },
          },
          business_type: "individual",
          metadata: {
            guide_id: guideId,
            user_id: user.id,
            platform: "monde-sauvage",
            entity_type: "guide",
          },
        });

        stripeAccountId = account.id as string;

        const { error: updateError } = await supabase
          .from("guide")
          .update({ stripe_account_id: stripeAccountId })
          .eq("id", guideId);

        if (updateError) {
          console.error("Error saving Stripe account ID:", updateError);
          return errorResponse("Failed to save Stripe account", 500);
        }

        console.log("✅ Stripe account created for guide:", stripeAccountId);
      }
    } else {
      // ── Establishment onboarding ──
      const { data: establishment, error: fetchError } = await supabase
        .from("Etablissement")
        .select("*")
        .eq("key", establishmentId)
        .eq("owner_id", user.id)
        .single();

      if (fetchError || !establishment) {
        return errorResponse("Establishment not found or you don't own it", 404);
      }

      stripeAccountId = establishment.stripe_account_id;
      entityEmail = establishment.email || user.email;
      entityName = establishment.Name;

      if (!stripeAccountId) {
        console.log("Creating new Stripe Connect account for:", establishment.Name);

        const account = await stripeRequest("POST", "/accounts", {
          type: "express",
          country: "CA",
          email: entityEmail,
          capabilities: {
            card_payments: { requested: "true" },
            transfers: { requested: "true" },
          },
          business_type: "individual",
          metadata: {
            establishment_id: establishmentId,
            user_id: user.id,
            platform: "monde-sauvage",
            entity_type: "establishment",
          },
        });

        stripeAccountId = account.id as string;

        const { error: updateError } = await supabase
          .from("Etablissement")
          .update({ stripe_account_id: stripeAccountId })
          .eq("key", establishmentId);

        if (updateError) {
          console.error("Error saving Stripe account ID:", updateError);
          return errorResponse("Failed to save Stripe account", 500);
        }

        console.log("✅ Stripe account created:", stripeAccountId);
      }
    }

    // 5. Create an Account Link for onboarding (works for new and returning users)
    const entityParam = isGuide ? `guide=${guideId}` : `establishment=${establishmentId}`;
    const accountLink = await stripeRequest("POST", "/account_links", {
      account: stripeAccountId!,
      refresh_url: `${FRONTEND_URL}/map?stripe_onboard=refresh&${entityParam}`,
      return_url: `${FRONTEND_URL}/map?stripe_onboard=complete&${entityParam}`,
      type: "account_onboarding",
    });

    console.log("✅ Onboarding link created for:", stripeAccountId);

    return jsonResponse({
      url: accountLink.url,
      stripeAccountId,
    });

  } catch (error) {
    console.error("stripe-vendor-onboard error:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});
