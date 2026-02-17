// =============================================================================
// Edge Function: stripe-refund-booking
// =============================================================================
// Handles booking cancellation and refunds.
//
// Supports full and partial refunds. The refund is applied to the original
// charge on the connected account. The application fee is also reversed
// proportionally (Stripe handles this automatically for direct charges).
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

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("Missing authorization header", 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return errorResponse("Invalid or expired token", 401);
    }

    // 2. Parse request
    const { bookingId, reason, amount } = await req.json();
    if (!bookingId) {
      return errorResponse("bookingId is required");
    }

    // 3. Fetch the booking
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(`
        *,
        chalets!inner(key, etablishment_id)
      `)
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) {
      return errorResponse("Booking not found", 404);
    }

    // 4. Verify permission (either the booking owner or the establishment owner)
    let isAuthorized = booking.user_id === user.id;

    if (!isAuthorized) {
      // Check if user owns the establishment
      const { data: est } = await supabase
        .from("Etablissement")
        .select("key")
        .eq("key", booking.chalets.etablishment_id)
        .eq("owner_id", user.id)
        .single();

      isAuthorized = !!est;
    }

    if (!isAuthorized) {
      return errorResponse("You don't have permission to refund this booking", 403);
    }

    // 5. Check booking status
    if (booking.payment_status !== "paid") {
      return errorResponse(
        `Cannot refund: booking payment status is '${booking.payment_status}'`
      );
    }

    if (!booking.stripe_payment_intent_id) {
      // No payment was made — just cancel the booking
      await supabase
        .from("bookings")
        .update({ status: "cancelled", payment_status: "unpaid" })
        .eq("id", bookingId);

      return jsonResponse({
        bookingId,
        status: "cancelled",
        message: "Booking cancelled (no payment to refund)",
      });
    }

    // 6. Fetch the establishment to get Stripe account ID
    const { data: establishment } = await supabase
      .from("Etablissement")
      .select("stripe_account_id")
      .eq("key", booking.chalets.etablishment_id)
      .single();

    if (!establishment?.stripe_account_id) {
      return errorResponse("Vendor Stripe account not found", 500);
    }

    // 7. Create the refund on the connected account
    //    For direct charges, refund must target the payment_intent on the connected account
    const refundParams: Record<string, unknown> = {
      payment_intent: booking.stripe_payment_intent_id,
      reason: reason === "duplicate" ? "duplicate" 
        : reason === "fraudulent" ? "fraudulent" 
        : "requested_by_customer",
      // Reverse the application fee proportionally
      reverse_transfer: "true",
      refund_application_fee: "true",
    };

    // Partial refund: specify amount in cents
    if (amount && amount < booking.total_price) {
      refundParams.amount = String(Math.round(amount * 100));
    }

    const refund = await stripeRequest(
      "POST",
      "/refunds",
      refundParams,
      establishment.stripe_account_id
    );

    const refundAmountCAD = (refund.amount as number) / 100;
    const isFullRefund = refundAmountCAD >= booking.total_price;

    // 8. Update booking in database
    await supabase
      .from("bookings")
      .update({
        status: isFullRefund ? "cancelled" : "confirmed",
        payment_status: isFullRefund ? "refunded" : "partially_refunded",
        refund_amount: (booking.refund_amount || 0) + refundAmountCAD,
        stripe_refund_id: refund.id,
        notes: booking.notes
          ? `${booking.notes}\n---\nRefund: $${refundAmountCAD} CAD (${reason || "customer request"})`
          : `Refund: $${refundAmountCAD} CAD (${reason || "customer request"})`,
      })
      .eq("id", bookingId);

    console.log(`✅ Refund processed: ${refund.id} — $${refundAmountCAD} CAD for booking ${bookingId}`);

    return jsonResponse({
      bookingId,
      refundId: refund.id,
      refundAmount: refundAmountCAD,
      isFullRefund,
      status: isFullRefund ? "cancelled" : "confirmed",
      paymentStatus: isFullRefund ? "refunded" : "partially_refunded",
    });

  } catch (error) {
    console.error("stripe-refund-booking error:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});
