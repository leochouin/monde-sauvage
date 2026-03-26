// =============================================================================
// Edge Function: resume-booking-payment
// =============================================================================
// Retrieves the Stripe PaymentIntent client_secret for an existing pending
// booking so the user can resume payment from the cart.
//
// If the PI has expired or been cancelled, creates a fresh one.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import {
  stripeRequest,
  APPLICATION_FEE_PERCENT,
  corsHeaders,
  errorResponse,
  jsonResponse,
} from "../_shared/stripeUtils.ts";
import {
  calculatePlatformFeeAmount,
  getBookingOrigin,
  requiresPayment,
} from "../_shared/bookingRules.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { bookingId } = body;

    if (!bookingId) {
      return errorResponse("Missing bookingId");
    }

    // 1. Fetch booking
    const { data: booking, error: bookingErr } = await supabase
      .from("guide_booking")
      .select("*")
      .eq("id", bookingId)
      .single();

    if (bookingErr || !booking) {
      return errorResponse("Booking not found", 404);
    }

    if (!requiresPayment(booking) || booking.status === "confirmed") {
      return errorResponse("Booking is already paid", 400);
    }

    if (booking.status === "cancelled") {
      return errorResponse("Booking has been cancelled", 400);
    }

    // 2. Fetch guide info
    const { data: guide, error: guideErr } = await supabase
      .from("guide")
      .select("id, name, stripe_account_id, stripe_charges_enabled, hourly_rate")
      .eq("id", booking.guide_id)
      .single();

    if (guideErr || !guide || !guide.stripe_account_id) {
      return errorResponse("Guide payment info not found", 404);
    }

    const totalPrice = Number(booking.payment_amount) || 0;
    const bookingOrigin = getBookingOrigin(booking);
    const persistedPlatformFee = Number(booking.platform_fee_amount ?? booking.application_fee ?? 0);
    const fallbackFee = calculatePlatformFeeAmount(
      totalPrice,
      { booking_origin: bookingOrigin },
      APPLICATION_FEE_PERCENT,
    );
    const applicationFee = Math.round(
      (Number.isFinite(persistedPlatformFee) && persistedPlatformFee > 0
        ? persistedPlatformFee
        : fallbackFee) * 100,
    ) / 100;
    // totalPrice already includes the fee (stored as full amount)
    const subtotal = Math.round(Math.max(totalPrice - applicationFee, 0) * 100) / 100;
    const amountInCents = Math.round(totalPrice * 100);
    const applicationFeeInCents = Math.round(applicationFee * 100);

    // Calculate hours for display
    const start = new Date(booking.start_time);
    const end = new Date(booking.end_time);
    const durationHours = Math.max((end.getTime() - start.getTime()) / (1000 * 60 * 60), 0.5);

    // 3. Try to reuse existing PaymentIntent
    if (booking.stripe_payment_intent_id) {
      try {
        const existingPI = await stripeRequest(
          "GET",
          `/payment_intents/${booking.stripe_payment_intent_id}`
        );

        // Reuse if still payable
        if (
          existingPI.status === "requires_payment_method" ||
          existingPI.status === "requires_confirmation" ||
          existingPI.status === "requires_action"
        ) {
          console.log(`⏩ Reusing existing PI ${existingPI.id} for booking ${bookingId}`);

          // Extend the booking expiry
          const newExpiry = new Date(Date.now() + 30 * 60 * 1000);
          await supabase
            .from("guide_booking")
            .update({ payment_link_expires_at: newExpiry.toISOString() })
            .eq("id", bookingId);

          return jsonResponse({
            bookingId: booking.id,
            bookingType: "guide",
            clientSecret: existingPI.client_secret,
            stripeAccountId: guide.stripe_account_id,
            expiresAt: newExpiry.toISOString(),
            pricing: {
              hours: Math.round(durationHours * 10) / 10,
              hourlyRate: guide.hourly_rate,
              subtotal: subtotal,
              applicationFee: applicationFee,
              total: totalPrice,
            },
          });
        }

        console.log(`⚠️ Existing PI ${existingPI.id} status=${existingPI.status}, creating new one`);
      } catch (piErr) {
        console.warn(`⚠️ Could not retrieve PI: ${piErr.message}, creating new one`);
      }
    }

    // 4. Create a new PaymentIntent
    if (amountInCents <= 0) {
      return errorResponse("Invalid payment amount");
    }

    const paymentIntent = await stripeRequest("POST", "/payment_intents", {
      amount: String(amountInCents),
      currency: "cad",
      payment_method_types: ["card"],
      ...(applicationFeeInCents > 0
        ? { application_fee_amount: String(applicationFeeInCents) }
        : {}),
      transfer_data: {
        destination: guide.stripe_account_id,
      },
      on_behalf_of: guide.stripe_account_id,
      metadata: {
        booking_type: "guide",
        booking_id: booking.id,
        booking_origin: bookingOrigin,
        guide_id: booking.guide_id,
        guide_name: guide.name || "",
        customer_name: booking.customer_name || "",
        customer_email: booking.customer_email || "",
        source: "cart_resume",
      },
      receipt_email: booking.customer_email || undefined,
      description: `Guide: ${guide.name || "Guide"} — Réservation #${booking.id}`,
    });

    // 5. Update booking with new PI + extend expiry
    const newExpiry = new Date(Date.now() + 30 * 60 * 1000);
    await supabase
      .from("guide_booking")
      .update({
        stripe_payment_intent_id: paymentIntent.id,
        payment_link_expires_at: newExpiry.toISOString(),
        status: "pending",
        payment_status: "processing",
      })
      .eq("id", bookingId);

    console.log(`✅ New PI ${paymentIntent.id} created for resumed booking ${bookingId}`);

    return jsonResponse({
      bookingId: booking.id,
      bookingType: "guide",
      clientSecret: paymentIntent.client_secret,
      stripeAccountId: guide.stripe_account_id,
      expiresAt: newExpiry.toISOString(),
      pricing: {
        hours: Math.round(durationHours * 10) / 10,
        hourlyRate: guide.hourly_rate,
        subtotal: subtotal,
        applicationFee: applicationFee,
        total: totalPrice,
      },
    });
  } catch (err) {
    console.error("resume-booking-payment error:", err);
    return errorResponse(err.message || "Internal server error", 500);
  }
});
