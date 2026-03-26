// =============================================================================
// Edge Function: stripe-create-payment-link
// =============================================================================
// Creates a Stripe Checkout Session for admin/guide-created reservations.
// Returns a payment link URL that can be sent to the client.
//
// The booking is created in 'pending_payment' status and only confirmed
// when the webhook receives payment_intent.succeeded.
//
// The link expires after 24 hours; a cron job cleans up expired unpaid bookings.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import {
  stripeRequest,
  corsHeaders,
  errorResponse,
  jsonResponse,
} from "../_shared/stripeUtils.ts";
import {
  BOOKING_ORIGIN_GUIDE_MANUAL,
  calculatePlatformFeeAmount,
  requiresPayment,
} from "../_shared/bookingRules.ts";

const PAYMENT_LINK_EXPIRY_HOURS = 24;

function isMissingSchemaColumn(error: unknown, columnName: string): boolean {
  const msg = String((error as { message?: string })?.message || "").toLowerCase();
  const target = columnName.toLowerCase();
  return msg.includes(`could not find the '${target}' column`) || msg.includes(`column \"${target}\" does not exist`);
}

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
    const FRONTEND_URL = Deno.env.get("FRONTEND_URL") || "https://monde-sauvage.vercel.app";

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Authenticate — only guides/admins can create payment links
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse("Authentication required", 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return errorResponse("Invalid authentication", 401);
    }

    const body = await req.json();
    const {
      guideId,
      startTime,
      endTime,
      customerName,
      customerEmail,
      customerPhone,
      tripType,
      numberOfPeople,
      notes,
    } = body;

    // Validate required fields
    if (!guideId || !startTime || !endTime || !customerName || !customerEmail) {
      return errorResponse(
        "Missing required fields: guideId, startTime, endTime, customerName, customerEmail"
      );
    }

    // Validate dates
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return errorResponse("Invalid date format");
    }
    if (end <= start) {
      return errorResponse("endTime must be after startTime");
    }

    // Fetch guide
    const { data: guide, error: guideError } = await supabase
      .from("guide")
      .select("id, name, email, hourly_rate, stripe_account_id, stripe_charges_enabled, user_id")
      .eq("id", guideId)
      .single();

    if (guideError || !guide) {
      return errorResponse("Guide not found", 404);
    }

    // Verify the authenticated user owns this guide profile
    if (guide.user_id !== user.id) {
      return errorResponse("Unauthorized: you can only create payment links for your own guide profile", 403);
    }

    if (!guide.stripe_account_id || !guide.stripe_charges_enabled) {
      return errorResponse(
        "Stripe payments are not set up for this guide. Complete onboarding first.",
        422
      );
    }

    if (!guide.hourly_rate || guide.hourly_rate <= 0) {
      return errorResponse("Guide has no hourly rate set.");
    }

    // Check availability
    const { data: overlapping } = await supabase
      .from("guide_booking")
      .select("id")
      .eq("guide_id", guideId)
      .in("status", ["confirmed", "pending", "pending_payment", "booked"])
      .is("deleted_at", null)
      .lt("start_time", endTime)
      .gt("end_time", startTime);

    if (overlapping && overlapping.length > 0) {
      return errorResponse("Le guide n'est pas disponible pour ce créneau", 409);
    }

    // Calculate price
    const durationMs = end.getTime() - start.getTime();
    const durationHours = durationMs / (1000 * 60 * 60);
    const subtotal = Math.round(guide.hourly_rate * durationHours * 100) / 100;

    if (subtotal <= 0) {
      return errorResponse("Calculated price is invalid");
    }

    // Guide manual reservations can still be paid by Stripe, but platform fee is waived.
    const applicationFee = calculatePlatformFeeAmount(
      subtotal,
      { booking_origin: BOOKING_ORIGIN_GUIDE_MANUAL },
      0,
    );
    const totalPrice = Math.round((subtotal + applicationFee) * 100) / 100;

    const amountInCents = Math.round(totalPrice * 100);
    const applicationFeeInCents = Math.round(applicationFee * 100);

    // Set expiry
    const expiresAt = new Date(Date.now() + PAYMENT_LINK_EXPIRY_HOURS * 60 * 60 * 1000);

    // Create booking record in 'pending_payment' status
    const insertPayload = {
      guide_id: guideId,
      start_time: startTime,
      end_time: endTime,
      status: "pending_payment",
      payment_status: "awaiting_payment",
      source: "system",
      booking_origin: BOOKING_ORIGIN_GUIDE_MANUAL,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone || null,
      trip_type: tripType || null,
      number_of_people: numberOfPeople || 1,
      notes: notes || null,
      is_paid: false,
      payment_amount: totalPrice,
      application_fee: applicationFee,
      platform_fee_amount: applicationFee,
      platform_fee_waived: true,
      payment_link_expires_at: expiresAt.toISOString(),
    };

    let { data: booking, error: bookingError } = await supabase
      .from("guide_booking")
      .insert(insertPayload)
      .select()
      .single();

    if (bookingError && (
      isMissingSchemaColumn(bookingError, "booking_origin")
      || isMissingSchemaColumn(bookingError, "platform_fee_amount")
      || isMissingSchemaColumn(bookingError, "platform_fee_waived")
    )) {
      const { booking_origin, platform_fee_amount, platform_fee_waived, ...legacyPayload } = insertPayload;
      console.warn("Schema cache missing new columns; retrying guide_booking insert with legacy payload");

      const retry = await supabase
        .from("guide_booking")
        .insert(legacyPayload)
        .select()
        .single();

      booking = retry.data;
      bookingError = retry.error;
    }

    if (bookingError) {
      console.error("Error creating booking:", bookingError);
      return errorResponse(`Failed to create booking: ${bookingError.message}`, 500);
    }

    // Create Stripe Checkout Session (DESTINATION CHARGE — session on platform,
    // automatic transfer to guide's connected account. Events fire on platform.)
    const sessionParams = new URLSearchParams();
    sessionParams.append("mode", "payment");
    sessionParams.append("payment_method_types[]", "card");
    sessionParams.append("line_items[0][price_data][currency]", "cad");
    sessionParams.append("line_items[0][price_data][product_data][name]", `Guide: ${guide.name} — ${durationHours.toFixed(1)}h`);
    sessionParams.append("line_items[0][price_data][product_data][description]", `${start.toISOString().split("T")[0]} de ${start.toISOString().split("T")[1].slice(0,5)} à ${end.toISOString().split("T")[1].slice(0,5)}`);
    sessionParams.append("line_items[0][price_data][unit_amount]", String(amountInCents));
    sessionParams.append("line_items[0][quantity]", "1");
    if (applicationFeeInCents > 0) {
      sessionParams.append("payment_intent_data[application_fee_amount]", String(applicationFeeInCents));
    }
    sessionParams.append("payment_intent_data[transfer_data][destination]", guide.stripe_account_id);
    sessionParams.append("payment_intent_data[on_behalf_of]", guide.stripe_account_id);
    sessionParams.append("payment_intent_data[metadata][booking_type]", "guide");
    sessionParams.append("payment_intent_data[metadata][booking_id]", booking.id);
    sessionParams.append("payment_intent_data[metadata][guide_id]", guideId);
    sessionParams.append("payment_intent_data[metadata][guide_name]", guide.name || "");
    sessionParams.append("payment_intent_data[metadata][customer_name]", customerName);
    sessionParams.append("payment_intent_data[metadata][customer_email]", customerEmail);
    sessionParams.append("payment_intent_data[metadata][start_time]", startTime);
    sessionParams.append("payment_intent_data[metadata][end_time]", endTime);
    sessionParams.append("payment_intent_data[metadata][hours]", String(durationHours.toFixed(1)));
    sessionParams.append("payment_intent_data[metadata][source]", "payment_link");
    sessionParams.append("payment_intent_data[metadata][booking_origin]", BOOKING_ORIGIN_GUIDE_MANUAL);
    sessionParams.append("customer_email", customerEmail);
    sessionParams.append("expires_at", String(Math.floor(expiresAt.getTime() / 1000)));
    sessionParams.append("success_url", `${FRONTEND_URL}/map?payment=success&booking=${booking.id}`);
    sessionParams.append("cancel_url", `${FRONTEND_URL}/map?payment=cancelled&booking=${booking.id}`);
    sessionParams.append("metadata[booking_id]", booking.id);
    sessionParams.append("metadata[booking_type]", "guide");
    sessionParams.append("metadata[booking_origin]", BOOKING_ORIGIN_GUIDE_MANUAL);

    const session = await stripeRequest("POST", "/checkout/sessions", sessionParams);

    // Save the checkout session URL to the booking
    await supabase
      .from("guide_booking")
      .update({
        payment_link_url: session.url,
        stripe_payment_intent_id: session.payment_intent || null,
      })
      .eq("id", booking.id);

    console.log(`✅ Payment link created for booking ${booking.id}: ${session.url}`);

    return jsonResponse({
      bookingId: booking.id,
      paymentLinkUrl: session.url,
      expiresAt: expiresAt.toISOString(),
      pricing: {
        hours: Math.round(durationHours * 10) / 10,
        hourlyRate: guide.hourly_rate,
        subtotal: subtotal,
        applicationFee: applicationFee,
        total: totalPrice,
        paymentRequired: requiresPayment({ payment_status: "awaiting_payment", is_paid: false }),
      },
    });

  } catch (error) {
    console.error("stripe-create-payment-link error:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});
