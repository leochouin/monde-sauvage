/**
 * Shared Stripe utilities for Supabase Edge Functions
 * 
 * Uses the Stripe REST API directly (no SDK needed in Deno).
 * All amounts are in cents (CAD).
 */

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Application fee percentage (10%)
export const APPLICATION_FEE_PERCENT = 0.10;

/**
 * Make an authenticated request to the Stripe API
 */
export async function stripeRequest(
  method: string,
  path: string,
  body?: Record<string, unknown> | URLSearchParams,
  stripeAccountId?: string
): Promise<Record<string, unknown>> {
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
  if (!STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY not configured");
  }

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Version": "2024-12-18.acacia",
  };

  // For connected account requests
  if (stripeAccountId) {
    headers["Stripe-Account"] = stripeAccountId;
  }

  const options: RequestInit = { method, headers };

  if (body && (method === "POST" || method === "DELETE")) {
    if (body instanceof URLSearchParams) {
      options.body = body.toString();
    } else {
      // Convert nested object to form-encoded params
      options.body = objectToFormParams(body).toString();
    }
  }

  const url = `https://api.stripe.com/v1${path}`;
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    console.error(`Stripe API error [${method} ${path}]:`, data);
    throw new StripeError(
      data.error?.message || "Stripe API error",
      data.error?.type || "api_error",
      response.status,
      data.error?.code
    );
  }

  return data;
}

/**
 * Convert a nested JS object to Stripe-style form params.
 * e.g. { metadata: { booking_id: "123" } } → "metadata[booking_id]=123"
 */
function objectToFormParams(
  obj: Record<string, unknown>,
  prefix?: string
): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(obj)) {
    const paramKey = prefix ? `${prefix}[${key}]` : key;

    if (value === null || value === undefined) continue;

    if (typeof value === "object" && !Array.isArray(value)) {
      const nested = objectToFormParams(value as Record<string, unknown>, paramKey);
      for (const [k, v] of nested.entries()) {
        params.append(k, v);
      }
    } else if (Array.isArray(value)) {
      value.forEach((item, _i) => {
        params.append(`${paramKey}[]`, String(item));
      });
    } else {
      params.append(paramKey, String(value));
    }
  }

  return params;
}

/**
 * Custom Stripe error class
 */
export class StripeError extends Error {
  type: string;
  statusCode: number;
  code?: string;

  constructor(message: string, type: string, statusCode: number, code?: string) {
    super(message);
    this.name = "StripeError";
    this.type = type;
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Calculate the total price for a booking with pricing rules.
 * Iterates day-by-day to apply per-night overrides.
 */
export function calculateTotalPrice(
  basePrice: number,
  startDate: string,
  endDate: string,
  pricingRules: Array<{
    rule_type: string;
    price_per_night: number;
    start_date?: string;
    end_date?: string;
    days_of_week?: number[];
    priority: number;
  }>
): { nights: number; pricePerNight: number; totalPrice: number; breakdown: Array<{ date: string; price: number; rule?: string }> } {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const breakdown: Array<{ date: string; price: number; rule?: string }> = [];

  let current = new Date(start);
  while (current < end) {
    const dateStr = current.toISOString().split("T")[0];
    const dayOfWeek = current.getDay(); // 0=Sun, 6=Sat

    // Find matching rules sorted by priority (highest first)
    let nightPrice = basePrice;
    let appliedRule: string | undefined;

    const sortedRules = [...pricingRules]
      .filter((r) => {
        if (r.rule_type === "seasonal" && r.start_date && r.end_date) {
          return dateStr >= r.start_date && dateStr <= r.end_date;
        }
        if (r.rule_type === "weekend" && r.days_of_week) {
          return r.days_of_week.includes(dayOfWeek);
        }
        if (r.rule_type === "holiday" && r.start_date && r.end_date) {
          return dateStr >= r.start_date && dateStr <= r.end_date;
        }
        return false;
      })
      .sort((a, b) => b.priority - a.priority);

    if (sortedRules.length > 0) {
      nightPrice = sortedRules[0].price_per_night;
      appliedRule = sortedRules[0].rule_type;
    }

    breakdown.push({ date: dateStr, price: nightPrice, rule: appliedRule });
    current.setDate(current.getDate() + 1);
  }

  const nights = breakdown.length;
  const totalPrice = breakdown.reduce((sum, b) => sum + b.price, 0);
  const pricePerNight = nights > 0 ? totalPrice / nights : basePrice;

  return { nights, pricePerNight, totalPrice, breakdown };
}

/**
 * Verify a Stripe webhook signature (HMAC-SHA256)
 */
export async function verifyWebhookSignature(
  payload: string,
  sigHeader: string,
  secret: string,
  tolerance = 300 // 5 minutes
): Promise<Record<string, unknown>> {
  const elements = sigHeader.split(",");
  let timestamp = "";
  const signatures: string[] = [];

  for (const element of elements) {
    const [key, value] = element.split("=");
    if (key === "t") timestamp = value;
    if (key === "v1") signatures.push(value);
  }

  if (!timestamp || signatures.length === 0) {
    throw new Error("Invalid webhook signature format");
  }

  // Check timestamp tolerance
  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > tolerance) {
    throw new Error("Webhook signature timestamp outside tolerance");
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const expectedSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison
  if (!signatures.some((s) => timingSafeEqual(s, expectedSig))) {
    throw new Error("Webhook signature verification failed");
  }

  return JSON.parse(payload);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Standard JSON error response
 */
export function errorResponse(message: string, status = 400) {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

/**
 * Standard JSON success response
 */
export function jsonResponse(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}
