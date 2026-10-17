CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role TEXT,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT,
  before_data JSONB,
  after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_logs_created_at_idx
  ON public.activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_actor_created_at_idx
  ON public.activity_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_action_created_at_idx
  ON public.activity_logs (action, created_at DESC);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activity_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.activity_logs TO authenticated;
REVOKE ALL ON public.activity_logs FROM service_role;
GRANT SELECT, INSERT ON public.activity_logs TO service_role;
DROP POLICY IF EXISTS "web_admin_read_activity_logs" ON public.activity_logs;
CREATE POLICY "web_admin_read_activity_logs"
ON public.activity_logs FOR SELECT
USING (public.is_web_admin());

CREATE OR REPLACE FUNCTION public.activity_log_snapshot(table_name TEXT, row_data JSONB)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE table_name
    WHEN 'profiles' THEN jsonb_strip_nulls(jsonb_build_object(
      'id', row_data->'id',
      'name', row_data->'name',
      'role', row_data->'role',
      'status', row_data->'status',
      'student_id', row_data->'student_id',
      'teacher_id', row_data->'teacher_id',
      'grade_level', row_data->'grade_level',
      'section_id', row_data->'section_id',
      'department', row_data->'department',
      'relation', row_data->'relation'
    ))
    WHEN 'grades' THEN jsonb_strip_nulls(jsonb_build_object(
      'id', row_data->'id',
      'student_id', row_data->'student_id',
      'teacher_id', row_data->'teacher_id',
      'subject_id', row_data->'subject_id',
      'subject', row_data->'subject',
      'quarter', row_data->'quarter',
      'score', row_data->'score',
      'academic_year', row_data->'academic_year'
    ))
    WHEN 'attendance' THEN jsonb_strip_nulls(jsonb_build_object(
      'id', row_data->'id',
      'student_id', row_data->'student_id',
      'section_id', row_data->'section_id',
      'schedule_id', row_data->'schedule_id',
      'subject_id', row_data->'subject_id',
      'attendance_date', row_data->'attendance_date',
      'status', row_data->'status',
      'time_in', row_data->'time_in',
      'is_late', row_data->'is_late'
    ))
    WHEN 'schedules' THEN jsonb_strip_nulls(jsonb_build_object(
      'id', row_data->'id',
      'teacher_id', row_data->'teacher_id',
      'section_id', row_data->'section_id',
      'subject_id', row_data->'subject_id',
      'subject_name', row_data->'subject_name',
      'day', row_data->'day',
      'start_time', row_data->'start_time',
      'end_time', row_data->'end_time',
      'room', row_data->'room'
    ))
    WHEN 'system_settings' THEN jsonb_strip_nulls(jsonb_build_object(
      'key', row_data->'key',
      'value', row_data->'value'
    ))
    ELSE '{}'::JSONB
  END;
$$;

CREATE OR REPLACE FUNCTION public.write_activity_log()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  before_row JSONB;
  after_row JSONB;
  actor UUID := auth.uid();
  actor_current_role TEXT;
  action_name TEXT;
  affected_record_id TEXT;
BEGIN
  IF auth.role() = 'service_role' THEN
    IF TG_TABLE_NAME <> 'attendance' OR TG_OP <> 'INSERT' THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
    IF LOWER(COALESCE(NEW.status, '')) <> 'absent' THEN
      RETURN NEW;
    END IF;
  END IF;

  IF actor IS NOT NULL THEN
    SELECT role INTO actor_current_role FROM public.profiles WHERE id = actor;
  ELSIF auth.role() = 'service_role' THEN
    actor_current_role := 'SYSTEM';
  END IF;

  IF TG_OP <> 'INSERT' THEN
    before_row := public.activity_log_snapshot(TG_TABLE_NAME, to_jsonb(OLD));
  END IF;
  IF TG_OP <> 'DELETE' THEN
    after_row := public.activity_log_snapshot(TG_TABLE_NAME, to_jsonb(NEW));
  END IF;
  affected_record_id := COALESCE(after_row->>'id', before_row->>'id', after_row->>'key', before_row->>'key');

  IF TG_OP = 'UPDATE'
     AND TG_TABLE_NAME IN ('attendance', 'system_settings')
     AND before_row IS NOT DISTINCT FROM after_row THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'profiles' THEN
    IF TG_OP = 'INSERT' THEN
      action_name := 'account_created';
    ELSIF TG_OP = 'DELETE' THEN
      action_name := 'account_deleted';
    ELSIF OLD.role IS DISTINCT FROM NEW.role THEN
      action_name := 'role_changed';
    ELSIF OLD.status IS DISTINCT FROM NEW.status AND LOWER(COALESCE(NEW.status, '')) = 'inactive' THEN
      action_name := 'account_deactivated';
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      action_name := 'account_reactivated';
    ELSE
      action_name := 'account_updated';
    END IF;
  ELSIF TG_TABLE_NAME = 'grades' THEN
    action_name := CASE TG_OP
      WHEN 'INSERT' THEN 'grade_created'
      WHEN 'UPDATE' THEN 'grade_changed'
      ELSE 'grade_deleted'
    END;
  ELSIF TG_TABLE_NAME = 'attendance' THEN
    action_name := CASE
      WHEN TG_OP = 'INSERT' AND LOWER(COALESCE(NEW.status, '')) = 'absent' AND actor IS NULL THEN 'attendance_auto_marked_absent'
      WHEN TG_OP = 'INSERT' THEN 'attendance_recorded'
      WHEN TG_OP = 'UPDATE' THEN 'attendance_corrected'
      ELSE 'attendance_deleted'
    END;
  ELSIF TG_TABLE_NAME = 'schedules' THEN
    action_name := CASE TG_OP
      WHEN 'INSERT' THEN 'schedule_created'
      WHEN 'UPDATE' THEN 'schedule_changed'
      ELSE 'schedule_deleted'
    END;
  ELSE
    action_name := 'system_setting_changed';
  END IF;

  INSERT INTO public.activity_logs (
    actor_id, actor_role, action, table_name, record_id, before_data, after_data
  ) VALUES (
    actor, actor_current_role, action_name, TG_TABLE_NAME, affected_record_id, before_row, after_row
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.activity_log_snapshot(TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.write_activity_log() FROM PUBLIC;

DROP TRIGGER IF EXISTS profiles_write_activity_log ON public.profiles;
CREATE TRIGGER profiles_write_activity_log
AFTER INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.write_activity_log();

DROP TRIGGER IF EXISTS grades_write_activity_log ON public.grades;
CREATE TRIGGER grades_write_activity_log
AFTER INSERT OR UPDATE OR DELETE ON public.grades
FOR EACH ROW EXECUTE FUNCTION public.write_activity_log();

DROP TRIGGER IF EXISTS attendance_write_activity_log ON public.attendance;
CREATE TRIGGER attendance_write_activity_log
AFTER INSERT OR UPDATE OR DELETE ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.write_activity_log();

DROP TRIGGER IF EXISTS schedules_write_activity_log ON public.schedules;
CREATE TRIGGER schedules_write_activity_log
AFTER INSERT OR UPDATE OR DELETE ON public.schedules
FOR EACH ROW EXECUTE FUNCTION public.write_activity_log();

CREATE TABLE IF NOT EXISTS public.system_health_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component TEXT NOT NULL CHECK (component IN ('auto_absence', 'email_notifications', 'application')),
  status TEXT NOT NULL CHECK (status IN ('healthy', 'warning', 'error')),
  result TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS system_health_events_component_created_at_idx
  ON public.system_health_events (component, created_at DESC);
CREATE INDEX IF NOT EXISTS system_health_events_status_created_at_idx
  ON public.system_health_events (status, created_at DESC);

ALTER TABLE public.system_health_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.system_health_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.system_health_events TO authenticated;
REVOKE ALL ON public.system_health_events FROM service_role;
GRANT SELECT, INSERT ON public.system_health_events TO service_role;
DROP POLICY IF EXISTS "web_admin_read_system_health_events" ON public.system_health_events;
CREATE POLICY "web_admin_read_system_health_events"
ON public.system_health_events FOR SELECT
USING (public.is_web_admin());

CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY CHECK (key IN (
    'school_name', 'school_logo_url', 'school_year', 'academic_period',
    'auto_absent_grace_minutes', 'late_grace_minutes',
    'email_notifications_enabled', 'maintenance_announcement'
  )),
  value JSONB NOT NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.system_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.system_settings TO authenticated;
REVOKE ALL ON public.system_settings FROM service_role;
GRANT SELECT ON public.system_settings TO service_role;
DROP POLICY IF EXISTS "web_admin_manage_system_settings" ON public.system_settings;
CREATE POLICY "web_admin_manage_system_settings"
ON public.system_settings FOR ALL
USING (public.is_web_admin())
WITH CHECK (public.is_web_admin());

CREATE OR REPLACE FUNCTION public.is_active_authenticated_user()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND LOWER(COALESCE(status, 'active')) = 'inactive'
    );
$$;

REVOKE ALL ON FUNCTION public.is_active_authenticated_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_authenticated_user() TO authenticated;

DROP POLICY IF EXISTS "authenticated_read_late_grace_setting" ON public.system_settings;
CREATE POLICY "authenticated_read_late_grace_setting"
ON public.system_settings FOR SELECT TO authenticated
USING (
  key IN ('late_grace_minutes', 'maintenance_announcement', 'school_name', 'school_logo_url')
  AND public.is_active_authenticated_user()
);

CREATE OR REPLACE FUNCTION public.validate_system_setting()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SET search_path = public, pg_temp
AS $$
DECLARE
  setting_text TEXT;
BEGIN
  setting_text := NEW.value #>> '{}';
  IF NEW.key IN ('auto_absent_grace_minutes', 'late_grace_minutes') THEN
    IF jsonb_typeof(NEW.value) <> 'number'
       OR setting_text !~ '^[0-9]+$'
       OR setting_text::INTEGER NOT BETWEEN 0 AND 240 THEN
      RAISE EXCEPTION 'Grace period must be a whole number from 0 to 240 minutes.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.key = 'email_notifications_enabled' THEN
    IF jsonb_typeof(NEW.value) <> 'boolean' THEN
      RAISE EXCEPTION 'Email notifications setting must be a boolean.'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF jsonb_typeof(NEW.value) <> 'string' THEN
      RAISE EXCEPTION 'School settings must be text values.'
        USING ERRCODE = '23514';
    END IF;
    IF (NEW.key = 'school_name' AND length(setting_text) > 160)
       OR (NEW.key = 'school_year' AND length(setting_text) > 20)
       OR (NEW.key = 'academic_period' AND length(setting_text) > 40)
       OR (NEW.key = 'maintenance_announcement' AND length(setting_text) > 500)
       OR (NEW.key = 'school_logo_url' AND (
         length(setting_text) > 2048
         OR (setting_text <> '' AND setting_text !~* '^https://')
       )) THEN
      RAISE EXCEPTION 'System setting value exceeds its allowed format or length.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF auth.role() <> 'service_role' THEN
    NEW.updated_by := auth.uid();
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_system_setting() FROM PUBLIC;
DROP TRIGGER IF EXISTS system_settings_validate_value ON public.system_settings;
CREATE TRIGGER system_settings_validate_value
BEFORE INSERT OR UPDATE ON public.system_settings
FOR EACH ROW EXECUTE FUNCTION public.validate_system_setting();

DROP TRIGGER IF EXISTS system_settings_write_activity_log ON public.system_settings;
CREATE TRIGGER system_settings_write_activity_log
AFTER INSERT OR UPDATE OR DELETE ON public.system_settings
FOR EACH ROW EXECUTE FUNCTION public.write_activity_log();

CREATE TABLE IF NOT EXISTS public.system_backup_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL CHECK (status IN ('running', 'verified', 'failed')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  result TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (status = 'running' AND completed_at IS NULL AND verified_at IS NULL)
    OR (status = 'verified' AND completed_at IS NOT NULL AND verified_at IS NOT NULL)
    OR (status = 'failed' AND completed_at IS NOT NULL AND verified_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS system_backup_runs_created_at_idx
  ON public.system_backup_runs (created_at DESC);
ALTER TABLE public.system_backup_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.system_backup_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.system_backup_runs TO authenticated;
REVOKE ALL ON public.system_backup_runs FROM service_role;
GRANT SELECT, INSERT, UPDATE ON public.system_backup_runs TO service_role;
DROP POLICY IF EXISTS "web_admin_read_backup_history" ON public.system_backup_runs;
CREATE POLICY "web_admin_read_backup_history"
ON public.system_backup_runs FOR SELECT
USING (public.is_web_admin());

CREATE OR REPLACE FUNCTION public.protect_profile_roles()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_web_admin()
       AND (NEW.role NOT IN ('STUDENT', 'TEACHER', 'PARENT') OR NOT public.is_school_admin()) THEN
      RAISE EXCEPTION 'Only school administrators can create student, teacher, or parent profiles.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.role IS DISTINCT FROM OLD.role
       AND (NOT public.is_web_admin() OR auth.uid() = OLD.id) THEN
      RAISE EXCEPTION 'Only a Web Admin can change another user role.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT public.is_web_admin() THEN
      RAISE EXCEPTION 'Account status can only be changed by an authorized account-management service.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
