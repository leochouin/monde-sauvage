// =============================================================================
// Edge Function: quickbooks-sync-invoices
// =============================================================================
// Syncs paid guide bookings to QuickBooks Online invoices.
// Only processes bookings that haven't been synced yet (no quickbooks_invoice_id).
//
// Body: { guideId?: string }  (defaults to guide owned by authenticated user)
// Returns: { synced: number, skipped: number, errors: string[] }
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import {
  ensureFreshQboToken,
  findOrCreateQboCustomer,
  createQboInvoice,
  QuickbooksUser,
} from "../_shared/quickbooksUtils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Fetch the guide ──
    const { data: guide, error: guideErr } = await admin
      .from("guide")
      .select("id, user_id, quickbooks_connected, quickbooks_access_token, quickbooks_refresh_token, quickbooks_realm_id, quickbooks_access_token_expires_at, quickbooks_refresh_token_expires_at")
      .eq("user_id", user.id)
      .single();

    if (guideErr || !guide) return json({ error: "Guide not found" }, 404);
    if (!guide.quickbooks_connected || !guide.quickbooks_access_token || !guide.quickbooks_realm_id) {
      return json({ error: "QuickBooks is not connected" }, 400);
    }

    // ── Refresh token if needed ──
    let freshGuide: QuickbooksUser = guide as QuickbooksUser;
    try {
      freshGuide = await ensureFreshQboToken(admin, guide as QuickbooksUser, "guide");
    } catch (err) {
      return json({ error: `Token refresh failed: ${(err as Error).message}` }, 400);
    }

    // ── Fetch unsynced paid bookings ──
    const { data: bookings, error: bookErr } = await admin
      .from("guide_booking")
      .select("id, customer_name, customer_email, payment_amount, start_time, end_time, trip_type, number_of_people, created_at")
      .eq("guide_id", guide.id)
      .eq("is_paid", true)
      .is("quickbooks_invoice_id", null)
      .order("created_at", { ascending: false })
      .limit(50);

    if (bookErr) return json({ error: bookErr.message }, 500);
    if (!bookings || bookings.length === 0) {
      return json({ synced: 0, skipped: 0, errors: [], message: "No unsynced bookings found" });
    }

    let synced = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const booking of bookings) {
      try {
        if (!booking.payment_amount || booking.payment_amount <= 0) {
          skipped++;
          continue;
        }

        // Find or create QBO customer
        const customerRef = await findOrCreateQboCustomer(
          freshGuide,
          booking.customer_name || "Client",
          booking.customer_email || undefined
        );

        // Build description
        const startDate = booking.start_time
          ? new Date(booking.start_time).toLocaleDateString("fr-CA", { year: "numeric", month: "short", day: "numeric" })
          : "";
        const tripLabel = booking.trip_type ? ` — ${booking.trip_type}` : "";
        const peopleLabel = booking.number_of_people ? ` (${booking.number_of_people} personnes)` : "";
        const description = `Réservation de guide${tripLabel}${peopleLabel} — ${startDate}`.trim();

        const txnDate = booking.start_time
          ? new Date(booking.start_time).toISOString().split("T")[0]
          : new Date(booking.created_at).toISOString().split("T")[0];

        // Create the invoice
        const invoice = await createQboInvoice(freshGuide, {
          customerRef,
          amount: Number(booking.payment_amount),
          description,
          docNumber: booking.id.substring(0, 21),
          privateNote: `Monde Sauvage booking ID: ${booking.id}`,
          txnDate,
        });

        // Persist the invoice ID back to the booking
        await admin
          .from("guide_booking")
          .update({
            quickbooks_invoice_id: invoice.Id,
            quickbooks_invoice_synced_at: new Date().toISOString(),
          })
          .eq("id", booking.id);

        synced++;
        console.log(`[qb-sync] Synced booking ${booking.id} → QBO invoice ${invoice.Id}`);
      } catch (err) {
        console.error(`[qb-sync] Failed booking ${booking.id}:`, err);
        errors.push(`${booking.id}: ${(err as Error).message}`);
      }
    }

    return json({ synced, skipped, errors });
  } catch (err) {
    console.error("[quickbooks-sync-invoices]", err);
    return json({ error: (err as Error).message || "Internal error" }, 500);
  }
});
