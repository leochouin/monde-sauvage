// Supabase Edge Function: refresh-google-token (v2 — Production-grade)
//
// RESPONSIBILITIES:
// 1. Retrieve refresh token (encrypted or plaintext legacy)
// 2. Check DB-level cached access token first
// 3. Exchange refresh token for new access token with retry + exponential backoff
// 4. Handle token rotation (new refresh_token in response)
// 5. Detect revocation / expiry → mark guide as calendar_disconnected
// 6. Update calendar_connection_status on every outcome
// 7. Encrypt new tokens before storage
//
// NEVER silently fails. Every error path updates connection_status and logs.

import { createClient } from "@supabase/supabase-js";
import {
  encryptToken,
  getEffectiveRefreshToken,
} from "../_shared/tokenEncryption.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Constants ────────────────────────────────────────────────
const MAX_RETRIES = 1; // Retry once on transient failure
const RETRY_DELAY_MS = 1500;
const ACCESS_TOKEN_BUFFER_MS = 2 * 60 * 1000; // Refresh 2 min before expiry

// Non-retryable Google error codes
const FATAL_ERRORS = new Set([
  "invalid_grant",
  "invalid_client",
  "unauthorized_client",
  "access_denied",
]);

// ── Types ────────────────────────────────────────────────────
interface GuideTokenRow {
  google_refresh_token: string | null;
  encrypted_refresh_token: string | null;
  token_encryption_iv: string | null;
  google_token_created_at: string | null;
  calendar_connection_status: string | null;
  cached_access_token: string | null;
  access_token_expires_at: string | null;
  token_refresh_failure_count: number;
}

// ── Handler ──────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
  const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const url = new URL(req.url);
  const guideId = url.searchParams.get("guideId");
  const establishmentId = url.searchParams.get("establishmentId");

  if (!guideId && !establishmentId) {
    return jsonResponse({ error: "Missing guideId or establishmentId" }, 400);
  }

  const isGuide = !!guideId;
  const entityId = (guideId || establishmentId)!;
  const entityType = isGuide ? "guide" : "establishment";

  console.log(`🔄 [TOKEN-REFRESH] Starting for ${entityType} ${entityId}`);

  // ── 1. Fetch entity from DB ────────────────────────────────

  let entity: GuideTokenRow | null = null;

  if (isGuide) {
    const { data, error } = await supabase
      .from("guide")
      .select(
        "google_refresh_token, encrypted_refresh_token, token_encryption_iv, " +
        "google_token_created_at, calendar_connection_status, " +
        "cached_access_token, access_token_expires_at, token_refresh_failure_count"
      )
      .eq("id", entityId)
      .single();

    if (error || !data) {
      console.error(`❌ [TOKEN-REFRESH] ${entityType} not found:`, error);
      return jsonResponse(
        { error: `${entityType} not found`, requiresReauth: true },
        404
      );
    }
    entity = data as GuideTokenRow;
  } else {
    // Establishment flow (unchanged legacy behavior)
    const { data, error } = await supabase
      .from("Etablissement")
      .select("google_calendar_id")
      .eq("key", entityId)
      .single();

    if (error || !data) {
      return jsonResponse(
        { error: "Establishment not found", requiresReauth: true },
        404
      );
    }
    entity = {
      google_refresh_token: (data as any).google_calendar_id,
      encrypted_refresh_token: null,
      token_encryption_iv: null,
      google_token_created_at: null,
      calendar_connection_status: null,
      cached_access_token: null,
      access_token_expires_at: null,
      token_refresh_failure_count: 0,
    };
  }

  // ── 2. Check connection status gate ────────────────────────

  if (isGuide && entity.calendar_connection_status === "disconnected") {
    console.warn(`⚠️ [TOKEN-REFRESH] Guide ${entityId} is calendar_disconnected`);
    return jsonResponse(
      {
        error: "Calendar is disconnected",
        description:
          "Your Google Calendar connection was lost. Please reconnect your account.",
        requiresReauth: true,
        connection_status: "disconnected",
      },
      401
    );
  }

  // ── 3. Resolve refresh token (encrypted → plaintext) ──────

  const refreshToken = await getEffectiveRefreshToken(entity);

  if (!refreshToken) {
    console.error(`❌ [TOKEN-REFRESH] No refresh token for ${entityType} ${entityId}`);

    if (isGuide) {
      await markDisconnected(supabase, entityId, "no_refresh_token");
    }

    return jsonResponse(
      {
        error: "No Google Calendar connection found",
        requiresReauth: true,
        connection_status: "disconnected",
      },
      401
    );
  }

  // ── 4. Check DB-cached access token ────────────────────────

  if (isGuide && entity.cached_access_token && entity.access_token_expires_at) {
    const expiresAt = new Date(entity.access_token_expires_at).getTime();
    if (expiresAt > Date.now() + ACCESS_TOKEN_BUFFER_MS) {
      const remainingSec = Math.floor((expiresAt - Date.now()) / 1000);
      console.log(`✅ [TOKEN-REFRESH] Using DB-cached token, ${remainingSec}s remaining`);
      return jsonResponse({
        access_token: entity.cached_access_token,
        expires_in: remainingSec,
        cached: true,
        connection_status: "connected",
      });
    }
  }

  // ── 5. Exchange refresh token with retry ───────────────────

  let tokenData: any = null;
  let lastError: string | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(
        `🔑 [TOKEN-REFRESH] Attempt ${attempt + 1}/${MAX_RETRIES + 1} for ${entityType} ${entityId}`
      );

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });

      tokenData = await tokenRes.json();

      // ── FATAL: Token revoked or permanently invalid ──
      if (FATAL_ERRORS.has(tokenData.error)) {
        console.error(
          `❌ [TOKEN-REFRESH] Fatal error "${tokenData.error}" for ${entityType} ${entityId}: ${tokenData.error_description}`
        );

        if (isGuide) {
          await markDisconnected(supabase, entityId, tokenData.error);
          // Clear the invalid token
          await supabase
            .from("guide")
            .update({
              google_refresh_token: null,
              encrypted_refresh_token: null,
              token_encryption_iv: null,
              cached_access_token: null,
              access_token_expires_at: null,
            })
            .eq("id", entityId);
        }

        return jsonResponse(
          {
            error: "Refresh token expired or revoked",
            googleError: tokenData.error,
            description:
              "Your Google Calendar connection has expired. Please reconnect your account.",
            requiresReauth: true,
            connection_status: "disconnected",
          },
          401
        );
      }

      // ── SUCCESS ──
      if (tokenData.access_token) {
        break; // Exit retry loop
      }

      // ── TRANSIENT FAILURE ──
      lastError = tokenData.error || "no_access_token";
      console.warn(
        `⚠️ [TOKEN-REFRESH] Transient failure (attempt ${attempt + 1}): ${lastError}`
      );

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        console.log(`⏳ [TOKEN-REFRESH] Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    } catch (networkErr) {
      lastError =
        networkErr instanceof Error ? networkErr.message : String(networkErr);
      console.error(
        `❌ [TOKEN-REFRESH] Network error (attempt ${attempt + 1}): ${lastError}`
      );

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // ── 6. All retries exhausted ───────────────────────────────

  if (!tokenData?.access_token) {
    console.error(
      `❌ [TOKEN-REFRESH] All retries exhausted for ${entityType} ${entityId}. Last error: ${lastError}`
    );

    if (isGuide) {
      const newFailCount = (entity.token_refresh_failure_count || 0) + 1;
      const updatePayload: Record<string, unknown> = {
        token_refresh_failure_count: newFailCount,
      };

      // After 3 consecutive failures, mark disconnected
      if (newFailCount >= 3) {
        updatePayload.calendar_connection_status = "disconnected";
        updatePayload.calendar_disconnected_at = new Date().toISOString();
        updatePayload.calendar_disconnect_reason = `refresh_failed_${newFailCount}x`;
        console.error(
          `🚨 [TOKEN-REFRESH] Guide ${entityId} marked DISCONNECTED after ${newFailCount} consecutive failures`
        );
      } else {
        updatePayload.calendar_connection_status = "pending_reauth";
      }

      await supabase.from("guide").update(updatePayload).eq("id", entityId);
    }

    return jsonResponse(
      {
        error: "Failed to refresh token after retries",
        lastError,
        requiresReauth: true,
        connection_status: "pending_reauth",
      },
      502
    );
  }

  // ── 7. Success — update DB state ───────────────────────────

  const expiresIn = tokenData.expires_in || 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  if (isGuide) {
    const updatePayload: Record<string, unknown> = {
      cached_access_token: tokenData.access_token,
      access_token_expires_at: expiresAt,
      calendar_connection_status: "connected",
      calendar_last_validated_at: new Date().toISOString(),
      token_refresh_failure_count: 0, // Reset on success
      // Clear any disconnect metadata
      calendar_disconnected_at: null,
      calendar_disconnect_reason: null,
    };

    // Handle token rotation: Google may issue a new refresh token
    if (tokenData.refresh_token && tokenData.refresh_token !== refreshToken) {
      console.log(`🔄 [TOKEN-REFRESH] Token rotation detected for guide ${entityId}`);
      const { encrypted, iv } = await encryptToken(tokenData.refresh_token);
      updatePayload.encrypted_refresh_token = encrypted;
      updatePayload.token_encryption_iv = iv;
      updatePayload.google_refresh_token = tokenData.refresh_token; // Legacy compat
      updatePayload.google_token_created_at = new Date().toISOString();
    }

    await supabase.from("guide").update(updatePayload).eq("id", entityId);
  }

  console.log(
    `✅ [TOKEN-REFRESH] Success for ${entityType} ${entityId}, expires in ${expiresIn}s`
  );

  return jsonResponse({
    access_token: tokenData.access_token,
    expires_in: expiresIn,
    token_type: tokenData.token_type || "Bearer",
    cached: false,
    connection_status: "connected",
  });
});

// ── Helpers ──────────────────────────────────────────────────

async function markDisconnected(
  supabase: any,
  guideId: string,
  reason: string
) {
  console.error(`🚨 [TOKEN-REFRESH] Marking guide ${guideId} as DISCONNECTED: ${reason}`);
  await supabase
    .from("guide")
    .update({
      calendar_connection_status: "disconnected",
      calendar_disconnected_at: new Date().toISOString(),
      calendar_disconnect_reason: reason,
      cached_access_token: null,
      access_token_expires_at: null,
    })
    .eq("id", guideId);
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
