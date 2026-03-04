// =============================================================================
// Edge Function: stripe-create-booking
// =============================================================================
// Handles the full booking + payment creation flow for BOTH chalets and guides:
//   1. Validates dates & availability
//   2. Calculates pricing (base + pricing rules for chalets, hourly for guides)
//   3. Creates a booking record with status 'pending'
//   4. Creates a Stripe PaymentIntent with application fee (10%)
//   5. Returns the client_secret for the frontend to complete payment
//
// Uses DIRECT CHARGES: money goes to the vendor's connected account first,
// and we take a 10% application fee automatically.
//
// bookingType: "chalet" (default) or "guide"
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import {
  stripeRequest,
  calculateTotalPrice,
  APPLICATION_FEE_PERCENT,
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

    // 1. Authenticate user (optional — allow guest checkout too)
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }

    // 2. Parse request
    const body = await req.json();
    const bookingType = body.bookingType || "chalet";

    if (bookingType === "guide") {
      return await handleGuideBooking(supabase, body, userId);
    } else {
      return await handleChaletBooking(supabase, body, userId);
    }

  } catch (error) {
    console.error("stripe-create-booking error:", error);
    return errorResponse(error.message || "Internal server error", 500);
  }
});

// =============================================================================
// CHALET BOOKING
// =============================================================================
async function handleChaletBooking(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  userId: string | null
) {
  const {
    chaletId,
    startDate,
    endDate,
    customerName,
    customerEmail,
    notes,
  } = body as {
    chaletId: string;
    startDate: string;
    endDate: string;
    customerName: string;
    customerEmail: string;
    notes?: string;
  };

  // Validate required fields
  if (!chaletId || !startDate || !endDate || !customerName || !customerEmail) {
    return errorResponse(
      "Missing required fields: chaletId, startDate, endDate, customerName, customerEmail"
    );
  }

  // Validate dates
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return errorResponse("Invalid date format");
  }
  if (end <= start) {
    return errorResponse("endDate must be after startDate");
  }

  // 3. Fetch chalet + establishment (need Stripe account ID)
  const { data: chalet, error: chaletError } = await supabase
    .from("chalets")
    .select(`
      key,
      "Name",
      price_per_night,
      etablishment_id
    `)
    .eq("key", chaletId)
    .single();

  if (chaletError || !chalet) {
    return errorResponse("Chalet not found", 404);
  }

  if (!chalet.price_per_night || chalet.price_per_night <= 0) {
    return errorResponse("Chalet has no price set. Contact the vendor.");
  }

  // Fetch establishment for Stripe account
  const { data: establishment, error: estError } = await supabase
    .from("Etablissement")
    .select("key, stripe_account_id, stripe_charges_enabled, \"Name\"")
    .eq("key", chalet.etablishment_id)
    .single();

  if (estError || !establishment) {
    return errorResponse("Establishment not found", 404);
  }

  if (!establishment.stripe_account_id) {
    return errorResponse(
      "This vendor hasn't set up payments yet. Please contact them.",
      422
    );
  }

  if (!establishment.stripe_charges_enabled) {
    return errorResponse(
      "This vendor's payment account is not yet active. Please try again later.",
      422
    );
  }

  // ── IDEMPOTENCY: reuse existing pending booking with same parameters ──
  const { data: existingChaletBooking } = await supabase
    .from("bookings")
    .select("id, stripe_payment_intent_id")
    .eq("chalet_id", chaletId)
    .eq("customer_email", customerEmail)
    .eq("start_date", startDate)
    .eq("end_date", endDate)
    .eq("status", "pending")
    .not("stripe_payment_intent_id", "is", null)
    .maybeSingle();

  if (existingChaletBooking?.stripe_payment_intent_id) {
    console.log(`⏩ Reusing existing pending chalet booking ${existingChaletBooking.id}`);
    const existingPI = await stripeRequest("GET", `/payment_intents/${existingChaletBooking.stripe_payment_intent_id}`);

    // Fetch pricing rules for response
    const { data: existingPricingRules } = await supabase
      .from("pricing_rules")
      .select("*")
      .eq("chalet_id", chaletId)
      .eq("is_active", true);

    const existingPricing = calculateTotalPrice(
      chalet.price_per_night,
      startDate,
      endDate,
      existingPricingRules || []
    );

    const existingFee = Math.round(existingPricing.totalPrice * APPLICATION_FEE_PERCENT * 100) / 100;
    const existingTotal = Math.round((existingPricing.totalPrice + existingFee) * 100) / 100;

    return jsonResponse({
      bookingId: existingChaletBooking.id,
      bookingType: "chalet",
      clientSecret: existingPI.client_secret,
      stripeAccountId: establishment.stripe_account_id,
      pricing: {
        nights: existingPricing.nights,
        pricePerNight: existingPricing.pricePerNight,
        subtotal: existingPricing.totalPrice,
        applicationFee: existingFee,
        total: existingTotal,
        breakdown: existingPricing.breakdown,
      },
    });
  }

  // 4. Check availability (no overlapping confirmed/pending bookings)
  const { data: overlapping } = await supabase
    .from("bookings")
    .select("id")
    .eq("chalet_id", chaletId)
    .in("status", ["confirmed", "pending"])
    .lt("start_date", endDate)
    .gt("end_date", startDate);

  if (overlapping && overlapping.length > 0) {
    return errorResponse("Chalet is not available for the selected dates", 409);
  }

  // 5. Fetch pricing rules for this chalet
  const { data: pricingRules } = await supabase
    .from("pricing_rules")
    .select("*")
    .eq("chalet_id", chaletId)
    .eq("is_active", true);

  // 6. Calculate total price
  const pricing = calculateTotalPrice(
    chalet.price_per_night,
    startDate,
    endDate,
    pricingRules || []
  );

  if (pricing.totalPrice <= 0) {
    return errorResponse("Calculated price is invalid");
  }

  // Fee is added ON TOP of the chalet price (customer pays 110%)
  const chaletSubtotal = pricing.totalPrice;
  const chaletApplicationFee = Math.round(chaletSubtotal * APPLICATION_FEE_PERCENT * 100) / 100;
  const chaletTotal = Math.round((chaletSubtotal + chaletApplicationFee) * 100) / 100;

  // Convert to cents for Stripe (CAD)
  const amountInCents = Math.round(chaletTotal * 100);
  const applicationFeeInCents = Math.round(chaletApplicationFee * 100);

  // 7. Create the booking record (pending payment)
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .insert({
      chalet_id: chaletId,
      start_date: startDate,
      end_date: endDate,
      status: "pending",
      payment_status: "processing",
      source: "website",
      customer_name: customerName,
      customer_email: customerEmail,
      notes: notes || null,
      user_id: userId,
      total_price: chaletTotal,
      nights: pricing.nights,
      price_per_night: pricing.pricePerNight,
      application_fee: chaletApplicationFee,
    })
    .select()
    .single();

  if (bookingError) {
    console.error("Error creating booking:", bookingError);
    return errorResponse(`Failed to create booking: ${bookingError.message || bookingError.code || JSON.stringify(bookingError)}`, 500);
  }

  // 8. Create Stripe PaymentIntent (DESTINATION CHARGE — payment on platform,
  //    automatic transfer to connected account. This ensures webhook events
  //    fire on the platform account so stripe-webhook receives them.)
  const paymentIntent = await stripeRequest("POST", "/payment_intents", {
    amount: String(amountInCents),
    currency: "cad",
    payment_method_types: ["card"],
    application_fee_amount: String(applicationFeeInCents),
    transfer_data: {
      destination: establishment.stripe_account_id,
    },
    on_behalf_of: establishment.stripe_account_id,
    metadata: {
      booking_type: "chalet",
      booking_id: booking.id,
      chalet_id: chaletId,
      chalet_name: chalet.Name || "",
      establishment_name: establishment.Name || "",
      customer_name: customerName,
      customer_email: customerEmail,
      start_date: startDate,
      end_date: endDate,
      nights: String(pricing.nights),
    },
    receipt_email: customerEmail,
    description: `Réservation: ${chalet.Name || "Chalet"} — ${pricing.nights} nuit(s) du ${startDate} au ${endDate}`,
  });

  // 9. Save PaymentIntent ID to booking
  await supabase
    .from("bookings")
    .update({ stripe_payment_intent_id: paymentIntent.id })
    .eq("id", booking.id);

  console.log(`✅ Chalet booking ${booking.id} created with PaymentIntent ${paymentIntent.id}`);
  console.log(`   Subtotal: $${chaletSubtotal} | Fee: $${chaletApplicationFee} | Total: $${chaletTotal} CAD`);

  // 10. Return client_secret + booking info to frontend
  return jsonResponse({
    bookingId: booking.id,
    bookingType: "chalet",
    clientSecret: paymentIntent.client_secret,
    stripeAccountId: establishment.stripe_account_id,
    pricing: {
      nights: pricing.nights,
      pricePerNight: pricing.pricePerNight,
      subtotal: chaletSubtotal,
      applicationFee: chaletApplicationFee,
      total: chaletTotal,
      breakdown: pricing.breakdown,
    },
  });
}

// =============================================================================
// GUIDE BOOKING
// =============================================================================
async function handleGuideBooking(
  supabase: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  userId: string | null
) {
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
  } = body as {
    guideId: string;
    startTime: string;
    endTime: string;
    customerName: string;
    customerEmail: string;
    customerPhone?: string;
    tripType?: string;
    numberOfPeople?: number;
    notes?: string;
  };

  // Validate required fields
  if (!guideId || !startTime || !endTime || !customerName || !customerEmail) {
    return errorResponse(
      "Missing required fields: guideId, startTime, endTime, customerName, customerEmail"
    );
  }

  // ── DATE SHIFT GUARD ──────────────────────────────────────
  // Log raw input values for debugging timezone issues
  console.log(`🔒 [DATE GUARD] Raw input startTime: "${startTime}"`);
  console.log(`🔒 [DATE GUARD] Raw input endTime:   "${endTime}"`);

  // Validate dates
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return errorResponse("Invalid date format");
  }
  if (end <= start) {
    return errorResponse("endTime must be after startTime");
  }

  console.log(`🔒 [DATE GUARD] Parsed start UTC: ${start.toISOString()}`);
  console.log(`🔒 [DATE GUARD] Parsed end UTC:   ${end.toISOString()}`);
  
  // Assert: the stored value should match the input (no silent conversion)
  if (start.toISOString() !== new Date(startTime).toISOString()) {
    console.error(`❌ [DATE GUARD] DATE MISMATCH! Input="${startTime}" Parsed="${start.toISOString()}"`);
  }

  // 3. Fetch guide (need Stripe account ID + hourly rate)
  const { data: guide, error: guideError } = await supabase
    .from("guide")
    .select("id, name, email, hourly_rate, stripe_account_id, stripe_charges_enabled")
    .eq("id", guideId)
    .single();

  if (guideError || !guide) {
    return errorResponse("Guide not found", 404);
  }

  if (!guide.stripe_account_id) {
    return errorResponse(
      "Ce guide n'a pas encore configuré les paiements. Veuillez le contacter.",
      422
    );
  }

  if (!guide.stripe_charges_enabled) {
    return errorResponse(
      "Le compte de paiement de ce guide n'est pas encore actif. Réessayez plus tard.",
      422
    );
  }

  if (!guide.hourly_rate || guide.hourly_rate <= 0) {
    return errorResponse("Ce guide n'a pas défini de taux horaire.");
  }

  // 4. Calculate total price based on hours
  const durationMs = end.getTime() - start.getTime();
  const durationHours = durationMs / (1000 * 60 * 60);
  const subtotal = Math.round(guide.hourly_rate * durationHours * 100) / 100;

  if (subtotal <= 0) {
    return errorResponse("Calculated price is invalid");
  }

  // Fee is added ON TOP of the guide's price (customer pays 110%)
  const applicationFee = Math.round(subtotal * APPLICATION_FEE_PERCENT * 100) / 100;
  const totalPrice = Math.round((subtotal + applicationFee) * 100) / 100;

  // Convert to cents for Stripe (CAD)
  const amountInCents = Math.round(totalPrice * 100);
  const applicationFeeInCents = Math.round(applicationFee * 100);

  // ── IDEMPOTENCY: reuse existing pending booking with same parameters ──
  // Do NOT require stripe_payment_intent_id to exist — a parallel request
  // (e.g. React StrictMode double-fire) may have created the row but not
  // yet attached the PaymentIntent.
  const { data: existingGuideBooking } = await supabase
    .from("guide_booking")
    .select("id, stripe_payment_intent_id")
    .eq("guide_id", guideId)
    .eq("customer_email", customerEmail)
    .eq("start_time", startTime)
    .eq("end_time", endTime)
    .eq("status", "pending")
    .is("deleted_at", null)
    .maybeSingle();

  if (existingGuideBooking) {
    // If the existing booking already has a PaymentIntent, reuse it as-is
    if (existingGuideBooking.stripe_payment_intent_id) {
      console.log(`⏩ Reusing existing pending guide booking ${existingGuideBooking.id} (has PI)`);
      const existingPI = await stripeRequest("GET", `/payment_intents/${existingGuideBooking.stripe_payment_intent_id}`);

      return jsonResponse({
        bookingId: existingGuideBooking.id,
        bookingType: "guide",
        clientSecret: existingPI.client_secret,
        stripeAccountId: guide.stripe_account_id,
        pricing: {
          hours: Math.round(durationHours * 10) / 10,
          hourlyRate: guide.hourly_rate,
          subtotal: subtotal,
          applicationFee: applicationFee,
          total: totalPrice,
        },
      });
    }

    // Existing booking without a PI yet (parallel request in progress).
    // Create a PaymentIntent and attach it to the existing booking.
    console.log(`⏩ Reusing existing pending guide booking ${existingGuideBooking.id} (creating PI)`);

    const paymentIntent = await stripeRequest("POST", "/payment_intents", {
      amount: String(amountInCents),
      currency: "cad",
      payment_method_types: ["card"],
      application_fee_amount: String(applicationFeeInCents),
      transfer_data: {
        destination: guide.stripe_account_id,
      },
      on_behalf_of: guide.stripe_account_id,
      metadata: {
        booking_type: "guide",
        booking_id: existingGuideBooking.id,
        guide_id: guideId,
        guide_name: guide.name || "",
        customer_name: customerName,
        customer_email: customerEmail,
        start_time: startTime,
        end_time: endTime,
        hours: String(durationHours.toFixed(1)),
      },
      receipt_email: customerEmail,
      description: `Guide: ${guide.name || "Guide"} — ${durationHours.toFixed(1)}h le ${start.toISOString().split("T")[0]}`,
    });

    await supabase
      .from("guide_booking")
      .update({ stripe_payment_intent_id: paymentIntent.id })
      .eq("id", existingGuideBooking.id);

    console.log(`✅ PI ${paymentIntent.id} attached to existing guide booking ${existingGuideBooking.id}`);

    return jsonResponse({
      bookingId: existingGuideBooking.id,
      bookingType: "guide",
      clientSecret: paymentIntent.client_secret,
      stripeAccountId: guide.stripe_account_id,
      pricing: {
        hours: Math.round(durationHours * 10) / 10,
        hourlyRate: guide.hourly_rate,
        subtotal: subtotal,
        applicationFee: applicationFee,
        total: totalPrice,
      },
    });
  }

  // 5. Check availability (no overlapping confirmed/pending bookings)
  //    This is a fast pre-check; the DB trigger is the real safety net.
  console.log(`🔍 [GUIDE] Pre-check: looking for overlapping bookings for guide=${guideId} start=${startTime} end=${endTime}`);
  const { data: overlapping, error: overlapError } = await supabase
    .from("guide_booking")
    .select("id, start_time, end_time, status")
    .eq("guide_id", guideId)
    .in("status", ["confirmed", "pending", "pending_payment", "booked"])
    .is("deleted_at", null)
    .lt("start_time", endTime)
    .gt("end_time", startTime);

  if (overlapError) {
    console.error(`❌ [GUIDE] Overlap check query error:`, overlapError);
  }

  if (overlapping && overlapping.length > 0) {
    console.log(`❌ [GUIDE] Found ${overlapping.length} overlapping booking(s):`, JSON.stringify(overlapping));
    return errorResponse("Le guide n'est pas disponible pour ce créneau. Un autre utilisateur a déjà réservé.", 409);
  }

  console.log(`✅ [GUIDE] No overlapping bookings found — proceeding to insert`);

  // 6. Create the guide booking record (pending payment)
  //    Set a 30-minute expiry so unpaid bookings are auto-cleaned up.
  //    The DB trigger (prevent_guide_booking_overlap) prevents
  //    overlapping active bookings even if two requests race past step 5.
  const PENDING_EXPIRY_MINUTES = 30;
  const pendingExpiresAt = new Date(Date.now() + PENDING_EXPIRY_MINUTES * 60 * 1000);

  console.log(`📝 [GUIDE] Inserting booking: guide=${guideId} start=${startTime} end=${endTime} status=pending`);

  const { data: booking, error: bookingError } = await supabase
    .from("guide_booking")
    .insert({
      guide_id: guideId,
      start_time: startTime,
      end_time: endTime,
      status: "pending",
      payment_status: "processing",
      source: "website",
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone || null,
      trip_type: tripType || null,
      number_of_people: numberOfPeople || 1,
      notes: notes || null,
      is_paid: false,
      payment_amount: totalPrice,
      application_fee: applicationFee,
      payment_link_expires_at: pendingExpiresAt.toISOString(),
      google_event_id: null,
    })
    .select()
    .single();

  if (bookingError) {
    console.error("❌ [GUIDE] Error creating guide booking:", JSON.stringify(bookingError));
    console.error("❌ [GUIDE] Error code:", bookingError.code);
    console.error("❌ [GUIDE] Error message:", bookingError.message);
    console.error("❌ [GUIDE] Error details:", bookingError.details);
    console.error("❌ [GUIDE] Error hint:", bookingError.hint);

    // Catch exclusion constraint violation (23P01) or trigger overlap rejection
    const errorMsg = bookingError.message || bookingError.code || JSON.stringify(bookingError);
    if (bookingError.code === "23P01" || errorMsg.includes("guide_booking_no_overlap") || errorMsg.includes("exclusion") || errorMsg.includes("chevauche")) {
      return errorResponse(
        "Ce créneau vient d'être réservé par un autre utilisateur. Veuillez choisir un autre horaire.",
        409
      );
    }

    return errorResponse(`Failed to create guide booking: ${errorMsg}`, 500);
  }

  // 7. Create Stripe PaymentIntent (DESTINATION CHARGE — payment on platform,
  //    automatic transfer to guide's connected account. Events fire on platform.)
  const paymentIntent = await stripeRequest("POST", "/payment_intents", {
    amount: String(amountInCents),
    currency: "cad",
    payment_method_types: ["card"],
    application_fee_amount: String(applicationFeeInCents),
    transfer_data: {
      destination: guide.stripe_account_id,
    },
    on_behalf_of: guide.stripe_account_id,
    metadata: {
      booking_type: "guide",
      booking_id: booking.id,
      guide_id: guideId,
      guide_name: guide.name || "",
      customer_name: customerName,
      customer_email: customerEmail,
      start_time: startTime,
      end_time: endTime,
      hours: String(durationHours.toFixed(1)),
    },
    receipt_email: customerEmail,
    description: `Guide: ${guide.name || "Guide"} — ${durationHours.toFixed(1)}h le ${start.toISOString().split("T")[0]}`,
  });

  // 8. Save PaymentIntent ID to booking
  await supabase
    .from("guide_booking")
    .update({ stripe_payment_intent_id: paymentIntent.id })
    .eq("id", booking.id);

  console.log(`✅ Guide booking ${booking.id} created with PaymentIntent ${paymentIntent.id}`);
  console.log(`   Subtotal: $${subtotal} | Fee: $${applicationFee} | Total: $${totalPrice} CAD`);

  // 9. Return client_secret + booking info to frontend
  return jsonResponse({
    bookingId: booking.id,
    bookingType: "guide",
    clientSecret: paymentIntent.client_secret,
    stripeAccountId: guide.stripe_account_id,
    expiresAt: pendingExpiresAt.toISOString(),
    pricing: {
      hours: Math.round(durationHours * 10) / 10,
      hourlyRate: guide.hourly_rate,
      subtotal: subtotal,
      applicationFee: applicationFee,
      total: totalPrice,
    },
  });
}
