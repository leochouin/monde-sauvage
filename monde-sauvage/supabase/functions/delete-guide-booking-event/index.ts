// Supabase Edge Function: delete-guide-booking-event
// Deletes a Google Calendar event when booking is cancelled
//
// IDEMPOTENCY: Treats HTTP 404 (already deleted) as success.
// RETRY: Uses exponential backoff for transient Google API failures.

import { createClient } from "@supabase/supabase-js";
import {
  corsHeaders,
  retryWithBackoff,
  getAccessToken,
  getGuideCalendarId,
  errorResponse,
  successResponse,
} from "../_shared/calendarUtils.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  console.log("📩 Deleting Google Calendar event for guide booking");

  try {
    const SUPABASE_URL = Deno.env.get("URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { event_id, guide_id } = await req.json();

    if (!event_id || !guide_id) {
      return errorResponse("Missing required fields", 400);
    }

    console.log(`🗑️ Deleting event: ${event_id}`);

    // ── GET ACCESS TOKEN (with retry) ──────────────────────────
    let accessToken: string;
    try {
      const tokenResult = await getAccessToken(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, guide_id);
      accessToken = tokenResult.access_token;
    } catch (tokenError: any) {
      return errorResponse(
        "Failed to authenticate with Google Calendar",
        tokenError.status || 401,
        { requiresAuth: tokenError.requiresReauth || false }
      );
    }

    // ── GET GUIDE CALENDAR (verify + auto-create if missing) ──
    const { calendarId } = await getGuideCalendarId(supabase, guide_id, accessToken);

    // ── DELETE EVENT (with retry) ──────────────────────────────
    console.log("📅 Deleting event from Google Calendar...");
    const calendarApiUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event_id)}`;

    const deleteRes = await retryWithBackoff(
      () =>
        fetch(calendarApiUrl, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      { maxRetries: 3, operationName: "Delete calendar event" }
    );

    // 404 = already deleted → treat as success (idempotent)
    if (!deleteRes.ok && deleteRes.status !== 404) {
      let errorMsg = "Unknown error";
      try {
        const errorData = await deleteRes.json();
        errorMsg = errorData.error?.message || errorMsg;
      } catch {
        // DELETE responses may have no body
      }
      throw new Error(`Google Calendar API error: ${errorMsg}`);
    }

    console.log(`✅ Event deleted: ${event_id}`);

    return successResponse({
      message: "Google Calendar event deleted successfully",
    });
  } catch (error: any) {
    console.error("❌ Error deleting calendar event:", error);

    return errorResponse(
      error.message || "Failed to delete calendar event",
      500,
      { details: error.toString() }
    );
  }
});
