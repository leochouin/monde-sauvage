# Vercel Deployment Configuration

## 🔧 Required Configuration Steps

### 1. Vercel Environment Variables

Go to your Vercel project settings → Environment Variables and add:

```bash
# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key

# Mapbox (this fixes the Mapbox error)
VITE_MAPBOX_TOKEN=pk.eyJ1IjoibGVvY2hvdWluYXJkIiwiYSI6ImNtZmltbnYwbzBvNnUycW9zMWZ1ZHB4dGUifQ.-WHGlNmEXAleoIE4-nkKSA

# Stripe
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_key
```

**Important:** Add these for all environments (Production, Preview, Development)

### 2. Supabase Authentication Configuration

To fix the authentication redirect issue:

#### A. Add Vercel Domain to Supabase Auth

1. Go to Supabase Dashboard → Authentication → URL Configuration
2. Add your Vercel domain to **Redirect URLs**:
   ```
   https://your-project.vercel.app
   https://your-project.vercel.app/**
   ```
3. Also add preview deployment pattern:
   ```
   https://*.vercel.app
   https://*.vercel.app/**
   ```

#### B. Set Site URL

In Supabase Dashboard → Authentication → URL Configuration:
- **Site URL**: `https://your-project.vercel.app`

### 3. Supabase Edge Function Secrets

Set the following secrets for Supabase Edge Functions:

```bash
# Navigate to monde-sauvage directory
cd monde-sauvage

# Set Stripe secrets
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Set frontend URL to your Vercel domain (fixes redirect issues)
npx supabase secrets set FRONTEND_URL=https://your-project.vercel.app

# Google Calendar credentials (if using Google Calendar integration)
npx supabase secrets set GOOGLE_CLIENT_ID=your-google-client-id
npx supabase secrets set GOOGLE_CLIENT_SECRET=your-google-client-secret
npx supabase secrets set GOOGLE_REDIRECT_URI=https://your-project.supabase.co/functions/v1/google-calendar-oauth-callback
```

### 4. Re-deploy Supabase Functions

After setting the secrets, re-deploy all functions:

```bash
npx supabase functions deploy google-calendar-availability
npx supabase functions deploy google-calendar-availability-all
npx supabase functions deploy google-calendar-oauth
npx supabase functions deploy create-guide-booking-event
npx supabase functions deploy update-guide-booking-event
npx supabase functions deploy delete-guide-booking-event
npx supabase functions deploy sync-guide-calendar
npx supabase functions deploy stripe-vendor-onboard
npx supabase functions deploy stripe-onboard-return
npx supabase functions deploy stripe-create-booking
npx supabase functions deploy stripe-webhook
npx supabase functions deploy stripe-refund-booking
```

### 5. Stripe Webhook Configuration

Update your Stripe webhook endpoint to point to Vercel:

1. Go to Stripe Dashboard → Developers → Webhooks
2. Update webhook endpoint URL:
   ```
   https://your-project.supabase.co/functions/v1/stripe-webhook
   ```
3. Select these events:
   - `checkout.session.completed`
   - `account.updated`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`

## 🚀 Deployment Workflow

Every time you push to `main`:
1. Vercel automatically deploys the frontend
2. If you changed Supabase functions, manually deploy them
3. If you changed database schema, run migrations:
   ```bash
   npx supabase db push
   ```

## ✅ Verification

After configuration:

1. **Test Mapbox**: Open your Vercel site, map should load without errors
2. **Test Auth**: Sign in/sign up should work and redirect correctly
3. **Test Stripe**: Onboarding and checkout flows should redirect properly
4. **Check Console**: No error messages about missing tokens or failed redirects

## 🔍 Troubleshooting

### Mapbox "API access token required" error
- **Cause**: `VITE_MAPBOX_TOKEN` not set in Vercel
- **Fix**: Add the environment variable in Vercel settings

### Auth redirect returns to wrong URL
- **Cause**: Vercel domain not added to Supabase allowed URLs
- **Fix**: Add your Vercel domain to Supabase Auth configuration

### Stripe onboarding redirects to localhost
- **Cause**: `FRONTEND_URL` secret not set in Supabase
- **Fix**: Run `npx supabase secrets set FRONTEND_URL=https://your-project.vercel.app`

### Preview deployments have different URLs
- Use wildcard pattern `https://*.vercel.app` in Supabase Auth
- Or use relative redirects where possible
