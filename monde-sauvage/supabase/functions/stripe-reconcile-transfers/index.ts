// =============================================================================
// Edge Function: stripe-reconcile-transfers
// =============================================================================
// Replays Stripe Connect transfers that failed during a combined-booking
// payment (see stripe-webhook → handleCombinedPaymentSuccess). Each combined
// PaymentIntent is charged on the platform and fans out one transfer per vendor
// (guide + establishment); if a transfer throws, the booking row is marked
// transfer_status='failed'. This function finds those rows and re-attempts the
// transfer, reusing the exact amounts/destinations stored in PI metadata and an
// Idempotency-Key so a replay can never double-pay.
//
// Modes:
//   - Vendor (default): authenticated guide or establishment owner; only their
//     own leg of each PI is retried.
//       Body: { entity?: "guide" | "establishment", establishmentId?: string }
//   - Sweep: called with the service-role key as the bearer token (e.g. a cron);
//     retries every failed leg across all vendors.
//       Body: { sweep: true }
//
// Returns: { retried, succeeded, failed, errors: string[] }
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { stripeRequest, corsHeaders, errorResponse, jsonResponse } from "../_shared/stripeUtils.ts";

type Leg = "guide" | "chalet";

interface PiPlan {
  retryGuide: boolean;
  retryChalet: boolean;
  guideBookingIds: Set<string>;
  chaletBookingIds: Set<string>;
}

interface Result {
  retried: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace("Bearer ", "").trim();
    if (!bearer) return errorResponse("Unauthorized", 401);

    const body = await req.json().catch(() => ({}));
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Sweep mode: service-role caller retries every failed leg ──
    const isSweep = bearer === SUPABASE_SERVICE_ROLE_KEY && body?.sweep === true;

    const plans = new Map<string, PiPlan>();
    const ensurePlan = (pi: string): PiPlan => {
      let p = plans.get(pi);
      if (!p) {
        p = { retryGuide: false, retryChalet: false, guideBookingIds: new Set(), chaletBookingIds: new Set() };
        plans.set(pi, p);
      }
      return p;
    };

    if (isSweep) {
      await collectFailedGuideLegs(admin, plans, ensurePlan, null);
      await collectFailedChaletLegs(admin, plans, ensurePlan, null);
    } else {
      // Vendor mode — identify the caller and scope to their own leg.
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authErr } = await userClient.auth.getUser();
      if (authErr || !user) return errorResponse("Unauthorized", 401);

      const entity = body?.entity === "establishment" ? "establishment" : "guide";

      if (entity === "establishment") {
        const establishmentId = body?.establishmentId;
        if (!establishmentId) return errorResponse("establishmentId is required", 400);

        const { data: est, error: estErr } = await admin
          .from("Etablissement")
          .select("key, owner_id")
          .eq("key", establishmentId)
          .eq("owner_id", user.id)
          .single();
        if (estErr || !est) return errorResponse("Establishment not found or you don't own it", 404);

        const { data: chalets } = await admin
          .from("chalets")
          .select("key")
          .eq("etablishment_id", establishmentId);
        const chaletIds = (chalets || []).map((c) => c.key as string);
        if (chaletIds.length === 0) return jsonResponse({ retried: 0, succeeded: 0, failed: 0, errors: [] });

        await collectFailedChaletLegs(admin, plans, ensurePlan, chaletIds);
      } else {
        const { data: guide, error: guideErr } = await admin
          .from("guide")
          .select("id, user_id")
          .eq("user_id", user.id)
          .single();
        if (guideErr || !guide) return errorResponse("Guide not found", 404);

        await collectFailedGuideLegs(admin, plans, ensurePlan, guide.id as string);
      }
    }

    if (plans.size === 0) {
      return jsonResponse({ retried: 0, succeeded: 0, failed: 0, errors: [] });
    }

    const result: Result = { retried: 0, succeeded: 0, failed: 0, errors: [] };

    for (const [piId, plan] of plans) {
      // Re-fetch the PI to get fresh metadata + the charge that funds transfers.
      let pi: Record<string, unknown>;
      try {
        pi = await stripeRequest("GET", `/payment_intents/${piId}`);
      } catch (err) {
        result.errors.push(`${piId}: PI lookup failed — ${(err as Error).message}`);
        continue;
      }
      const metadata = (pi.metadata as Record<string, string>) || {};
      const sourceTransaction = (pi.latest_charge as string | undefined) || "";

      if (plan.retryGuide) {
        result.retried++;
        await retryLeg(admin, result, "guide", piId, metadata, sourceTransaction, plan.guideBookingIds);
      }
      if (plan.retryChalet) {
        result.retried++;
        await retryLeg(admin, result, "chalet", piId, metadata, sourceTransaction, plan.chaletBookingIds);
      }
    }

    return jsonResponse(result);
  } catch (error) {
    console.error("stripe-reconcile-transfers error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message || "Internal server error", 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Collectors — build the per-PI retry plan from failed booking rows
// ─────────────────────────────────────────────────────────────────────────────
async function collectFailedGuideLegs(
  admin: ReturnType<typeof createClient>,
  _plans: Map<string, PiPlan>,
  ensurePlan: (pi: string) => PiPlan,
  guideId: string | null,
): Promise<void> {
  let q = admin
    .from("guide_booking")
    .select("id, stripe_payment_intent_id")
    .eq("transfer_status", "failed")
    .not("stripe_payment_intent_id", "is", null);
  if (guideId) q = q.eq("guide_id", guideId);

  const { data, error } = await q;
  if (error || !data) return;
  for (const row of data) {
    const pi = row.stripe_payment_intent_id as string;
    if (!pi) continue;
    const plan = ensurePlan(pi);
    plan.retryGuide = true;
    plan.guideBookingIds.add(row.id as string);
  }
}

async function collectFailedChaletLegs(
  admin: ReturnType<typeof createClient>,
  _plans: Map<string, PiPlan>,
  ensurePlan: (pi: string) => PiPlan,
  chaletIds: string[] | null,
): Promise<void> {
  let q = admin
    .from("bookings")
    .select("id, stripe_payment_intent_id")
    .eq("transfer_status", "failed")
    .not("stripe_payment_intent_id", "is", null);
  if (chaletIds) q = q.in("chalet_id", chaletIds);

  const { data, error } = await q;
  if (error || !data) return;
  for (const row of data) {
    const pi = row.stripe_payment_intent_id as string;
    if (!pi) continue;
    const plan = ensurePlan(pi);
    plan.retryChalet = true;
    plan.chaletBookingIds.add(row.id as string);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry a single leg (guide or chalet) of a combined PI
// ─────────────────────────────────────────────────────────────────────────────
async function retryLeg(
  admin: ReturnType<typeof createClient>,
  result: Result,
  leg: Leg,
  piId: string,
  metadata: Record<string, string>,
  sourceTransaction: string,
  bookingIds: Set<string>,
): Promise<void> {
  const table = leg === "guide" ? "guide_booking" : "bookings";
  const ids = [...bookingIds];

  const destination = metadata[leg === "guide" ? "guide_stripe_account" : "chalet_stripe_account"] || "";
  const amountCents = Number(metadata[leg === "guide" ? "guide_amount_cents" : "chalet_amount_cents"] || 0);

  if (!destination || !amountCents || amountCents <= 0) {
    result.failed++;
    result.errors.push(`${piId} (${leg}): missing destination/amount in PI metadata`);
    return;
  }

  try {
    const transfer = await stripeRequest(
      "POST",
      "/transfers",
      {
        amount: String(amountCents),
        currency: "cad",
        destination,
        ...(sourceTransaction ? { source_transaction: sourceTransaction } : {}),
        metadata: {
          payment_intent: piId,
          booking_type: `combined-${leg}-leg`,
          reconciled: "true",
        },
        description: `Monde Sauvage — re-transfert ${leg} pour PI ${piId}`,
      },
      undefined,
      // Stable key so repeated reconciliations never create a second transfer.
      `transfer-retry-${leg}-${piId}`,
    );

    await admin
      .from(table)
      .update({
        transfer_status: "paid",
        stripe_transfer_id: (transfer?.id as string) || null,
        transfer_failed_at: null,
        transfer_error: null,
      })
      .in("id", ids);

    result.succeeded++;
    console.log(`[reconcile] ✅ ${leg} transfer replayed for PI ${piId} → ${transfer?.id}`);
  } catch (err) {
    result.failed++;
    const msg = (err as Error).message || "transfer failed";
    result.errors.push(`${piId} (${leg}): ${msg}`);
    await admin
      .from(table)
      .update({
        transfer_failed_at: new Date().toISOString(),
        transfer_error: msg.substring(0, 500),
      })
      .in("id", ids);
    console.error(`[reconcile] ❌ ${leg} transfer retry failed for PI ${piId}:`, err);
  }
}
