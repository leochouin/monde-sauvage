-- Migration: Schedule calendar health-check cron job
--
-- Requires pg_cron extension (available on Supabase Pro plans)
-- Runs every 6 hours to validate all guide Google Calendar tokens
--
-- If pg_cron is not available, this migration will skip gracefully.
-- In that case, use an external scheduler (e.g., GitHub Actions, Vercel Cron)
-- to call: POST /functions/v1/calendar-health-check

DO $outer$
BEGIN
  -- Check if pg_cron extension is available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Schedule health check every 6 hours
    PERFORM cron.schedule(
      'calendar-health-check',
      '0 */6 * * *',
      $inner$SELECT net.http_post(url := current_setting('app.settings.supabase_url') || '/functions/v1/calendar-health-check', headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'), 'Content-Type', 'application/json'), body := '{}'::jsonb);$inner$
    );
    RAISE NOTICE 'Calendar health-check cron job scheduled (every 6 hours)';
  ELSE
    RAISE NOTICE 'pg_cron not available — skipping cron schedule. Use an external scheduler instead.';
  END IF;
END $outer$;
