# Google Calendar Token Expiry - Quick Setup Guide

## What Was Fixed

Your guides can now automatically detect and refresh expired Google Calendar tokens without manual intervention.

## What You Need to Do

### 1. Run Database Migration

```sql
ALTER TABLE guide 
ADD COLUMN IF NOT EXISTS google_token_created_at TIMESTAMPTZ;
```

Or run the migration file:
```bash
# If using Supabase CLI
supabase db push

# Or manually in Supabase dashboard SQL editor
# Run: supabase/migrations/add_google_token_timestamp.sql
```

### 2. Deploy New Edge Function

```bash
# Deploy the new token checker function
supabase functions deploy check-google-token

# Redeploy updated functions
supabase functions deploy google-calendar-oauth
supabase functions deploy google-calendar-availability
```

### 3. Test the Flow

1. **Revoke access** in your Google Account: https://myaccount.google.com/permissions
2. **Login** as a guide in your app
3. **Open your guide profile** - should detect expired token
4. **Try to view calendar** - should show reconnect button
5. **Click "Reconnecter Google Calendar"** - should redirect to Google OAuth
6. **Complete OAuth** - should redirect back and calendar should work

## How It Works Now

**Before (Problem):**
- Token expires ❌
- Error shows but no way to fix ❌
- Token stays in database ❌
- Need manual intervention ❌

**After (Solution):**
- Token expires ✅
- System detects on login ✅
- Token auto-clears from database ✅
- UI shows reconnect button ✅
- Guide clicks button ✅
- OAuth flow refreshes token ✅
- Everything works again ✅

## Files Changed

- ✅ `supabase/functions/google-calendar-oauth/index.ts` - Stores token timestamp
- ✅ `supabase/functions/google-calendar-availability/index.ts` - Detects & clears expired tokens
- ✅ `supabase/functions/check-google-token/index.ts` - NEW: Proactive token validation
- ✅ `src/components/GuideCalendar.jsx` - Shows reconnect button on error
- ✅ `src/App.jsx` - Checks token on login
- ✅ `src/modals/guideModal.jsx` - Checks token when modal opens

## Environment Variables Required

Make sure these are set in Supabase:
```bash
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
URL=your_supabase_url
SERVICE_ROLE_KEY=your_service_role_key
```

## Production Checklist

- [ ] Database migration applied
- [ ] Edge functions deployed
- [ ] Environment variables confirmed
- [ ] Tested with expired token
- [ ] Tested OAuth reconnection flow
- [ ] Verified calendar loads after reconnection

## Support

See `GOOGLE_TOKEN_MANAGEMENT.md` for detailed documentation.
