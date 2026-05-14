// =============================================================================
// Edge Function: quickbooks-list-invoices
// =============================================================================
// Returns recent invoices from QuickBooks Online for the authenticated guide.
//
// Query params or body: { limit?: number } (default 20, max 50)
// Returns: { invoices: QboInvoice[] }
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import {
  ensureFreshQboToken,
  QuickbooksUser,
} from "../_shared/quickbooksUtils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function qboBase(): string {
  const env = Deno.env.get("QUICKBOOKS_ENV") || "sandbox";
  return env === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
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

    // Parse optional limit
    let limit = 20;
    try {
      const body = await req.json();
      if (body?.limit) limit = Math.min(Number(body.limit) || 20, 50);
    } catch { /* no body */ }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: guide, error: guideErr } = await admin
      .from("guide")
      .select("id, user_id, quickbooks_connected, quickbooks_access_token, quickbooks_refresh_token, quickbooks_realm_id, quickbooks_access_token_expires_at, quickbooks_refresh_token_expires_at")
      .eq("user_id", user.id)
      .single();

    if (guideErr || !guide) return json({ error: "Guide not found" }, 404);
    if (!guide.quickbooks_connected || !guide.quickbooks_access_token || !guide.quickbooks_realm_id) {
      return json({ error: "QuickBooks is not connected" }, 400);
    }

    let freshGuide: QuickbooksUser = guide as QuickbooksUser;
    try {
      freshGuide = await ensureFreshQboToken(admin, guide as QuickbooksUser, "guide");
    } catch (err) {
      return json({ error: `Token refresh failed: ${(err as Error).message}` }, 400);
    }

    // Query QBO for recent invoices
    const query = encodeURIComponent(
      `SELECT Id, DocNumber, TxnDate, DueDate, TotalAmt, Balance, CustomerRef, PrivateNote FROM Invoice ORDERBY MetaData.CreateTime DESC MAXRESULTS ${limit}`
    );
    const url = `${qboBase()}/v3/company/${freshGuide.quickbooks_realm_id}/query?query=${query}&minorversion=65`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${freshGuide.quickbooks_access_token}`,
        Accept: "application/json",
      },
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`QBO query failed (${res.status}): ${JSON.stringify(data)}`);
    }

    const rawInvoices: Record<string, unknown>[] = data?.QueryResponse?.Invoice || [];

    // Normalize for frontend consumption
    const invoices = rawInvoices.map((inv) => ({
      id: inv.Id as string,
      docNumber: inv.DocNumber as string,
      date: inv.TxnDate as string,
      dueDate: inv.DueDate as string,
      total: Number(inv.TotalAmt || 0),
      balance: Number(inv.Balance || 0),
      isPaid: Number(inv.Balance || 0) === 0,
      customerName: (inv.CustomerRef as { name?: string })?.name || "—",
      privateNote: inv.PrivateNote as string | undefined,
    }));

    return json({ invoices });
  } catch (err) {
    console.error("[quickbooks-list-invoices]", err);
    return json({ error: (err as Error).message || "Internal error" }, 500);
  }
});
