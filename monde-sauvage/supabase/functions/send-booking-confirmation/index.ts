// =============================================================================
// Edge Function: send-booking-confirmation
// =============================================================================
// Sends a confirmation email with an invoice and calendar event attachment
// after a booking is successfully paid.
//
// Called by:
//   - stripe-webhook (after payment_intent.succeeded / checkout.session.completed)
//   - Can also be called manually for retries
//
// Idempotent: checks confirmation_email_sent_at to prevent duplicate sends.
//
// Required env vars:
//   - RESEND_API_KEY          — Resend API key for sending emails
//   - BOOKING_EMAIL_FROM      — (optional) Sender address
//   - SUPABASE_URL            — auto-provided
//   - SUPABASE_SERVICE_ROLE_KEY — auto-provided
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import {
  corsHeaders,
  errorResponse,
  jsonResponse,
} from "../_shared/stripeUtils.ts";
import {
  sendBookingConfirmationEmail,
  type BookingEmailData,
} from "../_shared/emailUtils.ts";

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
    const { bookingId, bookingType } = body as {
      bookingId: string;
      bookingType: "chalet" | "guide";
    };

    if (!bookingId) {
      return errorResponse("Missing bookingId");
    }

    const type = bookingType || "chalet";

    console.log(`📧 send-booking-confirmation: bookingId=${bookingId}, type=${type}`);

    // ─────────────────────────────────────────────────────────────────
    // GUIDE BOOKING
    // ─────────────────────────────────────────────────────────────────
    if (type === "guide") {
      // Fetch booking data
      const { data: booking, error: fetchError } = await supabase
        .from("guide_booking")
        .select(`
          id,
          guide_id,
          start_time,
          end_time,
          status,
          payment_status,
          customer_name,
          customer_email,
          customer_phone,
          trip_type,
          number_of_people,
          notes,
          payment_amount,
          application_fee,
          platform_fee_amount,
          platform_fee_waived,
          stripe_payment_intent_id,
          confirmation_email_sent_at
        `)
        .eq("id", bookingId)
        .single();

      if (fetchError || !booking) {
        console.error(`❌ Guide booking ${bookingId} not found:`, JSON.stringify(fetchError));
        return errorResponse("Booking not found", 404);
      }

      // Duplicate prevention
      if (booking.confirmation_email_sent_at) {
        console.log(`⏭️ Confirmation email already sent for guide booking ${bookingId} at ${booking.confirmation_email_sent_at}`);
        return jsonResponse({ sent: false, alreadySent: true });
      }

      // Only send for paid bookings
      if (booking.payment_status !== "paid") {
        console.log(`⏭️ Guide booking ${bookingId} not paid (status: ${booking.payment_status}) — skipping email`);
        return jsonResponse({ sent: false, reason: "not_paid" });
      }

      // Fetch guide info separately
      let guide: { id: string; name: string; email: string } | null = null;
      if (booking.guide_id) {
        const { data: guideData } = await supabase
          .from("guide")
          .select("id, name, email")
          .eq("id", booking.guide_id)
          .single();
        guide = guideData;
      }

      // Calculate duration
      const startMs = new Date(booking.start_time).getTime();
      const endMs = new Date(booking.end_time).getTime();
      const durationHours = (endMs - startMs) / (1000 * 60 * 60);
      const durationLabel = durationHours > 0 ? `${Math.round(durationHours * 10) / 10}h` : "1 jour";

      const total = parseFloat(booking.payment_amount) || 0;
      const feeAmount = parseFloat(booking.platform_fee_amount ?? booking.application_fee) || 0;
      const subtotal = Math.max(total - feeAmount, 0);

      // Build hourly rate label
      const hourlyRate = durationHours > 0 ? Math.round((total / durationHours) * 100) / 100 : total;
      const unitLabel = durationHours > 0 ? `${formatPriceSimple(hourlyRate)}/h × ${durationLabel}` : `${formatPriceSimple(total)}`;

      const bookingIdStr = String(booking.id);

      // start_time and end_time may be date-only strings (e.g. "2026-03-19")
      // Ensure they have time components for calendar events
      const startIso = booking.start_time.includes("T") ? booking.start_time : `${booking.start_time}T09:00:00`;
      const endIso = booking.end_time.includes("T") ? booking.end_time : `${booking.end_time}T17:00:00`;

      const emailData: BookingEmailData = {
        bookingId: bookingIdStr,
        bookingType: "guide",
        customerName: booking.customer_name,
        customerEmail: booking.customer_email,
        eventTitle: `Monde Sauvage – Réservation Guide${guide?.name ? ` (${guide.name})` : ""}`,
        startTime: startIso,
        endTime: endIso,
        guideName: guide?.name || undefined,
        guideEmail: guide?.email || undefined,
        tripType: booking.trip_type || undefined,
        numberOfPeople: booking.number_of_people || undefined,
        subtotal,
        total,
        currency: "CAD",
        unitLabel,
        duration: durationLabel,
        paymentIntentId: booking.stripe_payment_intent_id || undefined,
        paymentMethod: "Carte bancaire",
      };

      // Send email
      const result = await sendBookingConfirmationEmail(emailData);

      if (result.success) {
        // Mark as sent to prevent duplicates
        await supabase
          .from("guide_booking")
          .update({ confirmation_email_sent_at: new Date().toISOString() })
          .eq("id", bookingId);

        console.log(`✅ Confirmation email sent for guide booking ${bookingId}`);
        return jsonResponse({ sent: true, emailId: result.emailId });
      } else {
        console.error(`❌ Failed to send email for guide booking ${bookingId}:`, result.error);
        return jsonResponse({ sent: false, error: result.error }, 200);
      }
    }

    // ─────────────────────────────────────────────────────────────────
    // CHALET BOOKING
    // ─────────────────────────────────────────────────────────────────
    else {
      // Fetch booking + chalet + establishment data
      const { data: booking, error: fetchError } = await supabase
        .from("bookings")
        .select(`
          id,
          chalet_id,
          start_date,
          end_date,
          status,
          payment_status,
          customer_name,
          customer_email,
          notes,
          total_price,
          nights,
          price_per_night,
          application_fee,
          platform_fee_amount,
          platform_fee_waived,
          stripe_payment_intent_id,
          confirmation_email_sent_at
        `)
        .eq("id", bookingId)
        .single();

      if (fetchError || !booking) {
        console.error(`❌ Chalet booking ${bookingId} not found:`, JSON.stringify(fetchError));
        return errorResponse("Booking not found", 404);
      }

      // Duplicate prevention
      if (booking.confirmation_email_sent_at) {
        console.log(`⏭️ Confirmation email already sent for chalet booking ${bookingId} at ${booking.confirmation_email_sent_at}`);
        return jsonResponse({ sent: false, alreadySent: true });
      }

      // Only send for paid bookings
      if (booking.payment_status !== "paid") {
        console.log(`⏭️ Chalet booking ${bookingId} not paid (status: ${booking.payment_status}) — skipping email`);
        return jsonResponse({ sent: false, reason: "not_paid" });
      }

      // Fetch chalet name
      let chaletName = "";
      let establishmentName = "";
      if (booking.chalet_id) {
        const { data: chalet } = await supabase
          .from("chalets")
          .select(`"Name", etablishment_id`)
          .eq("key", booking.chalet_id)
          .single();

        if (chalet) {
          chaletName = chalet.Name || "";
          if (chalet.etablishment_id) {
            const { data: est } = await supabase
              .from("Etablissement")
              .select(`"Name"`)
              .eq("key", chalet.etablishment_id)
              .single();
            establishmentName = est?.Name || "";
          }
        }
      }

      const total = parseFloat(booking.total_price) || 0;
      const nights = parseInt(booking.nights) || 1;
      const pricePerNight = parseFloat(booking.price_per_night) || 0;
      const unitLabel = `${formatPriceSimple(pricePerNight)} × ${nights} nuit${nights > 1 ? "s" : ""}`;

      // For chalet bookings, start/end are dates not datetimes
      // Create full-day ISO strings
      const startIso = booking.start_date.includes("T") ? booking.start_date : `${booking.start_date}T14:00:00`;
      const endIso = booking.end_date.includes("T") ? booking.end_date : `${booking.end_date}T11:00:00`;

      const chaletBookingIdStr = String(booking.id);

      const emailData: BookingEmailData = {
        bookingId: chaletBookingIdStr,
        bookingType: "chalet",
        customerName: booking.customer_name,
        customerEmail: booking.customer_email,
        eventTitle: `Monde Sauvage – Séjour${chaletName ? ` ${chaletName}` : ""}`,
        startTime: startIso,
        endTime: endIso,
        chaletName: chaletName || undefined,
        establishmentName: establishmentName || undefined,
        subtotal: total,
        total,
        currency: "CAD",
        unitLabel,
        duration: `${nights} nuit${nights > 1 ? "s" : ""}`,
        paymentIntentId: booking.stripe_payment_intent_id || undefined,
        paymentMethod: "Carte bancaire",
      };

      // Send email
      const result = await sendBookingConfirmationEmail(emailData);

      if (result.success) {
        // Mark as sent to prevent duplicates
        await supabase
          .from("bookings")
          .update({ confirmation_email_sent_at: new Date().toISOString() })
          .eq("id", bookingId);

        console.log(`✅ Confirmation email sent for chalet booking ${bookingId}`);
        return jsonResponse({ sent: true, emailId: result.emailId });
      } else {
        console.error(`❌ Failed to send email for chalet booking ${bookingId}:`, result.error);
        return jsonResponse({ sent: false, error: result.error }, 200);
      }
    }

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("send-booking-confirmation error:", message);
    return errorResponse(message || "Internal server error", 500);
  }
});

// Simple price format without Intl (for unit labels)
function formatPriceSimple(amount: number): string {
  return `${amount.toFixed(2)} $`;
}
