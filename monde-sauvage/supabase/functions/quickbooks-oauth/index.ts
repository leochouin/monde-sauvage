// Supabase Edge Function: quickbooks-oauth
// Handles the QuickBooks Online OAuth 2.0 authorization_code flow for either
// a Guide or an Owner (Etablissement).
//
// Step 1 (no `code`): build the Intuit authorize URL and 302 to it. The state
//   carries which entity initiated the flow so step 2 can persist tokens onto
//   the right table.
// Step 2 (callback with `code` + `realmId`): exchange for tokens and persist
//   them onto the matching `guide` or `Etablissement` row, then redirect the
//   user back into the app.
import { createClient } from "@supabase/supabase-js";

const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPE = "com.intuit.quickbooks.accounting";

type EntityKind = "guide" | "establishment";

interface OAuthState {
  entity: EntityKind;
  entityId: string;
  redirectTo: string;
}

Deno.serve(async (req: Request) => {
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("URL");
    const SUPABASE_SERVICE_ROLE_KEY =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
    const QUICKBOOKS_CLIENT_ID = Deno.env.get("QUICKBOOKS_CLIENT_ID");
    const QUICKBOOKS_CLIENT_SECRET = Deno.env.get("QUICKBOOKS_CLIENT_SECRET");
    const REDIRECT_URI =
      Deno.env.get("QUICKBOOKS_REDIRECT_URI") ||
      `${SUPABASE_URL}/functions/v1/quickbooks-oauth`;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonError("Missing Supabase configuration", 500);
    }
    if (!QUICKBOOKS_CLIENT_ID || !QUICKBOOKS_CLIENT_SECRET) {
      return jsonError("Missing QuickBooks OAuth configuration", 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const url = new URL(req.url);
    const code = url.searchParams.get("code");

    // Step 1: kick off OAuth
    if (!code) {
      const guideId = url.searchParams.get("guideId");
      const establishmentId = url.searchParams.get("establishmentId");
      const redirectTo = url.searchParams.get("redirect_to") || "/map";

      if (!guideId && !establishmentId) {
        return jsonError("Missing guideId or establishmentId", 400);
      }

      const state: OAuthState = guideId
        ? { entity: "guide", entityId: guideId, redirectTo }
        : { entity: "establishment", entityId: establishmentId!, redirectTo };

      const authorizeUrl = new URL(AUTH_URL);
      authorizeUrl.searchParams.set("client_id", QUICKBOOKS_CLIENT_ID);
      authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("scope", SCOPE);
      authorizeUrl.searchParams.set("state", JSON.stringify(state));

      return new Response(null, {
        status: 302,
        headers: { Location: authorizeUrl.toString() },
      });
    }

    // Step 2: handle callback
    const stateParam = url.searchParams.get("state");
    const realmId = url.searchParams.get("realmId");
    if (!stateParam) return jsonError("Missing state parameter", 400);
    if (!realmId) return jsonError("Missing realmId parameter", 400);

    let entity: EntityKind | undefined;
    let entityId: string | undefined;
    let redirectTo = "/map";
    try {
      const parsed = JSON.parse(stateParam) as Partial<OAuthState> & { guideId?: string };
      // Backwards-compat: legacy state was `{ guideId, redirectTo }`.
      if (parsed.entity && parsed.entityId) {
        entity = parsed.entity;
        entityId = parsed.entityId;
      } else if (parsed.guideId) {
        entity = "guide";
        entityId = parsed.guideId;
      }
      redirectTo = parsed.redirectTo || "/map";
    } catch {
      return jsonError("Invalid state parameter", 400);
    }
    if (!entity || !entityId) {
      return jsonError("Missing entity in state", 400);
    }

    // Exchange authorization code for tokens (Intuit requires HTTP Basic auth).
    const basicAuth = btoa(`${QUICKBOOKS_CLIENT_ID}:${QUICKBOOKS_CLIENT_SECRET}`);
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    });

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenBody,
    });
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || tokenData.error) {
      console.error("QuickBooks token error:", tokenData);
      return jsonError(tokenData.error_description || tokenData.error || "Token exchange failed", 400);
    }

    const now = new Date();
    const accessExpiresAt = tokenData.expires_in
      ? new Date(now.getTime() + Number(tokenData.expires_in) * 1000).toISOString()
      : null;
    const refreshExpiresAt = tokenData.x_refresh_token_expires_in
      ? new Date(now.getTime() + Number(tokenData.x_refresh_token_expires_in) * 1000).toISOString()
      : null;

    const tokenPayload = {
      quickbooks_connected: true,
      quickbooks_access_token: tokenData.access_token,
      quickbooks_refresh_token: tokenData.refresh_token,
      quickbooks_realm_id: realmId,
      quickbooks_token_created_at: now.toISOString(),
      quickbooks_access_token_expires_at: accessExpiresAt,
      quickbooks_refresh_token_expires_at: refreshExpiresAt,
    };

    const { error } =
      entity === "guide"
        ? await supabase.from("guide").update(tokenPayload).eq("id", entityId)
        : await supabase.from("Etablissement").update(tokenPayload).eq("key", entityId);

    if (error) {
      console.error(`Supabase update error for ${entity} ${entityId}:`, error);
      return jsonError(error.message, 500);
    }

    return new Response(null, {
      status: 302,
      headers: { Location: redirectTo },
    });
  } catch (err) {
    console.error("=== QuickBooks OAuth uncaught error ===", err);
    return jsonError((err as Error).message || "Internal server error", 500);
  }
});

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
