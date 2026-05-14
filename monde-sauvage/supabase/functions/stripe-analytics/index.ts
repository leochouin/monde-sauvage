// =============================================================================
// Edge Function: stripe-analytics
// =============================================================================
// Returns aggregated Stripe payment data for a connected establishment account.
// Requires an authenticated Supabase user who owns the establishment.
//
// Body: { establishmentId: string, period: "7d" | "30d" | "custom", from?: string, to?: string }
// Returns revenue totals, transaction count, payout info, and a daily timeline.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import {
  stripeRequest,
  corsHeaders,
  errorResponse,
  jsonResponse,
} from "../_shared/stripeUtils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Unauthorized", 401);

    // Verify caller identity
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return errorResponse("Unauthorized", 401);

    const body = await req.json();
    const { establishmentId, period = "30d", from, to } = body as {
      establishmentId?: string;
      period?: "7d" | "30d" | "custom";
      from?: string;
      to?: string;
    };

    if (!establishmentId) return errorResponse("establishmentId is required");

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch establishment and verify ownership.
    // Query by `key` first (string PK), then fall back to `id` (UUID) if needed.
    const cols = "key, stripe_account_id, stripe_charges_enabled, stripe_onboarding_complete, Name";
    let establishment: Record<string, unknown> | null = null;

    const byKey = await admin
      .from("Etablissement")
      .select(cols)
      .eq("key", establishmentId)
      .eq("owner_id", user.id)
      .maybeSingle();

    if (byKey.data) {
      establishment = byKey.data as Record<string, unknown>;
    } else {
      // Only try `id` column if the value looks like a UUID
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(establishmentId);
      if (isUuid) {
        const byId = await admin
          .from("Etablissement")
          .select(cols)
          .eq("id", establishmentId)
          .eq("owner_id", user.id)
          .maybeSingle();
        if (byId.data) establishment = byId.data as Record<string, unknown>;
      }
    }

    if (!establishment) {
      return errorResponse("Establishment not found or unauthorized", 404);
    }

    if (!establishment.stripe_account_id) {
      return jsonResponse({ connected: false, reason: "no_stripe_account" });
    }
    if (!establishment.stripe_onboarding_complete) {
      return jsonResponse({ connected: false, reason: "onboarding_incomplete" });
    }

    const stripeAccountId = establishment.stripe_account_id as string;

    // Build unix timestamp range
    const now = Math.floor(Date.now() / 1000);
    let createdGte: number;
    let createdLte: number = now;

    if (period === "7d") {
      createdGte = now - 7 * 86400;
    } else if (period === "custom" && from && to) {
      createdGte = Math.floor(new Date(from).getTime() / 1000);
      createdLte = Math.floor(new Date(to).getTime() / 1000);
    } else {
      // default: 30d
      createdGte = now - 30 * 86400;
    }

    // ── Fetch balance transactions (type=payment → inbound from customers) ──
    let balanceTransactions: Record<string, unknown>[] = [];
    let startingAfter: string | undefined;

    for (let page = 0; page < 10; page++) {
      let query = `type=payment&created[gte]=${createdGte}&created[lte]=${createdLte}&limit=100`;
      if (startingAfter) query += `&starting_after=${startingAfter}`;

      const btData = await stripeRequest("GET", `/balance_transactions?${query}`, undefined, stripeAccountId);
      const items = (btData.data as Record<string, unknown>[]) || [];
      balanceTransactions = [...balanceTransactions, ...items];

      if (!btData.has_more || items.length === 0) break;
      startingAfter = items[items.length - 1].id as string;
    }

    // ── Fetch payouts ──
    const payoutsData = await stripeRequest(
      "GET",
      `/payouts?created[gte]=${createdGte}&created[lte]=${createdLte}&limit=20`,
      undefined,
      stripeAccountId
    );
    const payouts = (payoutsData.data as Record<string, unknown>[]) || [];

    // ── Fetch current balance ──
    let availableBalance = 0;
    let pendingBalance = 0;
    try {
      const balance = await stripeRequest("GET", "/balance", undefined, stripeAccountId);
      availableBalance = ((balance.available as { amount: number }[])?.[0]?.amount || 0);
      pendingBalance = ((balance.pending as { amount: number }[])?.[0]?.amount || 0);
    } catch {
      // Non-fatal
    }

    // ── Aggregate metrics ──
    const totalRevenueCents = balanceTransactions.reduce((s, bt) => s + ((bt.amount as number) || 0), 0);
    const totalNetCents = balanceTransactions.reduce((s, bt) => s + ((bt.net as number) || 0), 0);
    const transactionCount = balanceTransactions.length;
    const avgTransactionCents = transactionCount > 0 ? Math.round(totalRevenueCents / transactionCount) : 0;

    const payoutsSentCents = payouts
      .filter((p) => p.status === "paid")
      .reduce((s, p) => s + ((p.amount as number) || 0), 0);
    const payoutsPendingCents = payouts
      .filter((p) => ["pending", "in_transit"].includes(p.status as string))
      .reduce((s, p) => s + ((p.amount as number) || 0), 0);

    // ── Build daily revenue timeline ──
    const dayBuckets: Record<string, number> = {};
    for (const bt of balanceTransactions) {
      const date = new Date((bt.created as number) * 1000).toISOString().split("T")[0];
      dayBuckets[date] = (dayBuckets[date] || 0) + ((bt.amount as number) || 0);
    }

    const timeline = Object.entries(dayBuckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amountCents]) => ({
        date,
        amount: amountCents / 100,
        label: new Date(date + "T12:00:00Z").toLocaleDateString("fr-CA", {
          month: "short",
          day: "numeric",
        }),
      }));

    return jsonResponse({
      connected: true,
      period,
      totalRevenue: totalRevenueCents / 100,
      totalNet: totalNetCents / 100,
      transactionCount,
      avgTransaction: avgTransactionCents / 100,
      payoutsSent: payoutsSentCents / 100,
      payoutsPending: payoutsPendingCents / 100,
      availableBalance: availableBalance / 100,
      pendingBalance: pendingBalance / 100,
      timeline,
      currency: "cad",
    });
  } catch (err) {
    console.error("[stripe-analytics]", err);
    return errorResponse((err as Error).message || "Internal error", 500);
  }
});
