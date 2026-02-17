// =============================================================================
// Edge Function: stripe-onboard-return
// =============================================================================
// Called when a vendor returns from Stripe onboarding. Checks whether the
// account is fully set up (charges_enabled, payouts_enabled) and updates the
// database accordingly.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import {
  stripeRequest,
  corsHeaders,
  errorResponse,
  jsonResponse,
} from "../_shared/stripeUtils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("Missing authorization header", 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return errorResponse("Invalid or expired token", 401);
    }

    // Get establishment or guide ID from query params or body
    const url = new URL(req.url);
    const establishmentId = url.searchParams.get("establishmentId") 
      || (req.method === "POST" ? (await req.json()).establishmentId : null);
    const guideId = url.searchParams.get("guideId")
      || (req.method === "POST" && !establishmentId ? (await req.json()).guideId : null);

    if (!establishmentId && !guideId) {
      return errorResponse("establishmentId or guideId is required");
    }

    const isGuide = !!guideId;
    let stripeAccountId: string | null = null;

    if (isGuide) {
      // ── Guide status check ──
      const { data: guide, error: fetchError } = await supabase
        .from("guide")
        .select("id, stripe_account_id, user_id")
        .eq("id", guideId)
        .eq("user_id", user.id)
        .single();

      if (fetchError || !guide) {
        return errorResponse("Guide not found", 404);
      }

      if (!guide.stripe_account_id) {
        return errorResponse("No Stripe account found. Please start onboarding first.");
      }

      stripeAccountId = guide.stripe_account_id;

      // Retrieve the Stripe account to check its status
      const account = await stripeRequest(
        "GET",
        `/accounts/${stripeAccountId}`
      ) as Record<string, unknown>;

      const chargesEnabled = account.charges_enabled as boolean;
      const payoutsEnabled = account.payouts_enabled as boolean;
      const detailsSubmitted = account.details_submitted as boolean;

      // Update the guide with the current status
      const { error: updateError } = await supabase
        .from("guide")
        .update({
          stripe_onboarding_complete: detailsSubmitted,
          stripe_charges_enabled: chargesEnabled,
          stripe_payouts_enabled: payoutsEnabled,
        })
        .eq("id", guideId);

      if (updateError) {
        console.error("Error updating guide:", updateError);
      }

      console.log(`✅ Stripe status for guide ${stripeAccountId}:`, {
        chargesEnabled,
        payoutsEnabled,
        detailsSubmitted,
      });

      return jsonResponse({
        stripeAccountId,
        chargesEnabled,
        payoutsEnabled,
        detailsSubmitted,
        onboardingComplete: detailsSubmitted && chargesEnabled,
        message: detailsSubmitted && chargesEnabled
          ? "Stripe account is fully set up! You can now accept payments."
          : "Stripe onboarding is not yet complete. Please finish setting up your account.",
      });

    } else {
      // ── Establishment status check ──
      const { data: establishment, error: fetchError } = await supabase
        .from("Etablissement")
        .select("key, stripe_account_id, owner_id")
        .eq("key", establishmentId)
        .eq("owner_id", user.id)
        .single();

      if (fetchError || !establishment) {
        return errorResponse("Establishment not found", 404);
      }

      if (!establishment.stripe_account_id) {
        return errorResponse("No Stripe account found. Please start onboarding first.");
      }

      stripeAccountId = establishment.stripe_account_id;

      // Retrieve the Stripe account to check its status
      const account = await stripeRequest(
        "GET",
        `/accounts/${stripeAccountId}`
      ) as Record<string, unknown>;

      const chargesEnabled = account.charges_enabled as boolean;
      const payoutsEnabled = account.payouts_enabled as boolean;
      const detailsSubmitted = account.details_submitted as boolean;

      // Update the establishment with the current status
      const { error: updateError } = await supabase
        .from("Etablissement")
        .update({
          stripe_onboarding_complete: detailsSubmitted,
          stripe_charges_enabled: chargesEnabled,
          stripe_payouts_enabled: payoutsEnabled,
        })
        .eq("key", establishmentId);

      if (updateError) {
        console.error("Error updating establishment:", updateError);
      }

      console.log(`✅ Stripe status for ${stripeAccountId}:`, {
        chargesEnabled,
        payoutsEnabled,
        detailsSubmitted,
      });

      return jsonResponse({
        stripeAccountId,
        chargesEnabled,
        payoutsEnabled,
        detailsSubmitted,
        onboardingComplete: detailsSubmitted && chargesEnabled,
        message: detailsSubmitted && chargesEnabled
          ? "Stripe account is fully set up! You can now accept payments."
          : "Stripe onboarding is not yet complete. Please finish setting up your account.",
      });
    }

  } catch (error) {
    console.error("stripe-onboard-return error:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});
