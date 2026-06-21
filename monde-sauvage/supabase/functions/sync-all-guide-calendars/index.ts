// Supabase Edge Function: sync-all-guide-calendars
//
// PURPOSE:
// Background batch job that runs the bidirectional Google Calendar sync for
// EVERY connected guide. Designed to be called by a cron scheduler
// (Supabase pg_cron — see 20260621120000_schedule_calendar_auto_sync.sql).
//
// BEHAVIOR:
// 1. Fetches all guides with a refresh token and calendar_connection_status = 'connected'
// 2. For each guide, invokes the existing sync-guide-calendar function (guide_id)
// 3. On success, stamps guide.calendar_last_auto_synced_at = now()
// 4. Returns a summary report
//
// SCHEDULE RECOMMENDATION:
// Every 15 minutes — bidirectional sync is idempotent and safe to repeat.
//
// SAFETY:
// - Rate-limited (delay between guides) to avoid hitting Google API quotas
// - Processes guides sequentially
// - Skips disconnected guides (they need manual re-auth)
// - Idempotent — safe to run multiple times

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DELAY_BETWEEN_SYNCS_MS = 1500; // 1.5s between guides to avoid rate limits

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  console.log("🔁 [AUTO-SYNC] Starting batch calendar sync for all guides...");
  const startTime = Date.now();

  const SUPABASE_URL = Deno.env.get("URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── 1. Fetch all connected guides ──────────────────────────
  const { data: guides, error: fetchError } = await supabase
    .from("guide")
    .select("id, name, calendar_connection_status")
    .not("google_refresh_token", "is", null)
    .eq("calendar_connection_status", "connected");

  if (fetchError) {
    console.error("❌ [AUTO-SYNC] Failed to fetch guides:", fetchError);
    return jsonResponse({ error: "Failed to fetch guides" }, 500);
  }

  console.log(`🔁 [AUTO-SYNC] Found ${guides?.length || 0} connected guide(s)`);

  if (!guides || guides.length === 0) {
    return jsonResponse({
      message: "No connected guides to sync",
      synced: 0,
      failed: 0,
      duration_ms: Date.now() - startTime,
    });
  }

  // ── 2. Sync each guide via sync-guide-calendar ─────────────
  const report = {
    total: guides.length,
    synced: 0,
    failed: 0,
    errors: [] as string[],
    details: [] as { id: string; name: string; status: string; error?: string }[],
  };

  for (let i = 0; i < guides.length; i++) {
    const guide = guides[i];

    try {
      console.log(`🔄 [AUTO-SYNC] Syncing guide ${guide.name} (${guide.id})...`);

      const syncUrl = `${SUPABASE_URL}/functions/v1/sync-guide-calendar`;
      const syncRes = await fetch(syncUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ guide_id: guide.id }),
      });

      if (syncRes.ok) {
        report.synced++;
        report.details.push({ id: guide.id, name: guide.name, status: "synced" });

        // Stamp last auto-sync time for UI display
        await supabase
          .from("guide")
          .update({ calendar_last_auto_synced_at: new Date().toISOString() })
          .eq("id", guide.id);

        console.log(`✅ [AUTO-SYNC] Guide ${guide.name}: synced`);
      } else {
        const errorData = await syncRes.json().catch(() => ({}));
        const errMsg = errorData.error || `HTTP ${syncRes.status}`;
        report.failed++;
        report.errors.push(`${guide.name}: ${errMsg}`);
        report.details.push({
          id: guide.id,
          name: guide.name,
          status: "failed",
          error: errMsg,
        });
        console.error(`❌ [AUTO-SYNC] Guide ${guide.name}: ${errMsg}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report.failed++;
      report.errors.push(`${guide.name}: ${msg}`);
      report.details.push({
        id: guide.id,
        name: guide.name,
        status: "error",
        error: msg,
      });
      console.error(`❌ [AUTO-SYNC] Guide ${guide.name}: error — ${msg}`);
    }

    // Rate limiting delay between guides
    if (i < guides.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_SYNCS_MS));
    }
  }

  const duration = Date.now() - startTime;
  console.log(
    `🔁 [AUTO-SYNC] Complete. Synced: ${report.synced}, ` +
    `Failed: ${report.failed}. Duration: ${duration}ms`
  );

  return jsonResponse({
    message: "Batch calendar sync complete",
    ...report,
    duration_ms: duration,
    timestamp: new Date().toISOString(),
  });
});

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
