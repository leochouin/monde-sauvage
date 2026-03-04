// Supabase Edge Function: update-guide-booking-event
// Updates a Google Calendar event when booking is modified
//
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

  console.log("📩 Updating Google Calendar event for guide booking");

  try {
    const SUPABASE_URL = Deno.env.get("URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { booking_id, event_id, guide_id, updates } = await req.json();

    if (!event_id || !guide_id || !updates) {
      return errorResponse("Missing required fields", 400);
    }

    console.log(`📝 Updating event: ${event_id}`);

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

    // ── BUILD UPDATE PAYLOAD ───────────────────────────────────
    const eventUpdate: Record<string, any> = {};

    if (updates.start_time) {
      // Normalize date-only strings to datetime
      let normalizedStartTime = updates.start_time;
      if (/^\d{4}-\d{2}-\d{2}$/.test(updates.start_time)) {
        normalizedStartTime = `${updates.start_time}T09:00:00`;
        console.log(`📅 Converted date-only start_time to: ${normalizedStartTime}`);
      }
      eventUpdate.start = {
        dateTime: normalizedStartTime,
        timeZone: "Europe/Brussels",
      };
    }
    if (updates.end_time) {
      // Normalize date-only strings to datetime
      let normalizedEndTime = updates.end_time;
      if (/^\d{4}-\d{2}-\d{2}$/.test(updates.end_time)) {
        normalizedEndTime = `${updates.end_time}T17:00:00`;
        console.log(`📅 Converted date-only end_time to: ${normalizedEndTime}`);
      }
      eventUpdate.end = {
        dateTime: normalizedEndTime,
        timeZone: "Europe/Brussels",
      };
    }
    if (updates.customer_name) {
      const title = updates.trip_type
        ? `${updates.trip_type} - ${updates.customer_name}`
        : updates.customer_name;
      eventUpdate.summary = title;
    }
    if (updates.notes !== undefined) {
      const desc = [
        booking_id ? `Booking ID: ${booking_id}` : "",
        updates.customer_email ? `Email: ${updates.customer_email}` : "",
        updates.notes ? `\nNotes: ${updates.notes}` : "",
        "\n---",
        "Updated via Monde Sauvage booking system",
      ]
        .filter(Boolean)
        .join("\n");
      eventUpdate.description = desc;
    }

    // ── PATCH EVENT (with retry) ───────────────────────────────
    console.log("📅 Updating event in Google Calendar...");
    const calendarApiUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event_id)}`;

    const updateRes = await retryWithBackoff(
      () =>
        fetch(calendarApiUrl, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(eventUpdate),
        }),
      { maxRetries: 3, operationName: "Update calendar event" }
    );

    if (!updateRes.ok) {
      const errorData = await updateRes.json();
      console.error("Google Calendar API error response:", errorData);
      throw new Error(
        `Google Calendar API error: ${errorData.error?.message || updateRes.statusText || "Unknown error"}`
      );
    }

    const updatedEvent = await updateRes.json();
    console.log(`✅ Event updated: ${updatedEvent.id}`);

    return successResponse({
      event_id: updatedEvent.id,
      message: "Google Calendar event updated successfully",
    });
  } catch (error: any) {
    console.error("❌ Error updating calendar event:", error);

    return errorResponse(
      error.message || "Failed to update calendar event",
      500,
      { details: error.toString() }
    );
  }
});
