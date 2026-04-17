// =============================================================================
// Edge Function: test-quickbooks
// =============================================================================
// Verifies a Guide's or Owner's QuickBooks connection by calling /companyinfo.
// Expects a Supabase user JWT in the Authorization header.
//
// Body / query (both POST and GET supported):
//   { entity?: "guide" | "establishment", establishmentId?: string }
// Defaults to "guide" + the guide row owned by the authenticated user.
// For "establishment", establishmentId is required (the caller must own it).
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { fetchQuickbooksCompanyInfo } from "../_shared/quickbooksUtils.ts";

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

type EntityKind = "guide" | "establishment";

async function readParams(req: Request): Promise<{ entity: EntityKind; establishmentId?: string }> {
  const url = new URL(req.url);
  let entity = (url.searchParams.get("entity") as EntityKind | null) || null;
  let establishmentId = url.searchParams.get("establishmentId") || null;

  if (req.method === "POST") {
    try {
      const body = await req.json();
      entity = (body?.entity as EntityKind | undefined) || entity;
      establishmentId = body?.establishmentId || establishmentId;
    } catch {
      // No body — fall back to query params
    }
  }

  return {
    entity: entity === "establishment" ? "establishment" : "guide",
    establishmentId: establishmentId || undefined,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    // Identify the caller via their JWT.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      console.error("[test-quickbooks] auth.getUser failed:", userErr);
      return json({ error: "Not authenticated" }, 401);
    }
    const userId = userRes.user.id;

    const { entity, establishmentId } = await readParams(req);
    console.log(`[test-quickbooks] user=${userId} entity=${entity} establishmentId=${establishmentId ?? "-"}`);

    // Service-role read to bypass RLS for the token fetch.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (entity === "establishment") {
      if (!establishmentId) {
        return json({ error: "establishmentId is required when entity=establishment" }, 400);
      }

      const { data: establishment, error: estErr } = await admin
        .from("Etablissement")
        .select(
          "key, owner_id, quickbooks_connected, quickbooks_access_token, quickbooks_realm_id"
        )
        .eq("key", establishmentId)
        .eq("owner_id", userId)
        .single();

      if (estErr || !establishment) {
        console.error("[test-quickbooks] establishment lookup failed:", estErr);
        return json({ error: "Establishment not found or you don't own it" }, 404);
      }

      if (
        !establishment.quickbooks_connected ||
        !establishment.quickbooks_access_token ||
        !establishment.quickbooks_realm_id
      ) {
        return json({ error: "QuickBooks is not connected for this establishment" }, 400);
      }

      const companyInfo = await fetchQuickbooksCompanyInfo({
        id: establishment.key,
        quickbooks_connected: establishment.quickbooks_connected,
        quickbooks_access_token: establishment.quickbooks_access_token,
        quickbooks_realm_id: establishment.quickbooks_realm_id,
      });
      return json({ ok: true, entity: "establishment", companyInfo });
    }

    // Default: guide
    const { data: guide, error: guideErr } = await admin
      .from("guide")
      .select("id, user_id, quickbooks_connected, quickbooks_access_token, quickbooks_realm_id")
      .eq("user_id", userId)
      .single();

    if (guideErr || !guide) {
      console.error("[test-quickbooks] guide lookup failed:", guideErr);
      return json({ error: "Guide not found" }, 404);
    }

    if (!guide.quickbooks_connected || !guide.quickbooks_access_token || !guide.quickbooks_realm_id) {
      return json({ error: "QuickBooks is not connected for this user" }, 400);
    }

    const companyInfo = await fetchQuickbooksCompanyInfo(guide);
    return json({ ok: true, entity: "guide", companyInfo });
  } catch (err) {
    console.error("[test-quickbooks] error:", err);
    return json({ error: (err as Error).message || "Internal error" }, 500);
  }
});
