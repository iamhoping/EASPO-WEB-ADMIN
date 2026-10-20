ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID,
  ADD COLUMN IF NOT EXISTS archived_by_name TEXT,
  ADD COLUMN IF NOT EXISTS archived_section_id TEXT;

CREATE INDEX IF NOT EXISTS profiles_archived_accounts_idx
  ON public.profiles (role, archived_at DESC)
  WHERE LOWER(COALESCE(status, '')) = 'archived';

CREATE OR REPLACE FUNCTION public.protect_profile_archive_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND (
    NEW.archive_reason IS DISTINCT FROM OLD.archive_reason
    OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
    OR NEW.archived_by IS DISTINCT FROM OLD.archived_by
    OR NEW.archived_by_name IS DISTINCT FROM OLD.archived_by_name
    OR NEW.archived_section_id IS DISTINCT FROM OLD.archived_section_id
  ) THEN
    RAISE EXCEPTION 'Archive metadata can only be changed by the authorized account-management service.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_archive_metadata ON public.profiles;
CREATE TRIGGER profiles_protect_archive_metadata
BEFORE UPDATE OF archive_reason, archived_at, archived_by, archived_by_name, archived_section_id
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_archive_metadata();

CREATE OR REPLACE FUNCTION public.is_school_admin()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'SCHOOL_ADMIN'
      AND LOWER(COALESCE(status, 'active')) NOT IN ('inactive', 'archived')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_web_admin()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'WEB_ADMIN'
      AND LOWER(COALESCE(status, 'active')) NOT IN ('inactive', 'archived')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_teacher()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'TEACHER'
      AND LOWER(COALESCE(status, 'active')) NOT IN ('inactive', 'archived')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_scanner()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'SCANNER'
      AND LOWER(COALESCE(status, 'active')) NOT IN ('inactive', 'archived')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_authenticated_user()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND LOWER(COALESCE(status, 'active')) IN ('inactive', 'archived')
    );
$$;

REVOKE ALL ON FUNCTION public.is_scanner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_scanner() TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_student_section_grade()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  section_grade INTEGER;
  student_grade INTEGER;
BEGIN
  IF NEW.role <> 'STUDENT' OR NEW.section_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF LOWER(COALESCE(NEW.status, 'active')) = 'archived' THEN
    RAISE EXCEPTION 'Archived students cannot be assigned to a section.'
      USING ERRCODE = '23514';
  END IF;

  SELECT grade_level INTO section_grade
  FROM public.sections
  WHERE id = NEW.section_id;

  student_grade := NULLIF(regexp_replace(COALESCE(NEW.grade_level, ''), '[^0-9]', '', 'g'), '')::INTEGER;
  IF section_grade IS NULL OR student_grade IS DISTINCT FROM section_grade THEN
    RAISE EXCEPTION 'Student grade level must match the section grade level.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_schedule_assignments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  teacher_role TEXT;
  teacher_status TEXT;
  section_grade INTEGER;
  subject_grade INTEGER;
BEGIN
  IF NEW.teacher_id IS NOT NULL THEN
    SELECT role, LOWER(COALESCE(status, 'active'))
      INTO teacher_role, teacher_status
    FROM public.profiles
    WHERE id = NEW.teacher_id;
    IF teacher_role IS DISTINCT FROM 'TEACHER'
       OR teacher_status IN ('inactive', 'archived') THEN
      RAISE EXCEPTION 'Schedules can only be assigned to active teacher accounts.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.section_id IS NOT NULL THEN
    SELECT grade_level INTO section_grade FROM public.sections WHERE id = NEW.section_id;
    IF section_grade IS NULL THEN
      RAISE EXCEPTION 'The selected section does not have a valid grade level.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.subject_id IS NOT NULL THEN
    SELECT grade_level INTO subject_grade
    FROM public.subjects
    WHERE id::TEXT = NEW.subject_id::TEXT;
    IF subject_grade IS NOT NULL
       AND section_grade IS NOT NULL
       AND subject_grade IS DISTINCT FROM section_grade THEN
      RAISE EXCEPTION 'The subject grade level must match the section grade level.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "scanner_view_scheduled_students" ON public.profiles;
CREATE POLICY "scanner_view_scheduled_students"
ON public.profiles FOR SELECT
USING (
  public.is_scanner()
  AND role = 'STUDENT'
  AND LOWER(COALESCE(status, 'active')) <> 'archived'
  AND EXISTS (SELECT 1 FROM public.schedules s WHERE s.section_id = profiles.section_id)
);

DROP POLICY IF EXISTS "scanner_scope_profiles_select" ON public.profiles;
CREATE POLICY "scanner_scope_profiles_select"
ON public.profiles AS RESTRICTIVE FOR SELECT
USING (
  NOT public.is_scanner()
  OR id = auth.uid()
  OR (
    role = 'STUDENT'
    AND LOWER(COALESCE(status, 'active')) <> 'archived'
    AND EXISTS (SELECT 1 FROM public.schedules s WHERE s.section_id = profiles.section_id)
  )
);

DROP POLICY IF EXISTS "scanner_view_current_attendance" ON public.attendance;
CREATE POLICY "scanner_view_current_attendance"
ON public.attendance FOR SELECT
USING (
  public.is_scanner()
  AND attendance_date::TEXT = TO_CHAR(NOW() AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD')
  AND EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = attendance.schedule_id
      AND s.section_id = attendance.section_id
      AND LOWER(TRIM(s.day)) = LOWER(TO_CHAR(NOW() AT TIME ZONE 'Asia/Manila', 'FMDay'))
  )
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = attendance.student_id
      AND p.role = 'STUDENT'
      AND LOWER(COALESCE(p.status, 'active')) <> 'archived'
      AND p.section_id = attendance.section_id
  )
);

DROP POLICY IF EXISTS "scanner_record_current_attendance" ON public.attendance;
CREATE POLICY "scanner_record_current_attendance"
ON public.attendance FOR INSERT
WITH CHECK (
  public.is_scanner()
  AND status = 'present'
  AND attendance_date::TEXT = TO_CHAR(NOW() AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD')
  AND EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = attendance.schedule_id
      AND s.section_id = attendance.section_id
      AND LOWER(TRIM(s.day)) = LOWER(TO_CHAR(NOW() AT TIME ZONE 'Asia/Manila', 'FMDay'))
  )
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = attendance.student_id
      AND p.role = 'STUDENT'
      AND LOWER(COALESCE(p.status, 'active')) <> 'archived'
      AND p.section_id = attendance.section_id
  )
);

DROP POLICY IF EXISTS "scanner_update_current_attendance" ON public.attendance;
CREATE POLICY "scanner_update_current_attendance"
ON public.attendance FOR UPDATE
USING (
  public.is_scanner()
  AND status = 'absent'
  AND attendance_date::TEXT = TO_CHAR(NOW() AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD')
  AND EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = attendance.schedule_id
      AND s.section_id = attendance.section_id
      AND LOWER(TRIM(s.day)) = LOWER(TO_CHAR(NOW() AT TIME ZONE 'Asia/Manila', 'FMDay'))
  )
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = attendance.student_id
      AND p.role = 'STUDENT'
      AND LOWER(COALESCE(p.status, 'active')) <> 'archived'
      AND p.section_id = attendance.section_id
  )
)
WITH CHECK (
  public.is_scanner()
  AND status = 'present'
  AND attendance_date::TEXT = TO_CHAR(NOW() AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD')
  AND EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = attendance.schedule_id
      AND s.section_id = attendance.section_id
      AND LOWER(TRIM(s.day)) = LOWER(TO_CHAR(NOW() AT TIME ZONE 'Asia/Manila', 'FMDay'))
  )
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = attendance.student_id
      AND p.role = 'STUDENT'
      AND LOWER(COALESCE(p.status, 'active')) <> 'archived'
      AND p.section_id = attendance.section_id
  )
);
