// =============================================================================
// Shared QuickBooks Online helpers
// =============================================================================
// Minimal fetch-based client for the QuickBooks Online sandbox API.
// No refresh-token logic yet — caller is responsible for having a valid
// access token on the guide row.
// =============================================================================

const QBO_SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com";

export interface QuickbooksUser {
  id: string;
  quickbooks_connected?: boolean | null;
  quickbooks_access_token?: string | null;
  quickbooks_realm_id?: string | null;
}

function qboHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

/**
 * Hits /companyinfo/{realmId} — used to verify the access token & realm are
 * still valid. Returns the raw JSON from Intuit.
 */
export async function fetchQuickbooksCompanyInfo(user: QuickbooksUser) {
  if (!user.quickbooks_access_token || !user.quickbooks_realm_id) {
    throw new Error("User is missing QuickBooks access token or realmId");
  }

  const url = `${QBO_SANDBOX_BASE}/v3/company/${user.quickbooks_realm_id}/companyinfo/${user.quickbooks_realm_id}`;
  console.log(`[QBO] GET ${url}`);

  const res = await fetch(url, { headers: qboHeaders(user.quickbooks_access_token) });
  const text = await res.text();

  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }

  if (!res.ok) {
    console.error(`[QBO] companyinfo failed: ${res.status}`, body);
    throw new Error(`QuickBooks companyinfo failed (${res.status}): ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }

  return body;
}

/**
 * Creates a minimal one-line-item invoice in QuickBooks for the given user
 * and amount (in dollars, not cents). Uses dummy CustomerRef="1".
 */
export async function createQuickbooksInvoice(user: QuickbooksUser, amount: number) {
  if (!user.quickbooks_access_token || !user.quickbooks_realm_id) {
    throw new Error("User is missing QuickBooks access token or realmId");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid invoice amount: ${amount}`);
  }

  const url = `${QBO_SANDBOX_BASE}/v3/company/${user.quickbooks_realm_id}/invoice`;

  const body = {
    Line: [
      {
        Amount: amount,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { value: "1", name: "Services" },
        },
      },
    ],
    CustomerRef: { value: "1" },
  };

  console.log(`[QBO] POST ${url} amount=${amount}`);

  const res = await fetch(url, {
    method: "POST",
    headers: qboHeaders(user.quickbooks_access_token),
    body: JSON.stringify(body),
  });
  const text = await res.text();

  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    console.error(`[QBO] invoice create failed: ${res.status}`, data);
    throw new Error(`QuickBooks invoice create failed (${res.status}): ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }

  console.log(`[QBO] invoice created:`, JSON.stringify(data));
  return data;
}
