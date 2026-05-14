#!/usr/bin/env node

const SUPABASE_URL = process.env.AUDIT_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.AUDIT_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const AUTH_EMAIL = process.env.AUDIT_AUTH_EMAIL || process.env.AUTH_EMAIL || '';
const AUTH_PASSWORD = process.env.AUDIT_AUTH_PASSWORD || process.env.AUTH_PASSWORD || '';
const GUIDE_ID = process.env.AUDIT_GUIDE_ID || '';
const TRIP_TYPE = process.env.AUDIT_TRIP_TYPE || 'Fishing';

function jsonHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
    ...extra,
  };
}

function plusHoursIso(hoursFromNow) {
  return new Date(Date.now() + (hoursFromNow * 60 * 60 * 1000)).toISOString();
}

async function signInWithPassword() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      email: AUTH_EMAIL,
      password: AUTH_PASSWORD,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || `Auth failed (${response.status})`);
  }
  return data;
}

async function createBooking(accessToken, payload) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/guide_booking`, {
    method: 'POST',
    headers: jsonHeaders({
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'return=representation',
    }),
    body: JSON.stringify([payload]),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Insert failed (${response.status})`);
  }
  return data?.[0];
}

async function fetchBooking(accessToken, bookingId) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/guide_booking?id=eq.${encodeURIComponent(bookingId)}&select=id,guide_id,customer_email,status,is_paid,start_time,end_time`,
    {
      method: 'GET',
      headers: jsonHeaders({
        Authorization: `Bearer ${accessToken}`,
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Select failed (${response.status})`);
  }
  return data?.[0] || null;
}

async function cancelBooking(accessToken, bookingId) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/guide_booking?id=eq.${encodeURIComponent(bookingId)}`,
    {
      method: 'PATCH',
      headers: jsonHeaders({
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'return=representation',
      }),
      body: JSON.stringify({
        status: 'cancelled',
        notes: 'RLS smoke test cancellation',
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Update failed (${response.status})`);
  }
  return data?.[0] || null;
}

async function main() {
  const summary = {
    auditedAt: new Date().toISOString(),
    passed: false,
    skipped: false,
    checks: {
      authSuccess: false,
      insertAllowed: false,
      selectAllowed: false,
      updateAllowed: false,
      ownershipRespected: false,
    },
    context: {
      guideId: GUIDE_ID || null,
      authEmail: AUTH_EMAIL || null,
      createdBookingId: null,
    },
    errors: [],
    warnings: [],
  };

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !AUTH_EMAIL || !AUTH_PASSWORD || !GUIDE_ID) {
    summary.skipped = true;
    summary.errors.push(
      'Missing required env vars: AUDIT_SUPABASE_URL, AUDIT_SUPABASE_ANON_KEY, AUDIT_AUTH_EMAIL, AUDIT_AUTH_PASSWORD, AUDIT_GUIDE_ID'
    );
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exit(1);
  }

  try {
    const authData = await signInWithPassword();
    const accessToken = authData?.access_token;
    const userEmail = authData?.user?.email || AUTH_EMAIL;
    summary.checks.authSuccess = Boolean(accessToken);

    const start = plusHoursIso(48);
    const end = plusHoursIso(52);

    const inserted = await createBooking(accessToken, {
      guide_id: GUIDE_ID,
      start_time: start,
      end_time: end,
      status: 'pending',
      source: 'system',
      booking_origin: 'platform',
      customer_name: 'RLS Smoke Test',
      customer_email: userEmail,
      customer_phone: '555-000-0000',
      trip_type: TRIP_TYPE,
      number_of_people: 1,
      notes: 'Created by scripts/audit/guide-booking-rls-smoke.cjs',
      payment_status: 'unpaid',
      is_paid: false,
      application_fee: 0,
      platform_fee_amount: 0,
      platform_fee_waived: true,
    });
    summary.checks.insertAllowed = Boolean(inserted?.id);
    summary.context.createdBookingId = inserted?.id || null;

    const selected = await fetchBooking(accessToken, inserted.id);
    summary.checks.selectAllowed = Boolean(selected?.id);
    summary.checks.ownershipRespected = selected?.customer_email === userEmail;

    const updated = await cancelBooking(accessToken, inserted.id);
    summary.checks.updateAllowed = updated?.status === 'cancelled';

    summary.passed = Object.values(summary.checks).every(Boolean);
  } catch (error) {
    summary.errors.push(String(error?.message || error));
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.passed) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`[audit:booking-rls-smoke] fatal error: ${String(error)}\n`);
  process.exit(1);
});
