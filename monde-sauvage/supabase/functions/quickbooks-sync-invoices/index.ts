// =============================================================================
// Edge Function: quickbooks-sync-invoices
// =============================================================================
// Syncs paid bookings to QuickBooks Online invoices for either a guide or an
// establishment (Hébergement / Pourvoirie). Only processes bookings that
// haven't been synced yet (no quickbooks_invoice_id).
//
// Body: { entity?: "guide" | "establishment", establishmentId?: string }
//   - "guide" (default): syncs guide_booking rows for the caller's guide
//   - "establishment": syncs chalet `bookings` for the given establishment
//     (the caller must own it)
// Returns: { synced: number, skipped: number, errors: string[] }
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import {
  findOrCreateQboCustomer,
  createQboInvoice,
  resolveQboEntity,
  QboEntityError,
  QboEntityKind,
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

function fmtDate(value: string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("fr-CA", { year: "numeric", month: "short", day: "numeric" });
}

function txnDateFor(primary: string | null | undefined, fallback: string | null | undefined): string {
  const src = primary || fallback;
  return src ? new Date(src).toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
}

type SyncTotals = { synced: number; skipped: number; errors: string[] };

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
    const entity: QboEntityKind = body?.entity === "establishment" ? "establishment" : "guide";
    const establishmentId: string | undefined = body?.establishmentId || undefined;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Resolve the connected vendor (guide or establishment) ──
    let resolved;
    try {
      resolved = await resolveQboEntity(admin, user.id, entity, establishmentId);
    } catch (err) {
      if (err instanceof QboEntityError) return json({ error: err.message }, err.status);
      return json({ error: `Token refresh failed: ${(err as Error).message}` }, 400);
    }
    const { user: vendor, entityId } = resolved;

    const totals: SyncTotals =
      entity === "establishment"
        ? await syncEstablishmentBookings(admin, vendor, entityId)
        : await syncGuideBookings(admin, vendor, entityId);

    return json(totals);
  } catch (err) {
    console.error("[quickbooks-sync-invoices]", err);
    return json({ error: (err as Error).message || "Internal error" }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Guide bookings → QBO invoices
// ─────────────────────────────────────────────────────────────────────────────
async function syncGuideBookings(
  admin: ReturnType<typeof createClient>,
  vendor: Parameters<typeof createQboInvoice>[0],
  guideId: string,
): Promise<SyncTotals> {
  const { data: bookings, error } = await admin
    .from("guide_booking")
    .select("id, customer_name, customer_email, payment_amount, start_time, end_time, trip_type, number_of_people, created_at")
    .eq("guide_id", guideId)
    .eq("is_paid", true)
    .is("quickbooks_invoice_id", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return { synced: 0, skipped: 0, errors: [error.message] };
  if (!bookings || bookings.length === 0) return { synced: 0, skipped: 0, errors: [] };

  let synced = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const booking of bookings) {
    try {
      const amount = Number(booking.payment_amount);
      if (!amount || amount <= 0) { skipped++; continue; }

      const customerRef = await findOrCreateQboCustomer(
        vendor,
        booking.customer_name || "Client",
        booking.customer_email || undefined,
      );

      const tripLabel = booking.trip_type ? ` — ${booking.trip_type}` : "";
      const peopleLabel = booking.number_of_people ? ` (${booking.number_of_people} personnes)` : "";
      const description = `Réservation de guide${tripLabel}${peopleLabel} — ${fmtDate(booking.start_time)}`.trim();

      const invoice = await createQboInvoice(vendor, {
        customerRef,
        amount,
        description,
        docNumber: String(booking.id).substring(0, 21),
        privateNote: `Monde Sauvage booking ID: ${booking.id}`,
        txnDate: txnDateFor(booking.start_time, booking.created_at),
      });

      await admin
        .from("guide_booking")
        .update({
          quickbooks_invoice_id: invoice.Id,
          quickbooks_invoice_synced_at: new Date().toISOString(),
        })
        .eq("id", booking.id);

      synced++;
      console.log(`[qb-sync] Synced guide booking ${booking.id} → QBO invoice ${invoice.Id}`);
    } catch (err) {
      console.error(`[qb-sync] Failed guide booking ${booking.id}:`, err);
      errors.push(`${booking.id}: ${(err as Error).message}`);
    }
  }

  return { synced, skipped, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Establishment chalet bookings → QBO invoices
// ─────────────────────────────────────────────────────────────────────────────
async function syncEstablishmentBookings(
  admin: ReturnType<typeof createClient>,
  vendor: Parameters<typeof createQboInvoice>[0],
  establishmentKey: string,
): Promise<SyncTotals> {
  // Chalets belonging to this establishment.
  const { data: chalets, error: chaletErr } = await admin
    .from("chalets")
    .select(`key, "Name"`)
    .eq("etablishment_id", establishmentKey);

  if (chaletErr) return { synced: 0, skipped: 0, errors: [chaletErr.message] };
  if (!chalets || chalets.length === 0) return { synced: 0, skipped: 0, errors: [] };

  const chaletNames = new Map<string, string>(
    chalets.map((c) => [c.key as string, (c.Name as string) || "Chalet"]),
  );
  const chaletIds = chalets.map((c) => c.key as string);

  const { data: bookings, error: bookErr } = await admin
    .from("bookings")
    .select("id, chalet_id, customer_name, customer_email, total_price, start_date, end_date, nights, created_at")
    .in("chalet_id", chaletIds)
    .eq("payment_status", "paid")
    .is("quickbooks_invoice_id", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (bookErr) return { synced: 0, skipped: 0, errors: [bookErr.message] };
  if (!bookings || bookings.length === 0) return { synced: 0, skipped: 0, errors: [] };

  let synced = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const booking of bookings) {
    try {
      const amount = Number(booking.total_price);
      if (!amount || amount <= 0) { skipped++; continue; }

      const customerRef = await findOrCreateQboCustomer(
        vendor,
        booking.customer_name || "Client",
        booking.customer_email || undefined,
      );

      const chaletName = chaletNames.get(booking.chalet_id as string) || "Chalet";
      const nights = Number(booking.nights) || 0;
      const nightsLabel = nights > 0 ? ` (${nights} nuit${nights > 1 ? "s" : ""})` : "";
      const rangeLabel = booking.start_date
        ? ` — ${fmtDate(booking.start_date)}${booking.end_date ? ` au ${fmtDate(booking.end_date)}` : ""}`
        : "";
      const description = `Séjour chalet — ${chaletName}${nightsLabel}${rangeLabel}`.trim();

      const invoice = await createQboInvoice(vendor, {
        customerRef,
        amount,
        description,
        docNumber: String(booking.id).substring(0, 21),
        privateNote: `Monde Sauvage booking ID: ${booking.id}`,
        txnDate: txnDateFor(booking.start_date, booking.created_at),
      });

      await admin
        .from("bookings")
        .update({
          quickbooks_invoice_id: invoice.Id,
          quickbooks_invoice_synced_at: new Date().toISOString(),
        })
        .eq("id", booking.id);

      synced++;
      console.log(`[qb-sync] Synced chalet booking ${booking.id} → QBO invoice ${invoice.Id}`);
    } catch (err) {
      console.error(`[qb-sync] Failed chalet booking ${booking.id}:`, err);
      errors.push(`${booking.id}: ${(err as Error).message}`);
    }
  }

  return { synced, skipped, errors };
}
