// =============================================================================
// Edge Function: stripe-webhook
// =============================================================================
// Handles Stripe webhook events for payment confirmations and failures.
// 
// Events handled:
//   - payment_intent.succeeded  → Confirm booking, mark as paid
//   - payment_intent.payment_failed → Mark booking as failed
//   - account.updated → Update vendor onboarding status
//
// Security: Verifies webhook signature using STRIPE_WEBHOOK_SECRET.
// Idempotency: Each event is only processed once (stored in stripe_webhook_events).
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import {
  verifyWebhookSignature,
  corsHeaders,
  errorResponse,
  jsonResponse,
} from "../_shared/stripeUtils.ts";

Deno.serve(async (req: Request) => {
  // Webhooks are POST only
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");

    if (!STRIPE_WEBHOOK_SECRET) {
      console.error("STRIPE_WEBHOOK_SECRET not configured");
      return errorResponse("Webhook not configured", 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Read raw body for signature verification
    const rawBody = await req.text();
    const sigHeader = req.headers.get("stripe-signature");

    if (!sigHeader) {
      return errorResponse("Missing stripe-signature header", 400);
    }

    // 2. Verify webhook signature
    let event: Record<string, unknown>;
    try {
      event = await verifyWebhookSignature(rawBody, sigHeader, STRIPE_WEBHOOK_SECRET);
    } catch (sigError) {
      console.error("Webhook signature verification failed:", sigError.message);
      return errorResponse("Invalid signature", 401);
    }

    const eventId = event.id as string;
    const eventType = event.type as string;

    console.log(`📨 Webhook received: ${eventType} (${eventId})`);

    // 3. Idempotency check — skip if we've already processed this event
    const { data: existing } = await supabase
      .from("stripe_webhook_events")
      .select("id")
      .eq("id", eventId)
      .single();

    if (existing) {
      console.log(`⏭️ Event ${eventId} already processed, skipping`);
      return jsonResponse({ received: true, skipped: true });
    }

    // 4. Record the event (before processing, to prevent duplicates)
    await supabase.from("stripe_webhook_events").insert({
      id: eventId,
      type: eventType,
      payload: event,
    });

    // 5. Handle different event types
    const dataObject = (event.data as Record<string, unknown>)?.object as Record<string, unknown>;

    switch (eventType) {
      // ─────────────────────────────────────────────────────────────────
      // Payment succeeded — confirm the booking
      // ─────────────────────────────────────────────────────────────────
      case "payment_intent.succeeded": {
        const paymentIntentId = dataObject.id as string;
        const metadata = dataObject.metadata as Record<string, string>;
        const bookingId = metadata?.booking_id;
        const bookingType = metadata?.booking_type || "chalet";

        console.log(`💰 Payment succeeded: ${paymentIntentId} for ${bookingType} booking ${bookingId}`);

        if (bookingId) {
          if (bookingType === "guide") {
            const { error } = await supabase
              .from("guide_booking")
              .update({
                status: "confirmed",
                payment_status: "paid",
                is_paid: true,
                stripe_payment_intent_id: paymentIntentId,
              })
              .eq("id", bookingId);

            if (error) {
              console.error("Error confirming guide booking:", error);
            } else {
              console.log(`✅ Guide booking ${bookingId} confirmed (paid)`);
            }
          } else {
            const { error } = await supabase
              .from("bookings")
              .update({
                status: "confirmed",
                payment_status: "paid",
                stripe_payment_intent_id: paymentIntentId,
              })
              .eq("id", bookingId);

            if (error) {
              console.error("Error confirming booking:", error);
            } else {
              console.log(`✅ Booking ${bookingId} confirmed (paid)`);
            }
          }
        }
        break;
      }

      // ─────────────────────────────────────────────────────────────────
      // Payment failed — mark booking as failed
      // ─────────────────────────────────────────────────────────────────
      case "payment_intent.payment_failed": {
        const paymentIntentId = dataObject.id as string;
        const metadata = dataObject.metadata as Record<string, string>;
        const bookingId = metadata?.booking_id;
        const bookingType = metadata?.booking_type || "chalet";
        const failureMessage = (dataObject.last_payment_error as Record<string, unknown>)?.message as string;

        console.log(`❌ Payment failed: ${paymentIntentId} — ${failureMessage}`);

        if (bookingId) {
          if (bookingType === "guide") {
            await supabase
              .from("guide_booking")
              .update({
                status: "cancelled",
                payment_status: "failed",
                is_paid: false,
                notes: `Payment failed: ${failureMessage || "Unknown error"}`,
              })
              .eq("id", bookingId);

            console.log(`❌ Guide booking ${bookingId} marked as failed`);
          } else {
            await supabase
              .from("bookings")
              .update({
                status: "cancelled",
                payment_status: "failed",
                notes: `Payment failed: ${failureMessage || "Unknown error"}`,
              })
              .eq("id", bookingId);

            console.log(`❌ Booking ${bookingId} marked as failed`);
          }
        }
        break;
      }

      // ─────────────────────────────────────────────────────────────────
      // Vendor account updated — sync onboarding status
      // ─────────────────────────────────────────────────────────────────
      case "account.updated": {
        const accountId = dataObject.id as string;
        const chargesEnabled = dataObject.charges_enabled as boolean;
        const payoutsEnabled = dataObject.payouts_enabled as boolean;
        const detailsSubmitted = dataObject.details_submitted as boolean;

        console.log(`🏪 Account updated: ${accountId}`, {
          chargesEnabled,
          payoutsEnabled,
          detailsSubmitted,
        });

        // Update all establishments that use this Stripe account
        const { error } = await supabase
          .from("Etablissement")
          .update({
            stripe_onboarding_complete: detailsSubmitted,
            stripe_charges_enabled: chargesEnabled,
            stripe_payouts_enabled: payoutsEnabled,
          })
          .eq("stripe_account_id", accountId);

        if (error) {
          console.error("Error updating establishment:", error);
        }

        // Also update any guides that use this Stripe account
        const { error: guideError } = await supabase
          .from("guide")
          .update({
            stripe_onboarding_complete: detailsSubmitted,
            stripe_charges_enabled: chargesEnabled,
            stripe_payouts_enabled: payoutsEnabled,
          })
          .eq("stripe_account_id", accountId);

        if (guideError) {
          console.error("Error updating guide:", guideError);
        }
        break;
      }

      // ─────────────────────────────────────────────────────────────────
      // Charge refunded
      // ─────────────────────────────────────────────────────────────────
      case "charge.refunded": {
        const chargeId = dataObject.id as string;
        const paymentIntentId = dataObject.payment_intent as string;
        const amountRefunded = (dataObject.amount_refunded as number) / 100;

        console.log(`💸 Charge refunded: ${chargeId} ($${amountRefunded})`);

        if (paymentIntentId) {
          // Try updating chalet booking
          const { data: chaletBooking } = await supabase
            .from("bookings")
            .select("id")
            .eq("stripe_payment_intent_id", paymentIntentId)
            .single();

          if (chaletBooking) {
            await supabase
              .from("bookings")
              .update({
                payment_status: (dataObject.refunded as boolean) ? "refunded" : "partially_refunded",
                refund_amount: amountRefunded,
              })
              .eq("stripe_payment_intent_id", paymentIntentId);
          } else {
            // Try guide booking
            await supabase
              .from("guide_booking")
              .update({
                payment_status: (dataObject.refunded as boolean) ? "refunded" : "partially_refunded",
                is_paid: !(dataObject.refunded as boolean),
              })
              .eq("stripe_payment_intent_id", paymentIntentId);
          }
        }
        break;
      }

      default:
        console.log(`ℹ️ Unhandled event type: ${eventType}`);
    }

    return jsonResponse({ received: true });

  } catch (error) {
    console.error("stripe-webhook error:", error);
    // Always return 200 to Stripe to prevent retries on our errors
    return jsonResponse({ received: true, error: error.message }, 200);
  }
});
