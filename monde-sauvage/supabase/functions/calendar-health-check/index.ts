// Supabase Edge Function: calendar-health-check
//
// PURPOSE:
// Background health-check job that periodically validates ALL guide refresh tokens.
// Designed to be called by a cron scheduler (e.g., Supabase pg_cron, external cron).
//
// BEHAVIOR:
// 1. Fetches all guides with google_refresh_token IS NOT NULL
// 2. For each guide, attempts a token refresh via the refresh-google-token function
// 3. Updates calendar_last_validated_at on success
// 4. Marks guides as disconnected after repeated failures
// 5. Returns a summary report
//
// SCHEDULE RECOMMENDATION:
// Run every 6 hours to catch token revocations within a business day.
// pg_cron: SELECT cron.schedule('calendar-health-check', '0 */6 * * *', ...);
//
// SAFETY:
// - Rate-limited to avoid hitting Google API quotas
// - Processes guides sequentially with delay between each
// - Idempotent — safe to run multiple times

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DELAY_BETWEEN_CHECKS_MS = 1000; // 1s between guides to avoid rate limits
const STALE_THRESHOLD_HOURS = 12; // Only check guides not validated in last 12h

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  console.log("🏥 [HEALTH-CHECK] Starting calendar health check...");
  const startTime = Date.now();

  const SUPABASE_URL = Deno.env.get("URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── 1. Fetch all guides with tokens that need validation ───

  const staleThreshold = new Date(
    Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data: guides, error: fetchError } = await supabase
    .from("guide")
    .select(
      "id, name, email, calendar_connection_status, " +
      "calendar_last_validated_at, token_refresh_failure_count"
    )
    .not("google_refresh_token", "is", null)
    .or(
      `calendar_last_validated_at.is.null,calendar_last_validated_at.lt.${staleThreshold}`
    )
    .order("calendar_last_validated_at", { ascending: true, nullsFirst: true });

  if (fetchError) {
    console.error("❌ [HEALTH-CHECK] Failed to fetch guides:", fetchError);
    return jsonResponse({ error: "Failed to fetch guides" }, 500);
  }

  console.log(
    `🏥 [HEALTH-CHECK] Found ${guides?.length || 0} guides needing validation`
  );

  if (!guides || guides.length === 0) {
    return jsonResponse({
      message: "No guides need validation",
      checked: 0,
      healthy: 0,
      disconnected: 0,
      duration_ms: Date.now() - startTime,
    });
  }

  // ── 2. Validate each guide's token ─────────────────────────

  const report = {
    checked: 0,
    healthy: 0,
    disconnected: 0,
    already_disconnected: 0,
    errors: [] as string[],
    details: [] as { id: string; name: string; status: string; error?: string }[],
  };

  for (const guide of guides) {
    report.checked++;

    // Skip already-disconnected guides (they need manual reconnection)
    if (guide.calendar_connection_status === "disconnected") {
      report.already_disconnected++;
      report.details.push({
        id: guide.id,
        name: guide.name,
        status: "already_disconnected",
      });
      continue;
    }

    try {
      console.log(
        `🔍 [HEALTH-CHECK] Checking guide ${guide.name} (${guide.id})...`
      );

      // Call refresh-google-token to validate
      const tokenUrl = `${SUPABASE_URL}/functions/v1/refresh-google-token?guideId=${guide.id}`;
      const tokenRes = await fetch(tokenUrl, {
        headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      });

      const tokenData = await tokenRes.json();

      if (tokenRes.ok && tokenData.access_token) {
        report.healthy++;
        report.details.push({
          id: guide.id,
          name: guide.name,
          status: "healthy",
        });
        console.log(`✅ [HEALTH-CHECK] Guide ${guide.name}: healthy`);
      } else if (tokenData.requiresReauth) {
        report.disconnected++;
        report.details.push({
          id: guide.id,
          name: guide.name,
          status: "disconnected",
          error: tokenData.error,
        });
        console.error(
          `🚨 [HEALTH-CHECK] Guide ${guide.name}: DISCONNECTED — ${tokenData.error}`
        );

        // Log alert for monitoring/notification system
        console.error(
          `🔔 [ALERT] Guide "${guide.name}" (${guide.email}) calendar disconnected. ` +
          `Reason: ${tokenData.error}. Action required: re-auth.`
        );
      } else {
        report.errors.push(
          `${guide.name}: unexpected response (${tokenRes.status})`
        );
        report.details.push({
          id: guide.id,
          name: guide.name,
          status: "error",
          error: `HTTP ${tokenRes.status}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report.errors.push(`${guide.name}: ${msg}`);
      report.details.push({
        id: guide.id,
        name: guide.name,
        status: "error",
        error: msg,
      });
      console.error(`❌ [HEALTH-CHECK] Guide ${guide.name}: error — ${msg}`);
    }

    // Rate limiting delay
    if (report.checked < guides.length) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_CHECKS_MS));
    }
  }

  const duration = Date.now() - startTime;

  console.log(
    `🏥 [HEALTH-CHECK] Complete. ` +
    `Checked: ${report.checked}, Healthy: ${report.healthy}, ` +
    `Disconnected: ${report.disconnected}, Errors: ${report.errors.length}. ` +
    `Duration: ${duration}ms`
  );

  // ── 3. Log critical alerts ─────────────────────────────────

  if (report.disconnected > 0) {
    console.error(
      `🚨🚨🚨 [HEALTH-CHECK] ${report.disconnected} guide(s) have lost calendar connectivity! ` +
      `Bookings will be blocked until they reconnect.`
    );
  }

  return jsonResponse({
    message: "Health check complete",
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
