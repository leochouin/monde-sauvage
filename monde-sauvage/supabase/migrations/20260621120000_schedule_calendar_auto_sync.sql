-- Migration: Automate bidirectional Google Calendar sync for all guides
--
-- 1. Add calendar_last_auto_synced_at to guide (for UI "last auto-sync" status)
-- 2. Schedule a pg_cron job that invokes sync-all-guide-calendars every 15 min
--
-- Requires pg_cron + pg_net extensions (available on Supabase Pro plans) and
-- the app.settings.supabase_url / app.settings.service_role_key DB settings
-- (same convention as 20260219100000_schedule_calendar_health_check.sql).
--
-- If pg_cron is not available, this migration skips gracefully. In that case,
-- use an external scheduler to call: POST /functions/v1/sync-all-guide-calendars

-- ============================================================
-- 1. Track last automatic sync time per guide
-- ============================================================

ALTER TABLE guide
  ADD COLUMN IF NOT EXISTS calendar_last_auto_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN guide.calendar_last_auto_synced_at IS
  'Last time the scheduled sync-all-guide-calendars job synced this guide. Surfaced in the dashboard calendar UI.';

-- ============================================================
-- 2. Schedule the batch sync cron job (every 15 minutes)
-- ============================================================

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Replace any previous schedule so this migration is idempotent
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-all-guide-calendars') THEN
      PERFORM cron.unschedule('sync-all-guide-calendars');
    END IF;

    PERFORM cron.schedule(
      'sync-all-guide-calendars',
      '*/15 * * * *',
      $inner$SELECT net.http_post(url := current_setting('app.settings.supabase_url') || '/functions/v1/sync-all-guide-calendars', headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'), 'Content-Type', 'application/json'), body := '{}'::jsonb);$inner$
    );
    RAISE NOTICE 'sync-all-guide-calendars cron job scheduled (every 30 minutes)';
  ELSE
    RAISE NOTICE 'pg_cron not available — skipping cron schedule. Use an external scheduler instead.';
  END IF;
END $outer$;
