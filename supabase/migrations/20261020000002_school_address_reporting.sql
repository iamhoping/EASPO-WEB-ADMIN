BEGIN;

ALTER TABLE public.system_settings
  DROP CONSTRAINT IF EXISTS system_settings_key_check;

ALTER TABLE public.system_settings
  ADD CONSTRAINT system_settings_key_check CHECK (key IN (
    'school_name', 'school_address', 'school_logo_url', 'school_year', 'academic_period',
    'auto_absent_grace_minutes', 'late_grace_minutes',
    'email_notifications_enabled', 'maintenance_announcement'
  ));

ALTER TABLE public.system_settings
  DROP CONSTRAINT IF EXISTS system_settings_school_address_length_check;

ALTER TABLE public.system_settings
  ADD CONSTRAINT system_settings_school_address_length_check CHECK (
    key <> 'school_address'
    OR (jsonb_typeof(value) = 'string' AND length(value #>> '{}') <= 300)
  );

DROP POLICY IF EXISTS "authenticated_read_late_grace_setting" ON public.system_settings;
CREATE POLICY "authenticated_read_late_grace_setting"
ON public.system_settings FOR SELECT TO authenticated
USING (
  key IN ('late_grace_minutes', 'maintenance_announcement', 'school_name', 'school_address', 'school_logo_url')
  AND public.is_active_authenticated_user()
);

CREATE OR REPLACE FUNCTION public.get_public_school_branding()
RETURNS TABLE (key TEXT, value JSONB)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT settings.key, settings.value
  FROM public.system_settings AS settings
  WHERE settings.key IN ('school_name', 'school_address', 'school_logo_url', 'maintenance_announcement');
$$;

COMMIT;
