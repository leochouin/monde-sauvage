/**
 * check-guide-conflicts
 *
 * Server-side conflict check for guide bookings.
 * Uses SERVICE_ROLE_KEY to bypass RLS, ensuring every existing
 * booking is visible regardless of the calling user's permissions.
 *
 * Called before creating a booking to prevent double-bookings.
 *
 * Query params:
 *   guideId  – UUID of the guide
 *   start    – ISO 8601 start datetime
 *   end      – ISO 8601 end datetime
 *   excludeBookingId (optional) – booking ID to exclude (for updates)
 *
 * Returns:
 *   { available: true }
 *   OR
 *   { available: false, conflicts: [...], reason: "..." }
 */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Accept params from either query string (GET) or JSON body (POST)
  let guideId: string | null = null;
  let start: string | null = null;
  let end: string | null = null;
  let excludeBookingId: string | null = null;

  if (req.method === "GET") {
    const url = new URL(req.url);
    guideId = url.searchParams.get("guideId");
    start = url.searchParams.get("start");
    end = url.searchParams.get("end");
    excludeBookingId = url.searchParams.get("excludeBookingId");
  } else {
    try {
      const body = await req.json();
      guideId = body.guideId || body.guide_id;
      start = body.start || body.startTime || body.start_time;
      end = body.end || body.endTime || body.end_time;
      excludeBookingId = body.excludeBookingId || body.exclude_booking_id;
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
  }

  if (!guideId || !start || !end) {
    return jsonResponse(
      { error: "Missing required params: guideId, start, end" },
      400
    );
  }

  console.log(
    `🔍 [CONFLICT-CHECK] guide=${guideId} start=${start} end=${end} exclude=${excludeBookingId || "none"}`
  );

  // Standard overlap: booking_start < requested_end AND booking_end > requested_start
  let query = supabase
    .from("guide_booking")
    .select("id, start_time, end_time, status, customer_name")
    .eq("guide_id", guideId)
    .is("deleted_at", null)
    .not("status", "in", '("cancelled","deleted")')
    .lt("start_time", end)
    .gt("end_time", start);

  if (excludeBookingId) {
    query = query.neq("id", excludeBookingId);
  }

  const { data: conflicts, error } = await query;

  if (error) {
    console.error("❌ [CONFLICT-CHECK] Query error:", error);
    return jsonResponse({ error: "Database query failed" }, 500);
  }

  if (conflicts && conflicts.length > 0) {
    console.log(`❌ [CONFLICT-CHECK] ${conflicts.length} conflict(s) found`);
    return jsonResponse({
      available: false,
      conflicts,
      reason: "Ce créneau a déjà été réservé. Veuillez sélectionner un autre horaire.",
    });
  }

  console.log("✅ [CONFLICT-CHECK] No conflicts — guide is available");
  return jsonResponse({ available: true });
});

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
