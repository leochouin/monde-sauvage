/**
 * Shared utilities for Supabase Edge Functions
 * 
 * Provides:
 * - Exponential backoff retry for Google Calendar API calls
 * - Standard CORS headers
 * - Consistent error response formatting
 */

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Retry a function with exponential backoff.
 * Only retries on transient errors (429, 500, 502, 503, 504, network errors).
 * Non-retryable errors (400, 401, 403, 404, 409) are thrown immediately.
 * 
 * @param fn - Async function that returns a Response
 * @param options - Retry configuration
 * @returns The successful Response
 */
export async function retryWithBackoff(
  fn: () => Promise<Response>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    operationName?: string;
  } = {}
): Promise<Response> {
  const {
    maxRetries = 3,
    initialDelayMs = 500,
    maxDelayMs = 8000,
    operationName = "API call",
  } = options;

  const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fn();

      // Success — return immediately
      if (response.ok) {
        return response;
      }

      // Non-retryable HTTP error — fail fast
      if (!RETRYABLE_STATUS_CODES.has(response.status)) {
        return response; // Let the caller handle the error response
      }

      // Retryable HTTP error
      const errorBody = await response.text();
      lastError = new Error(
        `${operationName} returned ${response.status}: ${errorBody}`
      );

      // If this was the last attempt, clone the original response to return
      if (attempt === maxRetries) {
        // Re-execute to get a fresh response since we consumed the body
        return await fn();
      }

      // Respect Retry-After header from 429 responses
      let delay = initialDelayMs * Math.pow(2, attempt);
      const retryAfter = response.headers.get("Retry-After");
      if (retryAfter) {
        const retryAfterMs = parseInt(retryAfter, 10) * 1000;
        if (!isNaN(retryAfterMs)) {
          delay = Math.max(delay, retryAfterMs);
        }
      }

      // Cap delay and add jitter (±25%)
      delay = Math.min(delay, maxDelayMs);
      const jitter = delay * 0.25 * (Math.random() * 2 - 1);
      delay = Math.max(100, delay + jitter);

      console.log(
        `⏳ ${operationName} attempt ${attempt + 1}/${maxRetries + 1} failed (${response.status}). ` +
        `Retrying in ${Math.round(delay)}ms...`
      );

      await sleep(delay);
    } catch (networkError) {
      // Network-level error (DNS failure, connection refused, timeout)
      lastError = networkError instanceof Error
        ? networkError
        : new Error(String(networkError));

      if (attempt === maxRetries) {
        throw lastError;
      }

      const delay = Math.min(
        initialDelayMs * Math.pow(2, attempt),
        maxDelayMs
      );
      console.log(
        `⏳ ${operationName} attempt ${attempt + 1}/${maxRetries + 1} network error: ${lastError.message}. ` +
        `Retrying in ${delay}ms...`
      );

      await sleep(delay);
    }
  }

  // Should never reach here, but just in case
  throw lastError || new Error(`${operationName} failed after ${maxRetries + 1} attempts`);
}

/**
 * Get the Google access token for a guide, with retry on transient failures.
 */
export async function getAccessToken(
  supabaseUrl: string,
  serviceRoleKey: string,
  guideId: string
): Promise<{ access_token: string; requiresReauth?: boolean }> {
  const tokenUrl = `${supabaseUrl}/functions/v1/refresh-google-token?guideId=${guideId}`;

  const tokenRes = await retryWithBackoff(
    () =>
      fetch(tokenUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${serviceRoleKey}` },
      }),
    { maxRetries: 2, operationName: "Token refresh" }
  );

  if (!tokenRes.ok) {
    const errorData = await tokenRes.json();
    const error = new Error(
      errorData.error || "Failed to authenticate with Google Calendar"
    ) as Error & { requiresReauth?: boolean; status?: number };
    error.requiresReauth = errorData.requiresReauth || false;
    error.status = tokenRes.status;
    throw error;
  }

  const tokenData = await tokenRes.json();
  return { access_token: tokenData.access_token };
}

/**
 * Get the guide's calendar ID (availability calendar or email fallback).
 * 
 * If `availability_calendar_id` is stored but the calendar no longer exists
 * in Google (404), we create a new "monde sauvage" calendar, persist its ID,
 * and return it.  This keeps create/update/delete in sync with the same
 * calendar that `google-calendar-availability` manages.
 */
export async function getGuideCalendarId(
  supabase: { from: (table: string) => { select: (fields: string) => { eq: (col: string, val: string) => { single: () => Promise<{ data: Record<string, unknown> | null; error: unknown }> } } } },
  guideId: string,
  accessToken?: string
): Promise<{ calendarId: string; guide: Record<string, unknown> }> {
  const { data: guide, error: guideError } = await supabase
    .from("guide")
    .select("email, name, availability_calendar_id")
    .eq("id", guideId)
    .single();

  if (guideError || !guide) {
    throw new Error("Guide not found");
  }

  let calendarId = (guide.availability_calendar_id as string) || (guide.email as string);

  // If we have an access token, verify the calendar still exists
  if (accessToken && guide.availability_calendar_id) {
    try {
      const verifyRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!verifyRes.ok) {
        console.log(`⚠️ Stored availability_calendar_id returned ${verifyRes.status}, creating new calendar...`);

        // Try to create a new "monde sauvage" calendar
        const createRes = await fetch(
          "https://www.googleapis.com/calendar/v3/calendars",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              summary: "monde sauvage",
              timeZone: "UTC",
            }),
          }
        );

        if (createRes.ok) {
          const created = await createRes.json();
          calendarId = created.id;

          // Persist the new calendar ID
          await (supabase as any)
            .from("guide")
            .update({ availability_calendar_id: calendarId })
            .eq("id", guideId);

          console.log(`✅ Created & stored new availability calendar: ${calendarId}`);
        } else {
          // Fall back to guide email (primary calendar)
          console.warn("⚠️ Could not create calendar, falling back to primary (email)");
          calendarId = guide.email as string;
        }
      }
    } catch (err) {
      console.warn("⚠️ Calendar verification failed, using stored ID:", err);
    }
  }

  return { calendarId, guide };
}

/**
 * Build a standard error response.
 */
export function errorResponse(
  message: string,
  status: number,
  extra: Record<string, unknown> = {}
): Response {
  return new Response(
    JSON.stringify({ error: message, ...extra }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

/**
 * Build a standard success response.
 */
export function successResponse(data: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ success: true, ...data }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
