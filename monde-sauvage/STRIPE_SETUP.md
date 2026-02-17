# Stripe Connect Integration — Setup & Testing Guide

## Overview

Multi-vendor payment system using **Stripe Connect Express** with **direct charges**.
Money goes directly to the vendor's Stripe account, and the platform takes a **10% application fee** automatically.

**Currency:** CAD | **Mode:** Test

---

## Architecture

```
Customer → Stripe Elements → PaymentIntent (direct charge)
                                    ↓
                             Vendor's Stripe Account (90%)
                             Platform Account (10% fee)
                                    ↓
                             Webhook → confirms booking in DB
```

### Files Created

| File | Purpose |
|------|---------|
| `supabase/migrations/20260213100000_add_stripe_connect_tables.sql` | DB schema: vendors, bookings payment fields, pricing rules |
| `supabase/functions/_shared/stripeUtils.ts` | Shared Stripe utilities (API calls, webhook verification, pricing) |
| `supabase/functions/stripe-vendor-onboard/index.ts` | Creates Stripe Express account + onboarding URL |
| `supabase/functions/stripe-onboard-return/index.ts` | Checks onboarding status after return |
| `supabase/functions/stripe-create-booking/index.ts` | Creates booking + PaymentIntent with 10% app fee |
| `supabase/functions/stripe-webhook/index.ts` | Handles payment confirmations, failures, refunds |
| `supabase/functions/stripe-refund-booking/index.ts` | Processes full/partial refunds |
| `src/utils/stripeService.js` | Frontend Stripe service (API calls) |
| `src/modals/checkoutModal.jsx` | Stripe Elements payment form modal |
| `src/modals/stripeOnboarding.jsx` | Vendor onboarding component |
| `src/modals/checkoutModal.css` | Checkout modal styles |
| `src/modals/stripeOnboarding.css` | Onboarding component styles |

### Files Modified

| File | Change |
|------|--------|
| `index.html` | Added Stripe.js `<script>` tag |
| `src/modals/chaletDetailModal.jsx` | Integrated CheckoutModal (pay on reserve) |
| `src/modals/etablissementModal.jsx` | Added StripeOnboarding section |
| `supabase/config.toml` | Added JWT-skip config for Stripe functions |

---

## Setup Instructions

### 1. Stripe Account Setup

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com) and create an account (or log into your existing one)
2. Enable **Test Mode** — toggle the switch in the **top-right corner** of the dashboard. It should say "Test mode" with an orange badge
3. Enable **Connect**:
   - Click the ⚙️ **Settings** gear icon (bottom-left)
   - In the left sidebar, find **Connect** → **Settings**
   - Click **Get started** or make sure Connect is enabled
   - Under "Account types", make sure **Express** is checked
4. *(Optional)* Set your platform name/icon under **Connect → Branding**

### 2. Get Your API Keys

> You need **3 keys total**: a publishable key, a secret key, and a webhook signing secret.

**Step A — Get the publishable key and secret key:**

1. In the Stripe Dashboard, make sure **Test mode** is ON (orange toggle, top-right)
2. Click **Developers** in the top navigation bar (or go directly to [dashboard.stripe.com/test/apikeys](https://dashboard.stripe.com/test/apikeys))
3. You'll see two keys:
- **Publishable key** — starts with `pk_test_...` — this goes in your frontend `.env` file
- **Secret key** — starts with `sk_test_...` — click "Reveal test key" to copy it — this goes in Supabase secrets (never in frontend code!)

**Step B — Get the webhook signing secret** (do this after step 6 below, but listed here for reference):

1. Go to **Developers → Webhooks** (or [dashboard.stripe.com/test/webhooks](https://dashboard.stripe.com/test/webhooks))
2. Click **Add endpoint**
3. Set the endpoint URL to: `https://YOUR-PROJECT.supabase.co/functions/v1/stripe-webhook`
4. Under "Select events", click **+ Select events** and choose:
- `payment_intent.succeeded`  
- `payment_intent.payment_failed`
- `account.updated`
- `charge.refunded`
5. Click **Add endpoint**
6. On the endpoint detail page, find **Signing secret** and click to reveal it — starts with `whsec_...`
7. Copy this value — it goes in Supabase secrets as `STRIPE_WEBHOOK_SECRET`

### 3. Set Environment Variables

**Frontend (`.env` file in the `monde-sauvage/` folder):**
```bash
# Copy from Stripe Dashboard → Developers → API keys → Publishable key
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_key_here
```

**Supabase Edge Functions (set as secrets — NOT in `.env`):**
```bash
cd monde-sauvage

# Secret key from Stripe Dashboard → Developers → API keys → Secret key
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_your_key_here

# Webhook signing secret from Stripe Dashboard → Developers → Webhooks → your endpoint
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Your frontend URL (use localhost for dev, your real domain for production)
npx supabase secrets set FRONTEND_URL=http://localhost:5173
```

### 4. Run Database Migration

```bash
cd monde-sauvage
npx supabase db push
```

### 5. Deploy Edge Functions

```bash
npx supabase functions deploy stripe-vendor-onboard
npx supabase functions deploy stripe-onboard-return
npx supabase functions deploy stripe-create-booking
npx supabase functions deploy stripe-webhook
npx supabase functions deploy stripe-refund-booking
```

### 6. Set Up Webhook

> Detailed instructions are in **Step 2B** above. Quick summary:

1. Go to [dashboard.stripe.com/test/webhooks](https://dashboard.stripe.com/test/webhooks)
2. Add endpoint URL: `https://YOUR-PROJECT.supabase.co/functions/v1/stripe-webhook`
3. Select the 4 events listed in Step 2B
4. Copy the signing secret and run:
```bash
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_your_signing_secret
```

For **Connect events** (`account.updated`), also add the same endpoint URL under
**Settings → Connect → Webhooks** in the Stripe Dashboard.

---

## Testing

### Test Cards

| Card Number | Result |
|-------------|--------|
| `4242 4242 4242 4242` | Succeeds |
| `4000 0000 0000 3220` | 3D Secure required |
| `4000 0000 0000 9995` | Declined (insufficient funds) |
| `4000 0000 0000 0002` | Declined (generic) |

Use any future expiry date and any 3-digit CVC.

### Test Flow

#### A. Vendor Onboarding
1. Log in as a vendor (establishment owner)
2. Open your establishment settings
3. Click **"Configurer les paiements"** in the Stripe section
4. Complete Stripe onboarding (use test data)
5. Return to the app — status should show ✅

#### B. Customer Booking
1. Browse chalets on the map
2. Click a chalet → select dates → fill in name/email
3. Click **"Réserver et payer"**
4. Enter test card `4242 4242 4242 4242`
5. Payment succeeds → booking is confirmed

#### C. Refund
Refunds can be triggered via the API:
```javascript
import { refundBooking } from './src/utils/stripeService.js';

// Full refund
await refundBooking('booking-uuid', 'customer request');

// Partial refund ($50 CAD)
await refundBooking('booking-uuid', 'partial cancellation', 50);
```

### Local Webhook Testing

For local development, use the Stripe CLI to forward webhooks:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to your local Supabase
stripe listen --forward-to http://localhost:54321/functions/v1/stripe-webhook

# Use the provided signing secret for local testing
```

---

## How It Works

### Direct Charges Flow

```
1. Customer selects dates, fills form
2. Frontend calls stripe-create-booking edge function
3. Edge function:
   a. Validates availability
   b. Calculates price (base + pricing rules)
   c. Creates booking record (status: pending)
   d. Creates PaymentIntent on VENDOR's connected account
   e. Sets 10% application_fee_amount
   f. Returns client_secret
4. Frontend uses Stripe Elements to collect card
5. Customer confirms payment
6. Stripe processes payment:
   - 90% → vendor's bank account
   - 10% → platform account
7. Webhook confirms → booking status → "confirmed"
```

### Pricing Rules

The system supports dynamic pricing beyond the base rate:

- **Seasonal**: Higher rates during peak season (date range)
- **Weekend**: Different rates for Fri/Sat nights
- **Holiday**: Special rates for holidays

Rules are applied per-night and the highest-priority matching rule wins.

---

## Database Schema

### New columns on `Etablissement`
- `stripe_account_id` — Stripe Connect account ID
- `stripe_onboarding_complete` — Boolean
- `stripe_charges_enabled` — Can accept payments
- `stripe_payouts_enabled` — Can receive payouts

### New columns on `bookings`
- `stripe_payment_intent_id` — PaymentIntent ID
- `total_price` — Total in CAD
- `nights` — Number of nights
- `price_per_night` — Rate snapshot
- `application_fee` — Platform fee (10%)
- `payment_status` — unpaid/processing/paid/refunded/failed
- `refund_amount` — Amount refunded
- `stripe_refund_id` — Refund ID
- `user_id` — Authenticated user

### New tables
- `pricing_rules` — Seasonal/weekend/holiday rate overrides
- `stripe_webhook_events` — Idempotent webhook processing
