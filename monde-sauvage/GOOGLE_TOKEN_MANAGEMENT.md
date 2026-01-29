# Google Calendar Token Management

## Overview

This solution implements automatic detection and handling of expired Google Calendar refresh tokens for guides.

## Problem Solved

Previously, when a guide's Google Calendar refresh token expired, they would encounter errors but had no way to refresh it without manual database intervention. The token would remain in the database even after expiring, preventing re-authentication.

## Solution Components

### 1. **Token Expiry Tracking**
- **File**: `supabase/functions/google-calendar-oauth/index.ts`
- Stores `google_token_created_at` timestamp when refresh token is obtained
- Tracks when the token was issued for future reference

### 2. **Token Validation on Use**
- **File**: `supabase/functions/google-calendar-availability/index.ts`
- Detects `invalid_grant` errors when trying to use refresh token
- Automatically clears expired tokens from database
- Returns specific error response with `requiresReauth: true` flag

### 3. **Proactive Token Health Check**
- **File**: `supabase/functions/check-google-token/index.ts` (NEW)
- Edge function that validates token on guide login
- Tests refresh token by attempting to get access token
- Clears invalid tokens automatically
- Returns status indicating if re-authentication is needed

### 4. **UI Integration**
- **File**: `src/components/GuideCalendar.jsx`
- Shows user-friendly error message when token expires
- Provides "Reconnecter Google Calendar" button
- Automatically redirects to OAuth flow with return URL

- **File**: `src/App.jsx`
- Checks token validity when guide logs in
- Silent background check doesn't interrupt user experience
- Ensures token is valid before guide needs to use calendar

- **File**: `src/modals/guideModal.jsx`
- Checks token validity when guide modal opens
- Prepared for showing token status indicators

## How It Works

### On Login:
1. User logs in to the application
2. `App.jsx` fetches guide profile
3. If guide has `google_refresh_token`, calls `check-google-token` function
4. Function tests token validity with Google
5. If invalid, token is cleared from database
6. Guide will see "Connect Google Calendar" button

### When Using Calendar:
1. `GuideCalendar` component fetches events via `google-calendar-availability`
2. Function attempts to use refresh token
3. If Google returns `invalid_grant` error:
   - Token is cleared from database
   - Error response includes `requiresReauth: true`
   - UI shows reconnect button
4. Guide clicks "Reconnecter" button
5. Redirected through OAuth flow
6. New token stored with timestamp
7. Redirected back to original page

## Database Schema Changes

Add to your `guide` table:
```sql
ALTER TABLE guide 
ADD COLUMN google_token_created_at TIMESTAMPTZ;
```

## Edge Functions

### check-google-token
**Endpoint**: `/functions/v1/check-google-token?guideId={uuid}`

**Response**:
```json
{
  "valid": true/false,
  "requiresAuth": true/false,
  "message": "Status message"
}
```

### Configuration Files
- `config.toml` - Disables JWT verification
- `deno.json` - Deno runtime configuration

## Testing

1. **Test expired token**:
   - Manually set an invalid refresh token in database
   - Login as guide
   - Check that system detects and clears invalid token

2. **Test calendar fetch**:
   - Revoke app access in Google Account settings
   - Try to view calendar
   - Verify error message and reconnect button appear

3. **Test re-authentication**:
   - Click "Reconnecter Google Calendar"
   - Complete OAuth flow
   - Verify calendar loads successfully

## Deployment

1. Deploy all edge functions:
```bash
supabase functions deploy check-google-token
supabase functions deploy google-calendar-oauth
supabase functions deploy google-calendar-availability
```

2. Set required environment variables:
```bash
supabase secrets set GOOGLE_CLIENT_ID=your_client_id
supabase secrets set GOOGLE_CLIENT_SECRET=your_client_secret
```

3. Update database schema:
```sql
ALTER TABLE guide ADD COLUMN IF NOT EXISTS google_token_created_at TIMESTAMPTZ;
```

## Future Enhancements

- Add token expiry warning before it expires
- Implement automatic token refresh scheduling
- Add admin dashboard for token health monitoring
- Store token refresh history for debugging
