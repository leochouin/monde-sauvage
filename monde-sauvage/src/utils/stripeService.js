/**
 * Stripe Payment Service
 * 
 * Handles all Stripe-related operations from the frontend:
 * - Vendor onboarding (Stripe Connect)
 * - Booking creation with PaymentIntent
 * - Refund requests
 * - Onboarding status checks
 */
import supabase from './supabase.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Make an authenticated request to a Supabase Edge Function
 */
async function callEdgeFunction(functionName, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
  };

  // Add auth header if user is logged in
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${SUPABASE_URL}/functions/v1/${functionName}`;
  
  const response = await fetch(url, {
    method: options.method || 'POST',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Edge function error: ${response.status}`);
  }

  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// VENDOR ONBOARDING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start Stripe Connect onboarding for a vendor (establishment).
 * Creates a Stripe Express account and returns the onboarding URL.
 * 
 * @param {string} establishmentId - The establishment UUID
 * @returns {Promise<{url: string, stripeAccountId: string}>}
 */
export async function startVendorOnboarding(establishmentId) {
  console.log('🏪 Starting Stripe onboarding for establishment:', establishmentId);
  
  const result = await callEdgeFunction('stripe-vendor-onboard', {
    body: { establishmentId },
  });

  console.log('✅ Onboarding URL received');
  return result;
}

/**
 * Start Stripe Connect onboarding for a guide.
 * Creates a Stripe Express account and returns the onboarding URL.
 * 
 * @param {string} guideId - The guide UUID
 * @returns {Promise<{url: string, stripeAccountId: string}>}
 */
export async function startGuideOnboarding(guideId) {
  console.log('🎣 Starting Stripe onboarding for guide:', guideId);
  
  const result = await callEdgeFunction('stripe-vendor-onboard', {
    body: { guideId },
  });

  console.log('✅ Onboarding URL received');
  return result;
}

/**
 * Check the vendor's Stripe onboarding status after returning from Stripe.
 * 
 * @param {string} establishmentId - The establishment UUID
 * @returns {Promise<{chargesEnabled: boolean, payoutsEnabled: boolean, onboardingComplete: boolean}>}
 */
export async function checkOnboardingStatus(establishmentId) {
  console.log('🔍 Checking onboarding status for:', establishmentId);

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const url = `${SUPABASE_URL}/functions/v1/stripe-onboard-return?establishmentId=${establishmentId}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to check onboarding status');
  }

  return data;
}

/**
 * Create a temporary login link to the Stripe Express dashboard for a guide.
 * The link is single-use and opens the guide's connected account dashboard.
 * 
 * @param {string} guideId - The guide UUID
 * @returns {Promise<{url: string}>}
 */
export async function createGuideDashboardLink(guideId) {
  console.log('🔗 Creating Stripe dashboard link for guide:', guideId);

  const result = await callEdgeFunction('stripe-dashboard-link', {
    body: { guideId },
  });

  console.log('✅ Dashboard link created');
  return result;
}

/**
 * Check the guide's Stripe onboarding status after returning from Stripe.
 * 
 * @param {string} guideId - The guide UUID
 * @returns {Promise<{chargesEnabled: boolean, payoutsEnabled: boolean, onboardingComplete: boolean}>}
 */
export async function checkGuideOnboardingStatus(guideId) {
  console.log('🔍 Checking guide onboarding status for:', guideId);

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const url = `${SUPABASE_URL}/functions/v1/stripe-onboard-return?guideId=${guideId}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Failed to check onboarding status');
  }

  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOKING & PAYMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a chalet booking and payment intent.
 * Returns the client_secret needed to confirm payment on the frontend.
 * 
 * @param {Object} bookingData
 * @param {string} bookingData.chaletId - Chalet UUID
 * @param {string} bookingData.startDate - YYYY-MM-DD
 * @param {string} bookingData.endDate - YYYY-MM-DD
 * @param {string} bookingData.customerName
 * @param {string} bookingData.customerEmail
 * @param {string} [bookingData.notes]
 * @returns {Promise<{bookingId, clientSecret, stripeAccountId, pricing}>}
 */
export async function createBookingWithPayment(bookingData) {
  console.log('💳 Creating chalet booking with payment:', bookingData);

  const result = await callEdgeFunction('stripe-create-booking', {
    body: { ...bookingData, bookingType: 'chalet' },
  });

  console.log('✅ Booking created:', result.bookingId);
  console.log('💰 Pricing:', result.pricing);

  return result;
}

/**
 * Create a guide booking and payment intent.
 * Returns the client_secret needed to confirm payment on the frontend.
 * 
 * @param {Object} bookingData
 * @param {string} bookingData.guideId - Guide UUID
 * @param {string} bookingData.startTime - ISO datetime
 * @param {string} bookingData.endTime - ISO datetime
 * @param {string} bookingData.customerName
 * @param {string} bookingData.customerEmail
 * @param {string} [bookingData.customerPhone]
 * @param {string} [bookingData.tripType]
 * @param {number} [bookingData.numberOfPeople]
 * @param {string} [bookingData.notes]
 * @returns {Promise<{bookingId, clientSecret, stripeAccountId, pricing}>}
 */
export async function createGuideBookingWithPayment(bookingData) {
  console.log('💳 Creating guide booking with payment:', bookingData);

  const result = await callEdgeFunction('stripe-create-booking', {
    body: { ...bookingData, bookingType: 'guide' },
  });

  console.log('✅ Guide booking created:', result.bookingId);
  console.log('💰 Pricing:', result.pricing);

  return result;
}

/**
 * Resume payment for an existing pending booking (from cart).
 * Retrieves or creates a PaymentIntent and extends the expiry.
 *
 * @param {string} bookingId - Existing booking UUID
 * @returns {Promise<{bookingId, clientSecret, stripeAccountId, pricing, expiresAt}>}
 */
export async function resumeBookingPayment(bookingId) {
  console.log('🔄 Resuming payment for booking:', bookingId);

  const result = await callEdgeFunction('resume-booking-payment', {
    body: { bookingId },
  });

  console.log('✅ Payment resumed:', result.bookingId);
  return result;
}

/**
 * Create a payment link for an admin/guide-created booking.
 * Returns a URL that can be sent to the client.
 * The booking is created in 'pending_payment' status and only confirmed
 * when the client completes payment.
 * 
 * @param {Object} bookingData
 * @param {string} bookingData.guideId
 * @param {string} bookingData.startTime - ISO datetime
 * @param {string} bookingData.endTime - ISO datetime
 * @param {string} bookingData.customerName
 * @param {string} bookingData.customerEmail
 * @param {string} [bookingData.customerPhone]
 * @param {string} [bookingData.tripType]
 * @param {number} [bookingData.numberOfPeople]
 * @param {string} [bookingData.notes]
 * @returns {Promise<{bookingId, paymentLinkUrl, expiresAt, pricing}>}
 */
export async function createPaymentLink(bookingData) {
  console.log('🔗 Creating payment link for guide booking:', bookingData);

  const result = await callEdgeFunction('stripe-create-payment-link', {
    body: bookingData,
  });

  console.log('✅ Payment link created:', result.paymentLinkUrl);
  return result;
}

/**
 * Request a refund for a booking.
 * 
 * @param {string} bookingId - Booking UUID
 * @param {string} [reason] - Reason for refund
 * @param {number} [amount] - Partial refund amount in CAD (omit for full refund)
 * @returns {Promise<{refundId, refundAmount, isFullRefund}>}
 */
export async function refundBooking(bookingId, reason, amount) {
  console.log('💸 Requesting refund for booking:', bookingId);

  const result = await callEdgeFunction('stripe-refund-booking', {
    body: { bookingId, reason, amount },
  });

  console.log('✅ Refund processed:', result.refundId);
  return result;
}

/**
 * Fallback: verify payment with Stripe and update DB.
 * Called by the frontend after confirmPayment() succeeds, in case the
 * webhook is delayed. Idempotent — safe to call multiple times.
 *
 * @param {string} bookingId - Booking UUID
 * @param {string} bookingType - "chalet" or "guide"
 * @param {string} [paymentIntentId] - Optional PI id (looked up from DB if omitted)
 * @returns {Promise<{confirmed: boolean}>}
 */
export async function confirmBookingPayment(bookingId, bookingType = 'chalet', paymentIntentId) {
  try {
    const result = await callEdgeFunction('confirm-booking-payment', {
      body: { bookingId, bookingType, paymentIntentId },
    });
    console.log('🔒 Payment confirmation fallback:', result);
    return result;
  } catch (err) {
    // Non-fatal — the webhook should still handle it
    console.warn('⚠️ Payment confirmation fallback failed (webhook should handle it):', err.message);
    return { confirmed: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the Stripe publishable key from environment
 */
export function getStripePublishableKey() {
  return import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
}

/**
 * Load the Stripe.js library dynamically.
 * Returns the Stripe instance configured for the platform.
 */
let stripePromise = null;
export function getStripe() {
  if (!stripePromise) {
    const key = getStripePublishableKey();
    if (!key) {
      console.error('VITE_STRIPE_PUBLISHABLE_KEY is not set');
      return null;
    }
    // Stripe.js is loaded via <script> tag in index.html
    // This returns the initialized Stripe instance
    stripePromise = globalThis.Stripe ? Promise.resolve(globalThis.Stripe(key)) : null;
  }
  return stripePromise;
}

/**
 * Format a price in CAD for display
 */
export function formatPrice(amount) {
  return new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(amount);
}
