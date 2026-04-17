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
import {
  getBookingOrigin,
  shouldApplyPlatformFee,
} from "../_shared/bookingRules.ts";
import { createQuickbooksInvoice } from "../_shared/quickbooksUtils.ts";

// ─── Helper: QuickBooks invoice sync for either entity ─────────────────────
// Looks up the right vendor (Etablissement for chalets, Guide for guides)
// from PI metadata, creates a QBO invoice if that vendor is connected, and
// persists the invoice id onto the matching booking row(s). Never throws —
// any error is logged and swallowed so the webhook keeps succeeding.
async function syncQuickbooksInvoice(
  supabase: ReturnType<typeof createClient>,
  metadata: Record<string, string>,
  amountDollars: number
) {
  const bookingType = (metadata?.booking_type || "chalet") as "chalet" | "guide";
  const primaryBookingId = metadata?.booking_id;
  if (!primaryBookingId) return;

  try {
    if (bookingType === "chalet") {
      const establishmentId = metadata?.establishment_id;
      if (!establishmentId) {
        console.log("[QBO] chalet PI missing establishment_id metadata — skipping owner invoice sync");
        return;
      }

      const { data: vendor, error: vendorErr } = await supabase
        .from("Etablissement")
        .select("key, quickbooks_connected, quickbooks_access_token, quickbooks_realm_id")
        .eq("key", establishmentId)
        .single();

      if (vendorErr) {
        console.warn(`[QBO] Etablissement lookup failed (${establishmentId}):`, vendorErr.message);
        return;
      }
      if (!vendor?.quickbooks_connected) {
        console.log(`[QBO] Etablissement ${establishmentId} not connected — skipping invoice sync`);
        return;
      }

      const invoice = await createQuickbooksInvoice(
        {
          id: vendor.key,
          quickbooks_connected: vendor.quickbooks_connected,
          quickbooks_access_token: vendor.quickbooks_access_token,
          quickbooks_realm_id: vendor.quickbooks_realm_id,
        },
        amountDollars
      );
      const invoiceId = String(((invoice as Record<string, unknown>)?.Invoice as Record<string, unknown>)?.Id || "");
      console.log(`[QBO] ✅ Owner invoice synced: establishment=${establishmentId} amount=${amountDollars} invoice=${invoiceId || "?"}`);

      if (invoiceId) {
        await supabase
          .from("bookings")
          .update({
            quickbooks_invoice_id: invoiceId,
            quickbooks_invoice_synced_at: new Date().toISOString(),
          })
          .eq("id", primaryBookingId);
      }
      return;
    }

    // ── Guide flow ──
    const qbGuideId = metadata?.guide_id;
    const qbUserId = metadata?.user_id;
    if (!qbGuideId && !qbUserId) {
      console.log("[QBO] guide PI missing guide_id / user_id metadata — skipping invoice sync");
      return;
    }

    const baseQuery = supabase
      .from("guide")
      .select("id, user_id, quickbooks_connected, quickbooks_access_token, quickbooks_realm_id");
    const { data: vendor, error: vendorErr } = qbGuideId
      ? await baseQuery.eq("id", qbGuideId).single()
      : await baseQuery.eq("user_id", qbUserId).single();

    if (vendorErr) {
      console.warn(`[QBO] guide lookup failed (guide_id=${qbGuideId}, user_id=${qbUserId}):`, vendorErr.message);
      return;
    }
    if (!vendor?.quickbooks_connected) {
      console.log(`[QBO] guide ${vendor?.id} not connected — skipping invoice sync`);
      return;
    }

    const invoice = await createQuickbooksInvoice(vendor, amountDollars);
    const invoiceId = String(((invoice as Record<string, unknown>)?.Invoice as Record<string, unknown>)?.Id || "");
    console.log(`[QBO] ✅ Guide invoice synced: guide=${vendor.id} amount=${amountDollars} invoice=${invoiceId || "?"}`);

    if (invoiceId) {
      const allBookingIdsRaw = metadata?.all_booking_ids;
      const bookingIds = allBookingIdsRaw
        ? allBookingIdsRaw.split(",").filter(Boolean)
        : [primaryBookingId];

      await supabase
        .from("guide_booking")
        .update({
          quickbooks_invoice_id: invoiceId,
          quickbooks_invoice_synced_at: new Date().toISOString(),
        })
        .in("id", bookingIds);
    }
  } catch (err: any) {
    console.warn(`[QBO] invoice sync failed:`, err?.message || err);
  }
}

// ─── Helper: fire-and-forget confirmation email ────────────────────────────
async function fireConfirmationEmail(
  supabaseUrl: string,
  serviceRoleKey: string,
  bookingId: string,
  bookingType: "chalet" | "guide"
) {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-booking-confirmation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bookingId, bookingType }),
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`📧 Confirmation email result for ${bookingId}:`, JSON.stringify(data));
    } else {
      console.warn(`⚠️ Confirmation email HTTP error for ${bookingId}: ${res.status}`, await res.text());
    }
  } catch (err: any) {
    console.warn(`⚠️ Confirmation email call failed for ${bookingId}:`, err.message);
  }
}

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
        const amountDollars = Number(dataObject.amount || 0) / 100;

        const bookingOrigin = getBookingOrigin({ booking_origin: metadata?.booking_origin, source: metadata?.source });
        const platformFeeAmount = Math.round(((Number(dataObject.application_fee_amount || 0) / 100) || 0) * 100) / 100;
        const platformFeeWaived = !shouldApplyPlatformFee({ booking_origin: bookingOrigin }) || platformFeeAmount === 0;

        console.log(`💰 payment_intent.succeeded: PI=${paymentIntentId}, type=${bookingType}, booking=${bookingId}`);

        if (!bookingId) {
          console.warn("⚠️ payment_intent.succeeded missing booking_id in metadata — skipping DB update");
          break;
        }

        if (bookingType === "guide") {
          // ── Multi-slot support ──────────────────────────────────────
          // If metadata contains all_booking_ids, confirm ALL bookings
          // and create calendar events for each one individually.
          const allBookingIdsRaw = metadata?.all_booking_ids;
          const bookingIdsToConfirm = allBookingIdsRaw
            ? allBookingIdsRaw.split(",").filter(Boolean)
            : [bookingId];

          console.log(`📋 [GUIDE] Confirming ${bookingIdsToConfirm.length} booking(s): ${bookingIdsToConfirm.join(", ")}`);

          for (const bId of bookingIdsToConfirm) {
            const { data: updated, error } = await supabase
              .from("guide_booking")
              .update({
                status: "confirmed",
                payment_status: "paid",
                is_paid: true,
                stripe_payment_intent_id: paymentIntentId,
                booking_origin: bookingOrigin,
                application_fee: platformFeeAmount,
                platform_fee_amount: platformFeeAmount,
                platform_fee_waived: platformFeeWaived,
              })
              .eq("id", bId)
              .select("id, status, payment_status, guide_id, start_time, end_time, customer_name, customer_email, trip_type, notes, google_event_id")
              .single();

            if (error) {
              console.error(`❌ Failed to confirm guide booking ${bId}:`, JSON.stringify(error));
              continue; // Don't block other bookings
            }

            console.log(`✅ Guide booking ${bId} → status=${updated.status}, payment_status=${updated.payment_status}`);

            // Send confirmation email (fire-and-forget)
            fireConfirmationEmail(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, bId, "guide");

            // Create Google Calendar event if not already linked
            if (updated && !updated.google_event_id) {
              console.log(`🔒 [DATE GUARD] Webhook → calendar event for booking ${bId}:`);
              console.log(`🔒 [DATE GUARD]   DB start_time: "${updated.start_time}"`);
              console.log(`🔒 [DATE GUARD]   DB end_time:   "${updated.end_time}"`);

              try {
                const calRes = await fetch(`${SUPABASE_URL}/functions/v1/create-guide-booking-event`, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    booking_id: updated.id,
                    guide_id: updated.guide_id,
                    start_time: updated.start_time,
                    end_time: updated.end_time,
                    customer_name: updated.customer_name,
                    customer_email: updated.customer_email,
                    trip_type: updated.trip_type,
                    notes: updated.notes,
                  }),
                });
                if (calRes.ok) {
                  const calData = await calRes.json();
                  console.log(`📅 Google Calendar event created for guide booking ${bId}: ${calData.event_id}`);
                } else {
                  const calErrText = await calRes.text();
                  console.warn(`⚠️ Google Calendar event creation failed for ${bId}:`, calErrText);
                  await supabase
                    .from("guide_booking")
                    .update({ calendar_sync_failed: true, calendar_sync_error: calErrText.slice(0, 500) })
                    .eq("id", bId);
                }
              } catch (calErr: any) {
                console.warn(`⚠️ Google Calendar sync error for ${bId}:`, calErr.message);
                await supabase
                  .from("guide_booking")
                  .update({ calendar_sync_failed: true, calendar_sync_error: calErr.message })
                  .eq("id", bId);
              }
            }
          }
        } else {
          const { data: updated, error } = await supabase
            .from("bookings")
            .update({
              status: "confirmed",
              payment_status: "paid",
              stripe_payment_intent_id: paymentIntentId,
              booking_origin: bookingOrigin,
              application_fee: platformFeeAmount,
              platform_fee_amount: platformFeeAmount,
              platform_fee_waived: platformFeeWaived,
            })
            .eq("id", bookingId)
            .select("id, status, payment_status")
            .single();

          if (error) {
            console.error(`❌ Failed to confirm chalet booking ${bookingId}:`, JSON.stringify(error));
          } else {
            console.log(`✅ Chalet booking ${bookingId} → status=${updated.status}, payment_status=${updated.payment_status}`);

            // Send confirmation email (fire-and-forget)
            fireConfirmationEmail(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, bookingId, "chalet");
          }
        }

        // ── QuickBooks invoice sync (vendor-side) ───────────────────────
        // Runs after booking confirmation so we can persist the invoice id
        // back to the booking row(s). Helper swallows its own errors.
        await syncQuickbooksInvoice(supabase, metadata, amountDollars);
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

        console.log(`❌ payment_intent.payment_failed: PI=${paymentIntentId}, booking=${bookingId}, reason=${failureMessage}`);

        if (bookingId) {
          if (bookingType === "guide") {
            // Handle multi-slot: cancel ALL bookings linked to this PI
            const allBookingIdsRaw = metadata?.all_booking_ids;
            const bookingIdsToCancel = allBookingIdsRaw
              ? allBookingIdsRaw.split(",").filter(Boolean)
              : [bookingId];

            for (const bId of bookingIdsToCancel) {
              await supabase
                .from("guide_booking")
                .update({
                  status: "cancelled",
                  payment_status: "failed",
                  is_paid: false,
                  notes: `Payment failed: ${failureMessage || "Unknown error"}`,
                })
                .eq("id", bId);

              console.log(`❌ Guide booking ${bId} marked as failed`);
            }
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
      // Checkout Session completed — confirm payment-link bookings
      // ─────────────────────────────────────────────────────────────────
      case "checkout.session.completed": {
        const sessionMetadata = dataObject.metadata as Record<string, string>;
        const sessionBookingId = sessionMetadata?.booking_id;
        const sessionBookingType = sessionMetadata?.booking_type || "guide";
        const sessionBookingOrigin = getBookingOrigin({ booking_origin: sessionMetadata?.booking_origin });
        const sessionPlatformFeeWaived = !shouldApplyPlatformFee({ booking_origin: sessionBookingOrigin });
        const paymentStatus = dataObject.payment_status as string;
        const piId = dataObject.payment_intent as string;

        console.log(`🧾 checkout.session.completed: booking=${sessionBookingId}, type=${sessionBookingType}, payment=${paymentStatus}, PI=${piId}`);

        if (sessionBookingId && paymentStatus === "paid") {
          if (sessionBookingType === "guide") {
            const { data: updated, error } = await supabase
              .from("guide_booking")
              .update({
                status: "confirmed",
                payment_status: "paid",
                is_paid: true,
                stripe_payment_intent_id: piId || null,
                payment_link_url: null, // Clear payment link after successful payment
                booking_origin: sessionBookingOrigin,
                platform_fee_waived: sessionPlatformFeeWaived,
                platform_fee_amount: sessionPlatformFeeWaived ? 0 : undefined,
                application_fee: sessionPlatformFeeWaived ? 0 : undefined,
              })
              .eq("id", sessionBookingId)
              .select("id, status, payment_status, guide_id, start_time, end_time, customer_name, customer_email, trip_type, notes, google_event_id")
              .single();

            if (error) {
              console.error(`❌ Failed to confirm guide booking ${sessionBookingId} via checkout:`, JSON.stringify(error));
            } else {
              console.log(`✅ Guide booking ${sessionBookingId} confirmed via checkout → status=${updated.status}`);

              // Send confirmation email (fire-and-forget)
              fireConfirmationEmail(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, sessionBookingId, "guide");

              // Create Google Calendar event if not already linked
              if (updated && !updated.google_event_id) {
                try {
                  const calRes = await fetch(`${SUPABASE_URL}/functions/v1/create-guide-booking-event`, {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      booking_id: updated.id,
                      guide_id: updated.guide_id,
                      start_time: updated.start_time,
                      end_time: updated.end_time,
                      customer_name: updated.customer_name,
                      customer_email: updated.customer_email,
                      trip_type: updated.trip_type,
                      notes: updated.notes,
                    }),
                  });
                  if (calRes.ok) {
                    const calData = await calRes.json();
                    console.log(`📅 Google Calendar event created for guide booking ${sessionBookingId}: ${calData.event_id}`);
                  } else {
                    console.warn(`⚠️ Google Calendar event creation failed for ${sessionBookingId}:`, await calRes.text());
                  }
                } catch (calErr: any) {
                  console.warn(`⚠️ Google Calendar sync error for ${sessionBookingId}:`, calErr.message);
                }
              }
            }
          } else {
            const { data: updated, error } = await supabase
              .from("bookings")
              .update({
                status: "confirmed",
                payment_status: "paid",
                stripe_payment_intent_id: piId || null,
              })
              .eq("id", sessionBookingId)
              .select("id, status, payment_status")
              .single();

            if (error) {
              console.error(`❌ Failed to confirm chalet booking ${sessionBookingId} via checkout:`, JSON.stringify(error));
            } else {
              console.log(`✅ Chalet booking ${sessionBookingId} confirmed via checkout → status=${updated.status}`);

              // Send confirmation email (fire-and-forget)
              fireConfirmationEmail(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, sessionBookingId, "chalet");
            }
          }
        } else {
          console.warn(`⚠️ checkout.session.completed: booking=${sessionBookingId} but payment_status=${paymentStatus} — not confirming`);
        }
        break;
      }

      // ─────────────────────────────────────────────────────────────────
      // Checkout Session expired — cancel the pending booking
      // ─────────────────────────────────────────────────────────────────
      case "checkout.session.expired": {
        const sessionMetadata = dataObject.metadata as Record<string, string>;
        const sessionBookingId = sessionMetadata?.booking_id;

        console.log(`⏰ checkout.session.expired: booking=${sessionBookingId}`);

        if (sessionBookingId) {
          const { data: updated } = await supabase
            .from("guide_booking")
            .update({
              status: "cancelled",
              payment_status: "expired",
              notes: "Lien de paiement expiré — réservation annulée automatiquement",
            })
            .eq("id", sessionBookingId)
            .eq("status", "pending_payment") // Only cancel if still pending
            .select("id, status")
            .single();

          if (updated) {
            console.log(`❌ Booking ${sessionBookingId} cancelled (checkout expired)`);
          } else {
            console.log(`ℹ️ Booking ${sessionBookingId} not in pending_payment status, skip expiry`);
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
    console.error("stripe-webhook UNHANDLED error:", error?.message || error, error?.stack);
    // Return 200 to prevent Stripe from retrying on our application errors.
    // Signature / parse failures already returned 4xx above.
    return jsonResponse({ received: true, error: error.message }, 200);
  }
});
