// =============================================================================
// Shared QuickBooks Online helpers
// =============================================================================

import { createClient } from "@supabase/supabase-js";

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

// Sandbox vs production is controlled by QUICKBOOKS_ENV env var.
function qboBase(): string {
  const env = Deno.env.get("QUICKBOOKS_ENV") || "sandbox";
  return env === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export interface QuickbooksUser {
  id: string;
  quickbooks_connected?: boolean | null;
  quickbooks_access_token?: string | null;
  quickbooks_refresh_token?: string | null;
  quickbooks_realm_id?: string | null;
  quickbooks_access_token_expires_at?: string | null;
  quickbooks_refresh_token_expires_at?: string | null;
}

export type QboEntityKind = "guide" | "establishment";

function qboHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Token refresh
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Refreshes the QBO access token if it has expired (or will expire within 60s).
 * Persists the new tokens back to the DB and returns the updated user object.
 * Returns the same user object unchanged if the token is still valid.
 */
export async function ensureFreshQboToken(
  supabase: ReturnType<typeof createClient>,
  user: QuickbooksUser,
  entityKind: QboEntityKind
): Promise<QuickbooksUser> {
  if (!user.quickbooks_access_token || !user.quickbooks_refresh_token) {
    throw new Error("QuickBooks tokens missing");
  }

  // Check if refresh is needed (within 60s buffer)
  const expiresAt = user.quickbooks_access_token_expires_at
    ? new Date(user.quickbooks_access_token_expires_at).getTime()
    : 0;

  if (expiresAt > Date.now() + 60_000) {
    return user; // Token still valid
  }

  console.log("[QBO] Refreshing access token for", entityKind, user.id);

  const clientId = Deno.env.get("QUICKBOOKS_CLIENT_ID");
  const clientSecret = Deno.env.get("QUICKBOOKS_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("QuickBooks credentials not configured");

  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: user.quickbooks_refresh_token,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`QBO token refresh failed: ${data.error_description || data.error || res.status}`);
  }

  const now = new Date();
  const accessExpiresAt = data.expires_in
    ? new Date(now.getTime() + Number(data.expires_in) * 1000).toISOString()
    : null;
  const refreshExpiresAt = data.x_refresh_token_expires_in
    ? new Date(now.getTime() + Number(data.x_refresh_token_expires_in) * 1000).toISOString()
    : null;

  const tokenPayload = {
    quickbooks_access_token: data.access_token,
    quickbooks_refresh_token: data.refresh_token || user.quickbooks_refresh_token,
    quickbooks_token_created_at: now.toISOString(),
    quickbooks_access_token_expires_at: accessExpiresAt,
    quickbooks_refresh_token_expires_at: refreshExpiresAt,
  };

  if (entityKind === "guide") {
    await supabase.from("guide").update(tokenPayload).eq("id", user.id);
  } else {
    await supabase.from("Etablissement").update(tokenPayload).eq("key", user.id);
  }

  return { ...user, ...tokenPayload };
}

// ─────────────────────────────────────────────────────────────────────────────
// Company info (connection test)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchQuickbooksCompanyInfo(user: QuickbooksUser) {
  if (!user.quickbooks_access_token || !user.quickbooks_realm_id) {
    throw new Error("User is missing QuickBooks access token or realmId");
  }

  const url = `${qboBase()}/v3/company/${user.quickbooks_realm_id}/companyinfo/${user.quickbooks_realm_id}`;
  const res = await fetch(url, { headers: qboHeaders(user.quickbooks_access_token) });
  const text = await res.text();

  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }

  if (!res.ok) {
    throw new Error(`QuickBooks companyinfo failed (${res.status}): ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }

  return body;
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finds a QBO customer by DisplayName, creating one if it doesn't exist.
 * Returns the customer Id string.
 */
export async function findOrCreateQboCustomer(
  user: QuickbooksUser,
  customerName: string,
  customerEmail?: string
): Promise<string> {
  const accessToken = user.quickbooks_access_token!;
  const realmId = user.quickbooks_realm_id!;

  // Sanitize name for QBO query
  const safeName = customerName.replace(/'/g, "\\'").substring(0, 100);

  const queryUrl = `${qboBase()}/v3/company/${realmId}/query?query=SELECT Id FROM Customer WHERE DisplayName = '${safeName}'&minorversion=65`;
  const queryRes = await fetch(queryUrl, { headers: qboHeaders(accessToken) });

  if (queryRes.ok) {
    const queryData = await queryRes.json();
    const existing = queryData?.QueryResponse?.Customer?.[0];
    if (existing?.Id) return existing.Id as string;
  }

  // Create customer
  const payload: Record<string, unknown> = { DisplayName: customerName };
  if (customerEmail) {
    payload.PrimaryEmailAddr = { Address: customerEmail };
  }

  const createRes = await fetch(`${qboBase()}/v3/company/${realmId}/customer?minorversion=65`, {
    method: "POST",
    headers: qboHeaders(accessToken),
    body: JSON.stringify(payload),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    console.warn("[QBO] Customer create failed, falling back to CustomerRef=1:", errText);
    return "1"; // Fallback to default customer
  }

  const createData = await createRes.json();
  return (createData?.Customer?.Id as string) || "1";
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoice creation
// ─────────────────────────────────────────────────────────────────────────────

export interface QboInvoiceParams {
  customerRef: string;
  amount: number;
  description: string;
  docNumber?: string; // Booking ID reference
  privateNote?: string;
  txnDate?: string; // YYYY-MM-DD
}

/**
 * Creates an invoice in QuickBooks Online for a guide booking.
 */
export async function createQboInvoice(
  user: QuickbooksUser,
  params: QboInvoiceParams
): Promise<{ Id: string; DocNumber: string }> {
  const { customerRef, amount, description, docNumber, privateNote, txnDate } = params;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid invoice amount: ${amount}`);
  }

  const body: Record<string, unknown> = {
    CustomerRef: { value: customerRef },
    Line: [
      {
        Amount: amount,
        DetailType: "SalesItemLineDetail",
        Description: description,
        SalesItemLineDetail: {
          ItemRef: { value: "1", name: "Services" },
          UnitPrice: amount,
          Qty: 1,
        },
      },
    ],
  };

  if (docNumber) body.DocNumber = docNumber.substring(0, 21); // QBO limit
  if (privateNote) body.PrivateNote = privateNote.substring(0, 4000);
  if (txnDate) body.TxnDate = txnDate;

  const url = `${qboBase()}/v3/company/${user.quickbooks_realm_id}/invoice?minorversion=65`;
  const res = await fetch(url, {
    method: "POST",
    headers: qboHeaders(user.quickbooks_access_token!),
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`QBO invoice create failed (${res.status}): ${JSON.stringify(data)}`);
  }

  return {
    Id: data.Invoice?.Id as string,
    DocNumber: data.Invoice?.DocNumber as string,
  };
}

/**
 * Legacy helper kept for backwards compatibility.
 * Creates a minimal one-line-item invoice with default CustomerRef="1".
 */
export async function createQuickbooksInvoice(user: QuickbooksUser, amount: number) {
  return createQboInvoice(user, {
    customerRef: "1",
    amount,
    description: "Services de guide",
  });
}
