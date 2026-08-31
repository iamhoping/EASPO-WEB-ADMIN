-- Run after deploying the auto-mark-absent Edge Function and setting
-- AUTO_ABSENT_TRIGGER_SECRET. Replace only YOUR_PROJECT_REF before applying.
-- This uses Supabase Cron + pg_net, so it runs independently of the web host.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- A short-lived claim prevents overlapping scheduler invocations from sending
-- the same Brevo notification simultaneously. Failed requests release it.
ALTER TABLE public.attendance
ADD COLUMN IF NOT EXISTS guardian_email_sending BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.attendance
ADD COLUMN IF NOT EXISTS guardian_email_sending_at TIMESTAMPTZ;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'auto-mark-absent-every-5-minutes';

SELECT cron.schedule(
  'auto-mark-absent-every-5-minutes',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/auto-mark-absent',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-auto-absent-secret', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'auto_absent_trigger_secret'
        )
      ),
      body := '{}'::jsonb
    );
  $$
);
