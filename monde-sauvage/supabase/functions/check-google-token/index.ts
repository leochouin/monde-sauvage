// Supabase Edge Function: check-google-token (v2 — Production-grade)
//
// PURPOSE:
// Checks if a guide's Google Calendar connection is healthy.
// Returns the current connection_status from DB + optional live validation.
//
// MODES:
// - Quick check (default): Returns stored calendar_connection_status
// - Live validation (?validate=true): Actually tests the refresh token by calling refresh-google-token
//
// Used by frontend before booking flows to gate on calendar connectivity.

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const url = new URL(req.url);
  const guideId = url.searchParams.get("guideId");
  const liveValidate = url.searchParams.get("validate") === "true";

  if (!guideId) {
    return jsonResponse({ error: "Missing guideId" }, 400);
  }

  // ── 1. Fetch guide's connection metadata ─────────────────

  const { data: guide, error } = await supabase
    .from("guide")
    .select(
      "google_refresh_token, calendar_connection_status, " +
      "calendar_last_validated_at, calendar_disconnected_at, " +
      "calendar_disconnect_reason, token_refresh_failure_count"
    )
    .eq("id", guideId)
    .single();

  if (error || !guide) {
    return jsonResponse(
      { valid: false, error: "Guide not found", requiresAuth: true },
      404
    );
  }

  // ── 2. No token at all ────────────────────────────────────

  if (!guide.google_refresh_token) {
    return jsonResponse({
      valid: false,
      requiresAuth: true,
      connection_status: guide.calendar_connection_status || "never_connected",
      message: "No Google Calendar connection found",
    });
  }

  // ── 3. Already known disconnected ─────────────────────────

  if (guide.calendar_connection_status === "disconnected") {
    return jsonResponse({
      valid: false,
      requiresAuth: true,
      connection_status: "disconnected",
      disconnected_at: guide.calendar_disconnected_at,
      disconnect_reason: guide.calendar_disconnect_reason,
      message:
        "Google Calendar connection is disconnected. Please reconnect your account.",
    });
  }

  // ── 4. Quick check mode (default) ─────────────────────────

  if (!liveValidate) {
    const lastValidated = guide.calendar_last_validated_at
      ? new Date(guide.calendar_last_validated_at)
      : null;
    const isStale =
      !lastValidated ||
      Date.now() - lastValidated.getTime() > 24 * 60 * 60 * 1000;

    return jsonResponse({
      valid: true,
      requiresAuth: false,
      connection_status: guide.calendar_connection_status || "connected",
      last_validated_at: guide.calendar_last_validated_at,
      is_stale: isStale,
      failure_count: guide.token_refresh_failure_count,
      message: "Google Calendar connection is active",
    });
  }

  // ── 5. Live validation mode ────────────────────────────────

  console.log(`🔍 [CHECK-TOKEN] Live validation for guide ${guideId}`);

  try {
    const tokenUrl = `${SUPABASE_URL}/functions/v1/refresh-google-token?guideId=${guideId}`;
    const tokenRes = await fetch(tokenUrl, {
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    });

    const tokenData = await tokenRes.json();

    if (tokenRes.ok && tokenData.access_token) {
      return jsonResponse({
        valid: true,
        requiresAuth: false,
        connection_status: "connected",
        last_validated_at: new Date().toISOString(),
        message: "Google Calendar connection verified successfully",
      });
    }

    // Token refresh failed
    return jsonResponse({
      valid: false,
      requiresAuth: tokenData.requiresReauth || true,
      connection_status: tokenData.connection_status || "disconnected",
      error: tokenData.error,
      message:
        "Google Calendar connection could not be verified. Please reconnect.",
    });
  } catch (err) {
    console.error("❌ [CHECK-TOKEN] Error during live validation:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse(
      {
        valid: false,
        error: "Validation failed",
        message: errorMessage,
        connection_status: "unknown",
      },
      500
    );
  }
});

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
