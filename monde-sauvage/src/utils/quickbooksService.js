/**
 * QuickBooks Online Service
 *
 * Frontend helpers for QuickBooks Online integration:
 *   - Build authorize URLs (kicks off OAuth via the quickbooks-oauth function)
 *   - Test the active QB connection for either a guide or an establishment
 *
 * Persistence of tokens happens in the edge function — this file only
 * brokers the user-facing redirect and the diagnostic test call.
 */
import supabase from './supabase.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ─────────────────────────────────────────────────────────────────────────────
// OAUTH KICKOFF
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the URL that begins the QuickBooks OAuth flow for a guide.
 * Hitting this URL redirects the user through Intuit and back to the
 * configured redirect URI; tokens are persisted server-side.
 *
 * @param {string} guideId
 * @param {string} [redirectTo='/map'] - app path to land on when done
 * @returns {string}
 */
export function buildGuideQuickbooksConnectUrl(guideId, redirectTo = '/map') {
  const params = new URLSearchParams({ guideId, redirect_to: redirectTo });
  return `${SUPABASE_URL}/functions/v1/quickbooks-oauth?${params.toString()}`;
}

/**
 * Build the URL that begins the QuickBooks OAuth flow for an establishment
 * (Hébergement / Pourvoirie). The owner must be signed in; tokens are
 * stored on the matching Etablissement row by the edge function.
 *
 * @param {string} establishmentId - Etablissement key
 * @param {string} [redirectTo='/map']
 * @returns {string}
 */
export function buildEstablishmentQuickbooksConnectUrl(establishmentId, redirectTo = '/map') {
  const params = new URLSearchParams({ establishmentId, redirect_to: redirectTo });
  return `${SUPABASE_URL}/functions/v1/quickbooks-oauth?${params.toString()}`;
}

/**
 * Convenience: trigger the QuickBooks OAuth redirect for a guide.
 */
export function startGuideQuickbooksConnect(guideId, redirectTo = '/map') {
  window.location.href = buildGuideQuickbooksConnectUrl(guideId, redirectTo);
}

/**
 * Convenience: trigger the QuickBooks OAuth redirect for an establishment.
 */
export function startEstablishmentQuickbooksConnect(establishmentId, redirectTo = '/map') {
  window.location.href = buildEstablishmentQuickbooksConnectUrl(establishmentId, redirectTo);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION TEST
// ─────────────────────────────────────────────────────────────────────────────

async function callTestQuickbooks(body) {
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) throw new Error('Not signed in');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/test-quickbooks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

/**
 * Test the QuickBooks connection for the current user's guide row.
 * @returns {Promise<{ok: true, entity: 'guide', companyInfo: object}>}
 */
export async function testGuideQuickbooksConnection() {
  return callTestQuickbooks({ entity: 'guide' });
}

/**
 * Test the QuickBooks connection for an establishment owned by the
 * current user. The edge function enforces ownership.
 *
 * @param {string} establishmentId - Etablissement key
 * @returns {Promise<{ok: true, entity: 'establishment', companyInfo: object}>}
 */
export async function testEstablishmentQuickbooksConnection(establishmentId) {
  if (!establishmentId) throw new Error('establishmentId is required');
  return callTestQuickbooks({ entity: 'establishment', establishmentId });
}
