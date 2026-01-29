# Chalet Calendar Setup Guide

This guide explains how to set up and deploy the Google Calendar integration for chalets.

## Overview

The chalet calendar feature allows establishment owners to:
- Create Google Calendars for each chalet
- View booking events in an agenda view
- Auto-refresh events every 30 seconds while the modal is open
- Manage reservations directly in Google Calendar

## Prerequisites

1. **Google OAuth credentials** must be configured in Supabase
2. **User must have connected their Google account** (via the guide profile OAuth flow)
3. **Chalets table** must exist in your Supabase database

## Setup Steps

### 1. Run Database Migration

Apply the migration to add the `google_calendar` column to the Chalets table:

```bash
cd monde-sauvage
supabase db push
```

Or manually run the migration:

```bash
supabase migration up --file add_google_calendar_to_chalets.sql
```

### 2. Deploy Edge Functions

Deploy both edge functions to Supabase:

```bash
# Deploy the function to fetch calendar events
supabase functions deploy chalet-calendar-events

# Deploy the function to create new calendars
supabase functions deploy create-chalet-calendar
```

### 3. Configure Environment Variables

Ensure these environment variables are set in your Supabase project:

- `GOOGLE_CLIENT_ID` - Your Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Your Google OAuth client secret

These should already be configured if you're using the guide calendar OAuth.

## How It Works

### Data Flow

1. **User clicks "Gérer l'agenda"** on a chalet card
2. **Modal opens** and checks if the chalet has a `google_calendar` ID
3. **If no calendar exists:**
   - User sees a "Create Calendar" button
   - Clicking creates a new Google Calendar via the edge function
   - Calendar ID is saved to `chalets.google_calendar`
4. **If calendar exists:**
   - Events are fetched from Google Calendar API
   - Events display in a list format
   - Auto-refresh every 30 seconds

### Authentication

The system uses the **establishment owner's Google refresh token** (stored in the `guide` table) to:
- Create calendars on their behalf
- Fetch calendar events
- Ensure proper access control

### Edge Functions

#### `chalet-calendar-events`
- **Purpose:** Fetch events from a chalet's Google Calendar
- **Parameters:** `calendar_id`, `chalet_id`
- **Returns:** Array of calendar events

#### `create-chalet-calendar`
- **Purpose:** Create a new Google Calendar for a chalet
- **Parameters:** `chalet_id`, `chalet_name`
- **Returns:** `calendar_id` of the newly created calendar

## Usage

### For Establishment Owners

1. Navigate to your establishment modal
2. Find the chalet you want to manage
3. Click "Gérer l'agenda"
4. If first time: Click "Créer un calendrier"
5. View upcoming reservations
6. Click "Ouvrir dans Google Calendar" to manage in Google

### For Developers

The modal automatically:
- Refreshes events every 30 seconds
- Handles token refresh if needed
- Shows loading states
- Displays errors clearly

## Database Schema

The migration adds this column to the `Chalets` table:

```sql
google_calendar TEXT
```

This stores the Google Calendar ID for each chalet.

## Troubleshooting

### "No Google Calendar access" error
- **Cause:** Owner hasn't connected their Google account
- **Solution:** Go to guide profile and connect Google Calendar

### Events not loading
- **Check:** Owner's refresh token is still valid
- **Solution:** Reconnect Google account if token expired

### Calendar creation fails
- **Check:** Google OAuth credentials are correct
- **Check:** Owner has permission to create calendars

## Security Considerations

- Only the chalet's owner can create/view calendars
- Edge functions verify ownership via `Etablissement.owner_id`
- Refresh tokens are securely stored and never exposed to client
- Access tokens are generated server-side only

## Future Enhancements

Possible improvements:
- Add calendar events directly from the modal
- Display calendar events in a calendar grid view
- Send booking confirmations via email
- Sync reservations with payment system
