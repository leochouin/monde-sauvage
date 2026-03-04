// =============================================================================
// Edge Function: confirm-booking-payment
// =============================================================================
// Frontend-triggered fallback that verifies a PaymentIntent's status directly
// with the Stripe API and updates the booking in the DB if payment succeeded.
//
// This is a safety net: the webhook should handle the update, but network
// delays or transient failures can leave the DB stale. The frontend calls
// this immediately after confirmPayment() returns success.
//
// Idempotent: calling it multiple times for the same booking is safe —
// if the booking is already marked "paid" we short-circuit.
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

    const body = await req.json();
    const { bookingId, bookingType, paymentIntentId } = body as {
      bookingId: string;
      bookingType?: string;
      paymentIntentId?: string;
    };

    if (!bookingId) {
      return errorResponse("Missing bookingId");
    }

    const type = bookingType || "chalet";
    const table = type === "guide" ? "guide_booking" : "bookings";

    // 1. Check current DB state
    const { data: existing, error: fetchError } = await supabase
      .from(table)
      .select("id, payment_status, stripe_payment_intent_id, google_event_id" + (type === "guide" ? ", guide_id, start_time, end_time, customer_name, customer_email, trip_type, notes" : ""))
      .eq("id", bookingId)
      .single();

    if (fetchError || !existing) {
      console.log(`confirm-booking-payment: booking ${bookingId} not found in ${table}`);
      return errorResponse("Booking not found", 404);
    }

    if (existing.payment_status === "paid") {
      console.log(`confirm-booking-payment: booking ${bookingId} already paid`);

      // NOTE: Google Calendar event creation is handled exclusively by the
      // Stripe webhook. We do NOT create calendar events here to avoid
      // duplicate events caused by the webhook and this fallback racing.

      return jsonResponse({ confirmed: true, alreadyPaid: true });
    }

    // 2. Determine the PaymentIntent ID
    const piId = paymentIntentId || existing.stripe_payment_intent_id;
    if (!piId) {
      console.warn(`confirm-booking-payment: no PaymentIntent ID for booking ${bookingId}`);
      return errorResponse("No PaymentIntent associated with this booking", 422);
    }

    // 3. Verify payment status directly with Stripe (platform-level PI)
    let pi: Record<string, unknown>;
    try {
      pi = await stripeRequest("GET", `/payment_intents/${piId}`);
    } catch (stripeErr) {
      console.error(`confirm-booking-payment: Stripe API error for PI ${piId}:`, stripeErr.message);
      return errorResponse("Could not verify payment with Stripe", 502);
    }

    const piStatus = pi.status as string;
    console.log(`confirm-booking-payment: PI ${piId} status=${piStatus} for booking ${bookingId}`);

    if (piStatus !== "succeeded") {
      // Payment hasn't actually succeeded — don't update DB
      return jsonResponse({ confirmed: false, stripeStatus: piStatus });
    }

    // 4. Payment verified — update DB
    const updatePayload: Record<string, unknown> = {
      status: "confirmed",
      payment_status: "paid",
      stripe_payment_intent_id: piId,
    };

    if (type === "guide") {
      updatePayload.is_paid = true;
    }

    const { data: updatedBooking, error: updateError } = await supabase
      .from(table)
      .update(updatePayload)
      .eq("id", bookingId)
      .select("*")
      .single();

    if (updateError) {
      console.error(`confirm-booking-payment: DB update failed for ${bookingId}:`, JSON.stringify(updateError));
      return errorResponse("Failed to update booking", 500);
    }

    // NOTE: Google Calendar event creation is handled by the Stripe webhook.
    // We do NOT create it here to prevent duplicate events from racing.

    console.log(`✅ confirm-booking-payment: booking ${bookingId} confirmed (paid) via fallback`);
    return jsonResponse({ confirmed: true, alreadyPaid: false });

  } catch (error) {
    console.error("confirm-booking-payment error:", error?.message || error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});
