// =============================================================================
// Edge Function: expire-unpaid-bookings
// =============================================================================
// Scheduled cleanup function that cancels bookings with expired payment links.
// Should be invoked periodically via a cron job (e.g., every 15 minutes).
//
// Targets:
//   - guide_booking with status 'pending_payment' and expired payment_link_expires_at
//   - bookings with status 'pending' and payment_status 'processing' older than 30 minutes
//     (abandoned checkout flows)
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import {
  corsHeaders,
  errorResponse,
  jsonResponse,
} from "../_shared/stripeUtils.ts";

const ABANDONED_CHECKOUT_MINUTES = 30;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const now = new Date().toISOString();
    let totalExpired = 0;

    // 1. Expire guide bookings with expired payment links
    const { data: expiredGuideBookings, error: guideErr } = await supabase
      .from("guide_booking")
      .update({
        status: "cancelled",
        payment_status: "expired",
        notes: "Lien de paiement expiré — réservation annulée automatiquement",
      })
      .eq("status", "pending_payment")
      .eq("is_paid", false)
      .lt("payment_link_expires_at", now)
      .select("id");

    if (guideErr) {
      console.error("Error expiring guide bookings:", guideErr);
    } else {
      const count = expiredGuideBookings?.length || 0;
      totalExpired += count;
      if (count > 0) {
        console.log(`🗑️ Expired ${count} guide booking(s) with expired payment links`);
      }
    }

    // 2. Cancel abandoned checkout flows (pending + processing for > 30 minutes)
    const cutoff = new Date(Date.now() - ABANDONED_CHECKOUT_MINUTES * 60 * 1000).toISOString();

    // Guide bookings
    const { data: abandonedGuide, error: abandonedGuideErr } = await supabase
      .from("guide_booking")
      .update({
        status: "cancelled",
        payment_status: "abandoned",
        notes: "Paiement non complété — réservation annulée automatiquement",
      })
      .eq("status", "pending")
      .eq("payment_status", "processing")
      .eq("is_paid", false)
      .lt("created_at", cutoff)
      .select("id");

    if (!abandonedGuideErr && abandonedGuide?.length) {
      totalExpired += abandonedGuide.length;
      console.log(`🗑️ Cancelled ${abandonedGuide.length} abandoned guide checkout(s)`);
    }

    // Chalet bookings
    const { data: abandonedChalet, error: abandonedChaletErr } = await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        payment_status: "abandoned",
        notes: "Paiement non complété — réservation annulée automatiquement",
      })
      .eq("status", "pending")
      .eq("payment_status", "processing")
      .lt("created_at", cutoff)
      .select("id");

    if (!abandonedChaletErr && abandonedChalet?.length) {
      totalExpired += abandonedChalet.length;
      console.log(`🗑️ Cancelled ${abandonedChalet.length} abandoned chalet checkout(s)`);
    }

    console.log(`✅ Cleanup complete: ${totalExpired} booking(s) expired/cancelled`);

    return jsonResponse({
      success: true,
      expiredCount: totalExpired,
      timestamp: now,
    });

  } catch (error) {
    console.error("expire-unpaid-bookings error:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});
