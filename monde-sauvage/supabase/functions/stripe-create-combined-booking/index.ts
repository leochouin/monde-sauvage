// =============================================================================
// Edge Function: stripe-create-combined-booking
// =============================================================================
// Creates a single Stripe PaymentIntent that covers BOTH guide bookings and
// a chalet booking in one customer-facing charge.
//
// Architecture: "Separate Charges and Transfers" mode
//   - The PaymentIntent is created on the platform account (no transfer_data)
//   - Money lands on the platform account first
//   - The webhook (payment_intent.succeeded) creates two `Transfer` objects:
//       * one to the guide's connected account (subtotal of guide slots)
//       * one to the establishment's connected account (chalet subtotal)
//   - The platform retains the application-fee equivalent (10%)
//
// This gives the customer a single charge while still paying out to two
// independent vendors automatically.
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
import {
  BOOKING_ORIGIN_PLATFORM,
  calculatePlatformFeeAmount,
} from "../_shared/bookingRules.ts";

type SupabaseClientLike = ReturnType<typeof createClient<Record<string, unknown>>>;

const PENDING_EXPIRY_MINUTES = 30;

type ParsedInventoryAddonLine = {
  slug?: string;
  equipment_kind_id?: string;
  quantity: number;
};

type EquipmentKindRow = {
  id: string;
  slug: string;
  metadata: Record<string, unknown> | null;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeInventoryAddons(raw: unknown): ParsedInventoryAddonLine[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: ParsedInventoryAddonLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const quantity = typeof o.quantity === "number" ? Math.floor(o.quantity) : NaN;
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 50) continue;
    const slug = typeof o.slug === "string" && o.slug.trim().length > 0
      ? o.slug.trim()
      : undefined;
    const equipment_kind_id = typeof o.equipment_kind_id === "string" && o.equipment_kind_id.trim().length > 0
      ? o.equipment_kind_id.trim()
      : typeof o.equipmentKindId === "string" && o.equipmentKindId.trim().length > 0
      ? o.equipmentKindId.trim()
      : undefined;
    if (!slug && !equipment_kind_id) continue;
    out.push({ slug, equipment_kind_id, quantity });
    if (out.length >= 40) break;
  }
  return out;
}

function addonLineSubtotalFromMetadata(
  metadata: Record<string, unknown>,
  nights: number,
  quantity: number,
): number {
  const perStayRaw = metadata["addon_price_per_stay"];
  const perNightRaw = metadata["addon_price_per_night"];
  const perStay = typeof perStayRaw === "number" ? perStayRaw : Number(perStayRaw);
  if (!Number.isNaN(perStay) && perStay >= 0) {
    return roundMoney(perStay * quantity);
  }
  const perNight = typeof perNightRaw === "number" ? perNightRaw : Number(perNightRaw);
  const n = Math.max(1, nights);
  if (!Number.isNaN(perNight) && perNight >= 0) {
    return roundMoney(perNight * n * quantity);
  }
  return 0;
}

function computeInventoryAddonsSubtotal(
  kinds: EquipmentKindRow[],
  lines: ParsedInventoryAddonLine[],
  nights: number,
): number {
  if (lines.length === 0 || kinds.length === 0) return 0;
  const byId = new Map(kinds.map((k) => [k.id, k]));
  const bySlug = new Map(kinds.map((k) => [k.slug, k]));
  let sum = 0;
  for (const line of lines) {
    const kind =
      (line.equipment_kind_id ? byId.get(line.equipment_kind_id) : undefined) ??
      (line.slug ? bySlug.get(line.slug) : undefined);
    sum += addonLineSubtotalFromMetadata((kind?.metadata ?? {}) as Record<string, unknown>, nights, line.quantity);
  }
  return roundMoney(sum);
}

function inventoryRpcPayload(lines: ParsedInventoryAddonLine[]): Array<
  Record<string, string | number | undefined>
> {
  return lines.map((line) => {
    const base: Record<string, string | number | undefined> = { quantity: line.quantity };
    if (line.slug) base.slug = line.slug;
    if (line.equipment_kind_id) base.equipment_kind_id = line.equipment_kind_id;
    return base;
  });
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
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Optional auth — guests may also book
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }

    const body = await req.json() as CombinedBody;

    const {
      customerName,
      customerEmail,
      customerPhone,
      notes,
      guide,
      chalet,
    } = body;

    if (!customerName || !customerEmail) {
      return errorResponse("customerName and customerEmail are required");
    }
    if (!guide && !chalet) {
      return errorResponse("Provide at least one of: guide, chalet");
    }

    // ── Resolve guide subtotal & validate ──────────────────────────────────
    let guideSubtotal = 0;
    let guideTotalHours = 0;
    let guideRow: GuideRow | null = null;
    let guideSlots: Array<{ startTime: string; endTime: string }> = [];

    if (guide) {
      const slots = Array.isArray(guide.slots) && guide.slots.length > 0
        ? guide.slots
        : (guide.startTime && guide.endTime ? [{ startTime: guide.startTime, endTime: guide.endTime }] : []);

      if (slots.length === 0) {
        return errorResponse("guide booking requires slots or startTime/endTime");
      }

      const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
      for (const slot of slots) {
        if (!slot.startTime || !slot.endTime) {
          console.error(`❌ [DATE GUARD] Combined: missing time: ${JSON.stringify(slot)}`);
          return errorResponse("Each guide slot must have startTime and endTime");
        }
        if (DATE_ONLY_REGEX.test(slot.startTime) || DATE_ONLY_REGEX.test(slot.endTime)) {
          console.error(`❌ [DATE GUARD] Combined: date-only slot rejected: ${slot.startTime} → ${slot.endTime}`);
          return errorResponse(
            `Slot must include time-of-day, got date-only: ${slot.startTime} / ${slot.endTime}`,
            400,
          );
        }
        const s = new Date(slot.startTime);
        const e = new Date(slot.endTime);
        if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) {
          console.error(`❌ [DATE GUARD] Combined: invalid/zero-length slot: ${slot.startTime} → ${slot.endTime}`);
          return errorResponse(`Invalid guide slot: ${slot.startTime} → ${slot.endTime}`);
        }
        guideTotalHours += (e.getTime() - s.getTime()) / (1000 * 60 * 60);
      }

      const { data: g, error: gErr } = await supabase
        .from("guide")
        .select("id, name, email, hourly_rate, stripe_account_id, stripe_charges_enabled")
        .eq("id", guide.guideId)
        .single();

      if (gErr || !g) return errorResponse("Guide not found", 404);
      if (!g.stripe_account_id) {
        return errorResponse("Ce guide n'a pas encore configuré les paiements.", 422);
      }
      if (!g.stripe_charges_enabled) {
        return errorResponse("Le compte de paiement de ce guide n'est pas encore actif.", 422);
      }
      if (!g.hourly_rate || g.hourly_rate <= 0) {
        return errorResponse("Ce guide n'a pas défini de taux horaire.");
      }

      // Slot conflict pre-check
      for (const slot of slots) {
        const { data: overlapping } = await supabase
          .from("guide_booking")
          .select("id")
          .eq("guide_id", guide.guideId)
          .in("status", ["confirmed", "pending", "pending_payment", "booked"])
          .is("deleted_at", null)
          .lt("start_time", slot.endTime)
          .gt("end_time", slot.startTime);

        if (overlapping && overlapping.length > 0) {
          return errorResponse(
            "Ce créneau de guide vient d'être réservé. Veuillez choisir un autre horaire.",
            409,
          );
        }
      }

      guideSubtotal = Math.round(g.hourly_rate * guideTotalHours * 100) / 100;
      guideRow = g as GuideRow;
      guideSlots = slots;
    }

    // ── Resolve chalet subtotal & validate ─────────────────────────────────
    let chaletLodgingSubtotal = 0;
    let chaletInventorySubtotal = 0;
    let chaletVendorSubtotal = 0;
    let chaletNights = 0;
    let chaletPricePerNight = 0;
    let chaletBreakdown: Array<{ date: string; price: number; rule?: string }> = [];
    let chaletRow: ChaletRow | null = null;
    let establishmentRow: EstablishmentRow | null = null;
    let inventoryAddonLines: ParsedInventoryAddonLine[] = [];

    if (chalet) {
      if (!chalet.chaletId || !chalet.startDate || !chalet.endDate) {
        return errorResponse("chalet booking requires chaletId, startDate, endDate");
      }
      const cs = new Date(chalet.startDate);
      const ce = new Date(chalet.endDate);
      if (isNaN(cs.getTime()) || isNaN(ce.getTime()) || ce <= cs) {
        return errorResponse("Invalid chalet date range");
      }

      const { data: c, error: cErr } = await supabase
        .from("chalets")
        .select(`key, "Name", price_per_night, etablishment_id`)
        .eq("key", chalet.chaletId)
        .single();
      if (cErr || !c) return errorResponse("Chalet not found", 404);
      if (!c.price_per_night || c.price_per_night <= 0) {
        return errorResponse("Chalet has no price set.");
      }

      const { data: est, error: estErr } = await supabase
        .from("Etablissement")
        .select("key, stripe_account_id, stripe_charges_enabled, \"Name\"")
        .eq("key", c.etablishment_id)
        .single();
      if (estErr || !est) return errorResponse("Establishment not found", 404);
      if (!est.stripe_account_id) {
        return errorResponse("Cet établissement n'a pas encore configuré les paiements.", 422);
      }
      if (!est.stripe_charges_enabled) {
        return errorResponse("Le compte de paiement de cet établissement n'est pas encore actif.", 422);
      }

      // Overlap check
      const { data: overlapping } = await supabase
        .from("bookings")
        .select("id")
        .eq("chalet_id", chalet.chaletId)
        .in("status", ["confirmed", "pending"])
        .lt("start_date", chalet.endDate)
        .gt("end_date", chalet.startDate);
      if (overlapping && overlapping.length > 0) {
        return errorResponse("Le chalet n'est pas disponible pour ces dates.", 409);
      }

      const { data: pricingRules } = await supabase
        .from("pricing_rules")
        .select("*")
        .eq("chalet_id", chalet.chaletId)
        .eq("is_active", true);

      const pricing = calculateTotalPrice(
        c.price_per_night,
        chalet.startDate,
        chalet.endDate,
        pricingRules || [],
      );
      if (pricing.totalPrice <= 0) return errorResponse("Calculated chalet price is invalid");

      chaletLodgingSubtotal = pricing.totalPrice;
      chaletNights = pricing.nights;
      chaletPricePerNight = pricing.pricePerNight;
      chaletBreakdown = pricing.breakdown;
      establishmentRow = est as EstablishmentRow;
      chaletRow = c as ChaletRow;

      inventoryAddonLines = normalizeInventoryAddons(chalet.inventoryAddons);
      if (inventoryAddonLines.length > 0) {
        const { data: kindsData, error: kindsErr } = await supabase
          .from("equipment_kind")
          .select("id, slug, metadata")
          .eq("establishment_id", establishmentRow.key)
          .eq("is_active", true);
        if (kindsErr) {
          console.error("equipment_kind fetch error:", kindsErr);
          return errorResponse("Impossible de charger les types d'équipement.", 500);
        }
        const equipmentKindsForAddons = (kindsData || []) as EquipmentKindRow[];
        chaletInventorySubtotal = computeInventoryAddonsSubtotal(
          equipmentKindsForAddons,
          inventoryAddonLines,
          chaletNights,
        );
      }

      chaletVendorSubtotal = roundMoney(chaletLodgingSubtotal + chaletInventorySubtotal);
    }

    if (guideSubtotal === 0 && chaletVendorSubtotal === 0) {
      return errorResponse("Combined booking total is zero");
    }

    // ── Build pricing — one fee on the combined subtotal ───────────────────
    const combinedSubtotal = Math.round((guideSubtotal + chaletVendorSubtotal) * 100) / 100;
    const applicationFee = calculatePlatformFeeAmount(
      combinedSubtotal,
      { booking_origin: BOOKING_ORIGIN_PLATFORM },
      APPLICATION_FEE_PERCENT,
    );
    const totalPrice = Math.round((combinedSubtotal + applicationFee) * 100) / 100;
    const amountInCents = Math.round(totalPrice * 100);

    const pendingExpiresAt = new Date(Date.now() + PENDING_EXPIRY_MINUTES * 60 * 1000);

    // ── Insert guide booking row(s) ────────────────────────────────────────
    const guideBookingIds: string[] = [];
    if (guideRow && guide) {
      for (const slot of guideSlots) {
        const slotHours = (new Date(slot.endTime).getTime() - new Date(slot.startTime).getTime()) / (1000 * 60 * 60);
        const slotSubtotal = Math.round(guideRow.hourly_rate * slotHours * 100) / 100;

        const { data: row, error: insErr } = await supabase
          .from("guide_booking")
          .insert({
            guide_id: guideRow.id,
            start_time: slot.startTime,
            end_time: slot.endTime,
            status: "pending",
            payment_status: "processing",
            source: "website",
            booking_origin: BOOKING_ORIGIN_PLATFORM,
            customer_name: customerName,
            customer_email: customerEmail,
            customer_phone: customerPhone || null,
            trip_type: guide.tripType || null,
            number_of_people: guide.numberOfPeople || 1,
            notes: notes || null,
            is_paid: false,
            payment_amount: slotSubtotal,
            payment_link_expires_at: pendingExpiresAt.toISOString(),
          })
          .select("id")
          .single();

        if (insErr || !row) {
          // Rollback prior inserts in this batch
          for (const prev of guideBookingIds) {
            await supabase.from("guide_booking").delete().eq("id", prev);
          }
          const msg = insErr?.message || "guide booking insert failed";
          if (insErr?.code === "23P01" || /overlap|chevauche/i.test(msg)) {
            return errorResponse(
              "Ce créneau de guide vient d'être réservé. Veuillez choisir un autre horaire.",
              409,
            );
          }
          return errorResponse(`Failed to create guide booking: ${msg}`, 500);
        }

        guideBookingIds.push(row.id);
      }
    }

    // ── Insert chalet booking row ──────────────────────────────────────────
    let chaletBookingId: string | null = null;
    if (chaletRow && chalet) {
      const { data: row, error: insErr } = await supabase
        .from("bookings")
        .insert({
          chalet_id: chalet.chaletId,
          start_date: chalet.startDate,
          end_date: chalet.endDate,
          status: "pending",
          payment_status: "processing",
          source: "website",
          booking_origin: BOOKING_ORIGIN_PLATFORM,
          customer_name: customerName,
          customer_email: customerEmail,
          notes: notes || null,
          user_id: userId,
          total_price: chaletVendorSubtotal,
          nights: chaletNights,
          price_per_night: chaletPricePerNight,
        })
        .select("id")
        .single();

      if (insErr || !row) {
        for (const prev of guideBookingIds) {
          await supabase.from("guide_booking").delete().eq("id", prev);
        }
        return errorResponse(`Failed to create chalet booking: ${insErr?.message || "insert failed"}`, 500);
      }
      chaletBookingId = row.id;

      let inventoryAllocCount = 0;
      if (inventoryAddonLines.length > 0) {
        const { data: allocateResult, error: allocateError } = await supabase.rpc(
          "allocate_inventory_for_booking",
          {
            p_booking_id: row.id,
            p_lines: inventoryRpcPayload(inventoryAddonLines),
          },
        );
        if (allocateError) {
          console.error("allocate_inventory_for_booking error (combined):", allocateError);
          await supabase.from("bookings").delete().eq("id", chaletBookingId);
          chaletBookingId = null;
          for (const prev of guideBookingIds) {
            await supabase.from("guide_booking").delete().eq("id", prev);
          }
          const msg = allocateError.message || String(allocateError.code);
          if (/insufficient_inventory/i.test(msg || "")) {
            return errorResponse(
              "Stock d'équipement insuffisant pour ces dates. Réduisez les quantités ou choisissez d'autres créneaux.",
              409,
            );
          }
          return errorResponse(allocateError.message || "Allocation d'inventaire impossible", 500);
        }
        const cnt = (allocateResult as { count_allocations?: number })?.count_allocations;
        inventoryAllocCount =
          typeof cnt === "number" ? cnt : inventoryAddonLines.reduce((s, l) => s + l.quantity, 0);
        console.log(
          `📦 [COMBINED] Inventory allocated for chalet booking ${row.id}: ${inventoryAllocCount} row(s)`,
        );
      }
    }

    // ── Create the unified PaymentIntent on the PLATFORM account ────────────
    // No transfer_data — money lands on platform; webhook will split via
    // separate Transfer objects to each connected account.
    const guideAmountCents = Math.round(guideSubtotal * 100);
    const chaletAmountCents = Math.round(chaletVendorSubtotal * 100);

    const description = [
      guideRow ? `Guide: ${guideRow.name || "Guide"} (${guideTotalHours.toFixed(1)}h)` : null,
      chaletRow ? `Chalet: ${chaletRow.Name || "Chalet"} (${chaletNights} nuit${chaletNights > 1 ? "s" : ""})` : null,
    ].filter(Boolean).join(" + ");

    const paymentIntent = await stripeRequest("POST", "/payment_intents", {
      amount: String(amountInCents),
      currency: "cad",
      payment_method_types: ["card"],
      metadata: (() => {
        const md: Record<string, string> = {
          booking_type: "combined",
          booking_id: guideBookingIds[0] || chaletBookingId || "",
          guide_booking_ids: guideBookingIds.join(","),
          chalet_booking_id: chaletBookingId || "",
          guide_stripe_account: guideRow?.stripe_account_id || "",
          chalet_stripe_account: establishmentRow?.stripe_account_id || "",
          guide_amount_cents: String(guideAmountCents),
          chalet_amount_cents: String(chaletAmountCents),
          application_fee_amount_cents: String(Math.round(applicationFee * 100)),
          guide_id: guideRow?.id || "",
          establishment_id: establishmentRow?.key || "",
          customer_name: customerName,
          customer_email: customerEmail,
          booking_origin: BOOKING_ORIGIN_PLATFORM,
        };
        if (chaletInventorySubtotal > 0) {
          md.inventory_subtotal_cad = String(chaletInventorySubtotal);
        }
        return md;
      })(),
      receipt_email: customerEmail,
      description: description || "Réservation Monde Sauvage",
    });

    // Link PaymentIntent to all rows
    if (guideBookingIds.length > 0) {
      await supabase
        .from("guide_booking")
        .update({ stripe_payment_intent_id: paymentIntent.id })
        .in("id", guideBookingIds);
    }
    if (chaletBookingId) {
      await supabase
        .from("bookings")
        .update({ stripe_payment_intent_id: paymentIntent.id })
        .eq("id", chaletBookingId);

      if (inventoryAddonLines.length > 0) {
        await supabase
          .from("booking_inventory_allocation")
          .update({ stripe_payment_intent_id: paymentIntent.id as string })
          .eq("chalet_booking_id", chaletBookingId)
          .in("status", ["pending"]);
      }
    }

    return jsonResponse({
      bookingType: "combined",
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      // No connected-account routing on the client — the PI lives on the platform.
      stripeAccountId: null,
      guideBookingIds,
      chaletBookingId,
      expiresAt: pendingExpiresAt.toISOString(),
      pricing: {
        guideSubtotal,
        guideHours: Math.round(guideTotalHours * 10) / 10,
        chaletLodgingSubtotal,
        chaletInventorySubtotal,
        /** Hébergement + équipements (vers l'établissement, hors frais plateforme globaux) */
        chaletVendorSubtotal,
        /** @deprecated utiliser chaletVendorSubtotal — même valeur (hébergement + équipements) */
        chaletSubtotal: chaletVendorSubtotal,
        chaletNights,
        chaletPricePerNight,
        chaletBreakdown,
        combinedSubtotal,
        applicationFee,
        total: totalPrice,
      },
    });
  } catch (error) {
    console.error("stripe-create-combined-booking error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message || "Internal server error", 500);
  }
});

// ── Types ────────────────────────────────────────────────────────────────────
type CombinedBody = {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  notes?: string;
  guide?: {
    guideId: string;
    startTime?: string;
    endTime?: string;
    slots?: Array<{ startTime: string; endTime: string }>;
    tripType?: string;
    numberOfPeople?: number;
  };
  chalet?: {
    chaletId: string;
    startDate: string;
    endDate: string;
    inventoryAddons?: unknown;
  };
};

type GuideRow = {
  id: string;
  name: string | null;
  email: string | null;
  hourly_rate: number;
  stripe_account_id: string;
  stripe_charges_enabled: boolean;
};

type ChaletRow = {
  key: string;
  Name: string | null;
  price_per_night: number;
  etablishment_id: string;
};

type EstablishmentRow = {
  key: string;
  stripe_account_id: string;
  stripe_charges_enabled: boolean;
  Name: string | null;
};
