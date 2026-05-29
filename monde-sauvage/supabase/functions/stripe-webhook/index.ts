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
  stripeRequest,
  corsHeaders,
  errorResponse,
  jsonResponse,
} from "../_shared/stripeUtils.ts";
import {
  getBookingOrigin,
  shouldApplyPlatformFee,
} from "../_shared/bookingRules.ts";
import { createQuickbooksInvoice, ensureFreshQboToken } from "../_shared/quickbooksUtils.ts";

// ─── Helper: handle a combined (guide + chalet) PaymentIntent success ──────
// In combined mode the PI is created on the platform with no transfer_data.
// On success we manually create up to two Transfer objects, one per vendor,
// linking them via source_transaction so each transfer is funded by this PI.
// The remainder (the application fee) stays on the platform balance.
async function handleCombinedPaymentSuccess(
  supabase: ReturnType<typeof createClient>,
  paymentIntent: Record<string, unknown>,
  metadata: Record<string, string>,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const paymentIntentId = paymentIntent.id as string;
  const guideBookingIdsRaw = metadata?.guide_booking_ids || "";
  const guideBookingIds = guideBookingIdsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const chaletBookingId = metadata?.chalet_booking_id || "";
  const guideStripeAccount = metadata?.guide_stripe_account || "";
  const chaletStripeAccount = metadata?.chalet_stripe_account || "";
  const guideAmountCents = Number(metadata?.guide_amount_cents || 0);
  const chaletAmountCents = Number(metadata?.chalet_amount_cents || 0);

  // Resolve the source charge to fund the transfers (required for Connect transfers
  // when the PI was charged on the platform account).
  let sourceTransaction = (paymentIntent.latest_charge as string | undefined) || "";
  if (!sourceTransaction) {
    try {
      const fresh = await stripeRequest("GET", `/payment_intents/${paymentIntentId}`);
      sourceTransaction = (fresh.latest_charge as string | undefined) || "";
    } catch (err) {
      console.warn("[COMBINED] Could not resolve latest_charge:", err);
    }
  }

  // Confirm guide bookings
  if (guideBookingIds.length > 0) {
    for (const bId of guideBookingIds) {
      const { data: updated, error } = await supabase
        .from("guide_booking")
        .update({
          status: "confirmed",
          payment_status: "paid",
          is_paid: true,
          stripe_payment_intent_id: paymentIntentId,
        })
        .eq("id", bId)
        .select("id, status, guide_id, start_time, end_time, customer_name, customer_email, trip_type, notes, google_event_id")
        .single();

      if (error) {
        console.error(`[COMBINED] Failed to confirm guide booking ${bId}:`, JSON.stringify(error));
        continue;
      }
      console.log(`[COMBINED] ✅ Guide booking ${bId} confirmed`);

      // Calendar sync (fire-and-forget)
      if (updated && !updated.google_event_id) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/create-guide-booking-event`, {
            method: "POST",
            headers: { Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
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
        } catch (calErr) {
          console.warn(`[COMBINED] Calendar sync failed for ${bId}:`, calErr);
        }
      }

      // Confirmation email
      try {
        await fetch(`${supabaseUrl}/functions/v1/send-booking-confirmation`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId: bId, bookingType: "guide" }),
        });
      } catch (mailErr) {
        console.warn(`[COMBINED] Email send failed for guide booking ${bId}:`, mailErr);
      }
    }
  }

  // Confirm chalet booking
  if (chaletBookingId) {
    const { error } = await supabase
      .from("bookings")
      .update({
        status: "confirmed",
        payment_status: "paid",
        stripe_payment_intent_id: paymentIntentId,
      })
      .eq("id", chaletBookingId);

    if (error) {
      console.error(`[COMBINED] Failed to confirm chalet booking ${chaletBookingId}:`, JSON.stringify(error));
    } else {
      console.log(`[COMBINED] ✅ Chalet booking ${chaletBookingId} confirmed`);
      await supabase
        .from("booking_inventory_allocation")
        .update({
          status: "confirmed",
          payment_status: "paid",
          stripe_payment_intent_id: paymentIntentId,
        })
        .eq("chalet_booking_id", chaletBookingId)
        .in("status", ["pending", "pending_payment"]);
      try {
        await fetch(`${supabaseUrl}/functions/v1/send-booking-confirmation`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId: chaletBookingId, bookingType: "chalet" }),
        });
      } catch (mailErr) {
        console.warn(`[COMBINED] Email send failed for chalet booking ${chaletBookingId}:`, mailErr);
      }
    }
  }

  // ── Vendor transfers ────────────────────────────────────────────────────
  // Each transfer is funded by source_transaction (the charge on the PI).
  // Stripe's idempotency on transfers is per request, so we skip any vendor
  // that's already been transferred (defensive: webhook may replay).
  if (guideStripeAccount && guideAmountCents > 0) {
    try {
      await stripeRequest("POST", "/transfers", {
        amount: String(guideAmountCents),
        currency: "cad",
        destination: guideStripeAccount,
        ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
        metadata: {
          payment_intent: paymentIntentId,
          booking_type: "combined-guide-leg",
          guide_booking_ids: guideBookingIds.join(","),
        },
        description: `Monde Sauvage — paiement guide pour PI ${paymentIntentId}`,
      });
      console.log(`[COMBINED] ✅ Transferred ${guideAmountCents}¢ to guide account ${guideStripeAccount}`);
    } catch (err) {
      console.error(`[COMBINED] ❌ Guide transfer failed:`, err);
      // Mark bookings so ops can investigate without breaking the webhook.
      if (guideBookingIds.length > 0) {
        await supabase
          .from("guide_booking")
          .update({
            calendar_sync_failed: false,
            notes: `Paiement reçu, transfert guide en attente — PI ${paymentIntentId}`,
          })
          .in("id", guideBookingIds);
      }
    }
  }

  if (chaletStripeAccount && chaletAmountCents > 0) {
    try {
      await stripeRequest("POST", "/transfers", {
        amount: String(chaletAmountCents),
        currency: "cad",
        destination: chaletStripeAccount,
        ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
        metadata: {
          payment_intent: paymentIntentId,
          booking_type: "combined-chalet-leg",
          chalet_booking_id: chaletBookingId,
        },
        description: `Monde Sauvage — paiement chalet pour PI ${paymentIntentId}`,
      });
      console.log(`[COMBINED] ✅ Transferred ${chaletAmountCents}¢ to establishment account ${chaletStripeAccount}`);
    } catch (err) {
      console.error(`[COMBINED] ❌ Chalet transfer failed:`, err);
      if (chaletBookingId) {
        await supabase
          .from("bookings")
          .update({
            notes: `Paiement reçu, transfert établissement en attente — PI ${paymentIntentId}`,
          })
          .eq("id", chaletBookingId);
      }
    }
  }
}

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
        .select("key, quickbooks_connected, quickbooks_access_token, quickbooks_refresh_token, quickbooks_realm_id, quickbooks_access_token_expires_at, quickbooks_refresh_token_expires_at")
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

      const freshEstablishment = await ensureFreshQboToken(
        supabase,
        { id: vendor.key, ...vendor },
        "establishment"
      );
      const invoice = await createQuickbooksInvoice(freshEstablishment, amountDollars);
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
      .select("id, user_id, quickbooks_connected, quickbooks_access_token, quickbooks_refresh_token, quickbooks_realm_id, quickbooks_access_token_expires_at, quickbooks_refresh_token_expires_at");
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

    const freshGuide = await ensureFreshQboToken(supabase, vendor, "guide");
    const invoice = await createQuickbooksInvoice(freshGuide, amountDollars);
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

        if (bookingType === "combined") {
          await handleCombinedPaymentSuccess(
            supabase,
            dataObject,
            metadata,
            SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY,
          );
          // QuickBooks sync is intentionally skipped here — the combined flow
          // splits across two vendors and the QBO helper assumes a single
          // vendor per PI. Vendor invoicing can be hooked separately later.
          break;
        }

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
            .select("id, status, payment_status, chalet_id, start_date, end_date, customer_name, customer_email, notes, google_event_id")
            .single();

          if (error) {
            console.error(`❌ Failed to confirm chalet booking ${bookingId}:`, JSON.stringify(error));
          } else {
            console.log(`✅ Chalet booking ${bookingId} → status=${updated.status}, payment_status=${updated.payment_status}`);

            // Confirm linked equipment allocations (addons inventaire)
            const { error: biaErr, data: biaUpdated } = await supabase
              .from("booking_inventory_allocation")
              .update({
                status: "confirmed",
                payment_status: "paid",
                stripe_payment_intent_id: paymentIntentId,
              })
              .eq("chalet_booking_id", bookingId)
              .in("status", ["pending", "pending_payment"])
              .select("id");

            if (biaErr) {
              console.warn(
                `⚠️ booking_inventory_allocation confirm failed for chalet booking ${bookingId}:`,
                JSON.stringify(biaErr),
              );
            } else if (biaUpdated && biaUpdated.length > 0) {
              console.log(
                `✅ Confirmed ${biaUpdated.length} equipment allocation row(s) for booking ${bookingId}`,
              );

              // Sync inventory unit Google Calendars
              const allocationIds = biaUpdated.map((a: { id: string }) => a.id);
              const { data: allocsWithUnits } = await supabase
                .from("booking_inventory_allocation")
                .select("id, start_at, end_at, inventory_unit:inventory_unit_id(google_calendar_id, display_name, establishment_id)")
                .in("id", allocationIds);

              if (allocsWithUnits?.length) {
                const firstUnit = (allocsWithUnits[0] as any)?.inventory_unit;
                const estId = firstUnit?.establishment_id;

                if (estId) {
                  const tokenRes = await fetch(
                    `${SUPABASE_URL}/functions/v1/refresh-google-token?establishmentId=${encodeURIComponent(estId)}`,
                    { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } },
                  );
                  const tokenPayload = await tokenRes.json().catch(() => ({}));
                  const googleToken = tokenPayload?.access_token;

                  if (googleToken) {
                    for (const alloc of allocsWithUnits as any[]) {
                      const unit = alloc.inventory_unit;
                      if (!unit?.google_calendar_id) continue;

                      const startDay = String(alloc.start_at).slice(0, 10);
                      const endDay = String(alloc.end_at).slice(0, 10);

                      try {
                        const evRes = await fetch(
                          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(unit.google_calendar_id)}/events?sendUpdates=none`,
                          {
                            method: "POST",
                            headers: {
                              Authorization: `Bearer ${googleToken}`,
                              "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                              summary: `${unit.display_name} - ${updated.customer_name}`,
                              description: [
                                `Réservé : ${updated.customer_name}`,
                                updated.customer_email ? `Courriel : ${updated.customer_email}` : null,
                              ].filter(Boolean).join("\n"),
                              start: { date: startDay },
                              end: { date: endDay },
                              transparency: "opaque",
                              extendedProperties: {
                                private: { booking_id: String(bookingId), source: "monde_sauvage_website" },
                              },
                            }),
                          },
                        );
                        if (evRes.ok) {
                          const evData = await evRes.json();
                          console.log(`📅 Inventory calendar event created for unit "${unit.display_name}": ${evData.id}`);
                        } else {
                          console.warn(`⚠️ Inventory calendar event failed for unit "${unit.display_name}":`, await evRes.text());
                        }
                      } catch (evErr: any) {
                        console.warn(`⚠️ Inventory calendar event error for unit "${unit.display_name}":`, evErr.message);
                      }
                    }
                  }
                }
              }
            }

            // Send confirmation email (fire-and-forget)
            fireConfirmationEmail(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, bookingId, "chalet");

            // Sync to Google Calendar if not already done
            if (updated && !updated.google_event_id) {
              const { data: chalet } = await supabase
                .from("chalets")
                .select("google_calendar, Name")
                .eq("key", updated.chalet_id)
                .single();

              if (chalet?.google_calendar) {
                try {
                  const calRes = await fetch(`${SUPABASE_URL}/functions/v1/create-booking-calendar-event`, {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      booking_id: updated.id,
                      calendar_id: chalet.google_calendar,
                      chalet_name: chalet.Name,
                      start_date: updated.start_date,
                      end_date: updated.end_date,
                      customer_name: updated.customer_name,
                      customer_email: updated.customer_email,
                      notes: updated.notes,
                    }),
                  });
                  if (calRes.ok) {
                    const calData = await calRes.json();
                    console.log(`📅 Google Calendar event created for chalet booking ${bookingId}: ${calData.event_id}`);
                  } else {
                    const calErrText = await calRes.text();
                    console.warn(`⚠️ Google Calendar sync failed for chalet booking ${bookingId}:`, calErrText);
                  }
                } catch (calErr: any) {
                  console.warn(`⚠️ Google Calendar sync error for chalet booking ${bookingId}:`, calErr.message);
                }
              }
            }
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

        if (bookingType === "combined") {
          const guideBookingIds = (metadata?.guide_booking_ids || "").split(",").map((s) => s.trim()).filter(Boolean);
          const chaletBookingId = metadata?.chalet_booking_id || "";
          if (guideBookingIds.length > 0) {
            await supabase
              .from("guide_booking")
              .update({
                status: "cancelled",
                payment_status: "failed",
                is_paid: false,
                notes: `Payment failed: ${failureMessage || "Unknown error"}`,
              })
              .in("id", guideBookingIds);
          }
          if (chaletBookingId) {
            await supabase
              .from("bookings")
              .update({
                status: "cancelled",
                payment_status: "failed",
                notes: `Payment failed: ${failureMessage || "Unknown error"}`,
              })
              .eq("id", chaletBookingId);

            await supabase
              .from("booking_inventory_allocation")
              .update({
                status: "cancelled",
                payment_status: "failed",
              })
              .eq("chalet_booking_id", chaletBookingId)
              .in("status", ["pending", "pending_payment", "blocked"]);
          }
          console.log(`[COMBINED] ❌ Marked combined bookings as failed`);
          break;
        }

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

            await supabase
              .from("booking_inventory_allocation")
              .update({
                status: "cancelled",
                payment_status: "failed",
              })
              .eq("chalet_booking_id", bookingId)
              .in("status", ["pending", "pending_payment", "blocked"]);

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

              await supabase
                .from("booking_inventory_allocation")
                .update({
                  status: "confirmed",
                  payment_status: "paid",
                  stripe_payment_intent_id: piId || "",
                })
                .eq("chalet_booking_id", sessionBookingId)
                .in("status", ["pending", "pending_payment"]);

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
