CREATE OR REPLACE FUNCTION public.is_school_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'SCHOOL_ADMIN'
      AND LOWER(COALESCE(status, 'active')) <> 'inactive'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_web_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'WEB_ADMIN'
      AND LOWER(COALESCE(status, 'active')) <> 'inactive'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_teacher()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'TEACHER'
      AND LOWER(COALESCE(status, 'active')) <> 'inactive'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_scanner()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'SCANNER'
      AND LOWER(COALESCE(status, 'active')) <> 'inactive'
  );
$$;

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

REVOKE ALL ON FUNCTION public.is_school_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_web_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_teacher() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_scanner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_authenticated_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_school_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_web_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_teacher() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_scanner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_authenticated_user() TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_profile_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
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
    IF NEW.role IS DISTINCT FROM OLD.role AND auth.role() <> 'service_role' THEN
      RAISE EXCEPTION 'Profile roles can only be changed by the authorized role-management service.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND auth.role() <> 'service_role' THEN
      RAISE EXCEPTION 'Account status can only be changed by the authorized account-management service.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_roles ON public.profiles;
CREATE TRIGGER profiles_protect_roles
BEFORE INSERT OR UPDATE OF role, status ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_roles();

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

DROP TRIGGER IF EXISTS profiles_validate_section_grade ON public.profiles;
CREATE TRIGGER profiles_validate_section_grade
BEFORE INSERT OR UPDATE OF role, grade_level, section_id ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.validate_student_section_grade();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.validate_section_grade_assignments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.grade_level IS DISTINCT FROM OLD.grade_level AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.role = 'STUDENT'
      AND p.section_id = NEW.id
      AND NULLIF(regexp_replace(COALESCE(p.grade_level, ''), '[^0-9]', '', 'g'), '')::INTEGER
          IS DISTINCT FROM NEW.grade_level
  ) THEN
    RAISE EXCEPTION 'A section grade level cannot change while assigned students have a different grade level.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sections_validate_student_grades ON public.sections;
CREATE TRIGGER sections_validate_student_grades
BEFORE UPDATE OF grade_level ON public.sections
FOR EACH ROW
EXECUTE FUNCTION public.validate_section_grade_assignments();

CREATE OR REPLACE FUNCTION public.validate_schedule_assignments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  teacher_role TEXT;
  section_grade INTEGER;
  subject_grade INTEGER;
BEGIN
  IF NEW.teacher_id IS NOT NULL THEN
    SELECT role INTO teacher_role FROM public.profiles WHERE id = NEW.teacher_id;
    IF teacher_role IS DISTINCT FROM 'TEACHER' THEN
      RAISE EXCEPTION 'Schedules can only be assigned to teacher accounts.'
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

DROP TRIGGER IF EXISTS schedules_validate_assignments ON public.schedules;
CREATE TRIGGER schedules_validate_assignments
BEFORE INSERT OR UPDATE OF teacher_id, section_id, subject_id ON public.schedules
FOR EACH ROW
EXECUTE FUNCTION public.validate_schedule_assignments();

DROP POLICY IF EXISTS "school_admin_read_school_profiles" ON public.profiles;
CREATE POLICY "school_admin_read_school_profiles"
ON public.profiles FOR SELECT
USING (
  public.is_school_admin()
  AND (id = auth.uid() OR role IN ('STUDENT', 'TEACHER', 'PARENT'))
);

DROP POLICY IF EXISTS "web_admin_manage_profiles" ON public.profiles;
CREATE POLICY "web_admin_manage_profiles"
ON public.profiles FOR ALL
USING (public.is_web_admin())
WITH CHECK (public.is_web_admin());

DROP POLICY IF EXISTS "scanner_view_scheduled_students" ON public.profiles;
CREATE POLICY "scanner_view_scheduled_students"
ON public.profiles FOR SELECT
USING (
  public.is_scanner()
  AND role = 'STUDENT'
  AND EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.section_id = profiles.section_id
  )
);

DROP POLICY IF EXISTS "school_admin_create_school_profiles" ON public.profiles;
CREATE POLICY "school_admin_create_school_profiles"
ON public.profiles FOR INSERT
WITH CHECK (
  public.is_school_admin()
  AND role IN ('STUDENT', 'TEACHER', 'PARENT')
);

DROP POLICY IF EXISTS "school_admin_update_school_profiles" ON public.profiles;
CREATE POLICY "school_admin_update_school_profiles"
ON public.profiles FOR UPDATE
USING (public.is_school_admin() AND role IN ('STUDENT', 'TEACHER', 'PARENT'))
WITH CHECK (public.is_school_admin() AND role IN ('STUDENT', 'TEACHER', 'PARENT'));

DROP POLICY IF EXISTS "school_admin_scope_profiles_select" ON public.profiles;
CREATE POLICY "school_admin_scope_profiles_select"
ON public.profiles AS RESTRICTIVE FOR SELECT
USING (
  NOT public.is_school_admin()
  OR id = auth.uid() OR role IN ('STUDENT', 'TEACHER', 'PARENT')
);

DROP POLICY IF EXISTS "scanner_scope_profiles_select" ON public.profiles;
CREATE POLICY "scanner_scope_profiles_select"
ON public.profiles AS RESTRICTIVE FOR SELECT
USING (
  NOT public.is_scanner()
  OR id = auth.uid()
  OR (
    role = 'STUDENT'
    AND EXISTS (
      SELECT 1 FROM public.schedules s
      WHERE s.section_id = profiles.section_id
    )
  )
);

DROP POLICY IF EXISTS "school_admin_scope_profiles_insert" ON public.profiles;
CREATE POLICY "school_admin_scope_profiles_insert"
ON public.profiles AS RESTRICTIVE FOR INSERT
WITH CHECK (
  NOT public.is_school_admin()
  OR role IN ('STUDENT', 'TEACHER', 'PARENT')
);

DROP POLICY IF EXISTS "school_admin_scope_profiles_update" ON public.profiles;
CREATE POLICY "school_admin_scope_profiles_update"
ON public.profiles AS RESTRICTIVE FOR UPDATE
USING (
  NOT public.is_school_admin()
  OR role IN ('STUDENT', 'TEACHER', 'PARENT')
)
WITH CHECK (
  NOT public.is_school_admin()
  OR role IN ('STUDENT', 'TEACHER', 'PARENT')
);

DROP POLICY IF EXISTS "school_admin_cannot_delete_profiles" ON public.profiles;
CREATE POLICY "school_admin_cannot_delete_profiles"
ON public.profiles AS RESTRICTIVE FOR DELETE
USING (NOT public.is_school_admin());

DROP POLICY IF EXISTS "active_authenticated_profiles_select" ON public.profiles;
CREATE POLICY "active_authenticated_profiles_select"
ON public.profiles AS RESTRICTIVE FOR SELECT
USING (public.is_active_authenticated_user() OR id = auth.uid());

DROP POLICY IF EXISTS "active_authenticated_profiles_insert" ON public.profiles;
CREATE POLICY "active_authenticated_profiles_insert"
ON public.profiles AS RESTRICTIVE FOR INSERT
WITH CHECK (public.is_active_authenticated_user());

DROP POLICY IF EXISTS "active_authenticated_profiles_update" ON public.profiles;
CREATE POLICY "active_authenticated_profiles_update"
ON public.profiles AS RESTRICTIVE FOR UPDATE
USING (public.is_active_authenticated_user())
WITH CHECK (public.is_active_authenticated_user());

DROP POLICY IF EXISTS "active_authenticated_profiles_delete" ON public.profiles;
CREATE POLICY "active_authenticated_profiles_delete"
ON public.profiles AS RESTRICTIVE FOR DELETE
USING (public.is_active_authenticated_user());

ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "web_admin_manage_subjects" ON public.subjects;
CREATE POLICY "web_admin_manage_subjects"
ON public.subjects FOR ALL
USING (public.is_web_admin())
WITH CHECK (public.is_web_admin());

DROP POLICY IF EXISTS "school_admin_manage_subjects" ON public.subjects;
CREATE POLICY "school_admin_manage_subjects"
ON public.subjects FOR ALL
USING (public.is_school_admin())
WITH CHECK (public.is_school_admin());

DROP POLICY IF EXISTS "teachers_view_assigned_subjects" ON public.subjects;
CREATE POLICY "teachers_view_assigned_subjects"
ON public.subjects FOR SELECT
USING (
  public.is_teacher()
  AND EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.subject_id::TEXT = subjects.id::TEXT
      AND s.teacher_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "active_authenticated_subjects_only" ON public.subjects;
CREATE POLICY "active_authenticated_subjects_only"
ON public.subjects AS RESTRICTIVE FOR ALL
USING (public.is_active_authenticated_user())
WITH CHECK (public.is_active_authenticated_user());

ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "web_admin_manage_sections" ON public.sections;
CREATE POLICY "web_admin_manage_sections"
ON public.sections FOR ALL
USING (public.is_web_admin())
WITH CHECK (public.is_web_admin());

DROP POLICY IF EXISTS "school_admin_manage_sections" ON public.sections;
CREATE POLICY "school_admin_manage_sections"
ON public.sections FOR ALL
USING (public.is_school_admin())
WITH CHECK (public.is_school_admin());

DROP POLICY IF EXISTS "teachers_view_assigned_sections" ON public.sections;
CREATE POLICY "teachers_view_assigned_sections"
ON public.sections FOR SELECT
USING (
  public.is_teacher()
  AND EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.section_id = sections.id
      AND s.teacher_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "scanner_view_scheduled_sections" ON public.sections;
CREATE POLICY "scanner_view_scheduled_sections"
ON public.sections FOR SELECT
USING (
  public.is_scanner()
  AND EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.section_id = sections.id
  )
);

DROP POLICY IF EXISTS "active_authenticated_sections_only" ON public.sections;
CREATE POLICY "active_authenticated_sections_only"
ON public.sections AS RESTRICTIVE FOR ALL
USING (public.is_active_authenticated_user())
WITH CHECK (public.is_active_authenticated_user());

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "web_admin_manage_schedules" ON public.schedules;
CREATE POLICY "web_admin_manage_schedules"
ON public.schedules FOR ALL
USING (public.is_web_admin())
WITH CHECK (public.is_web_admin());

DROP POLICY IF EXISTS "school_admin_manage_schedules" ON public.schedules;
CREATE POLICY "school_admin_manage_schedules"
ON public.schedules FOR ALL
USING (public.is_school_admin())
WITH CHECK (public.is_school_admin());

DROP POLICY IF EXISTS "scanner_view_schedules" ON public.schedules;
CREATE POLICY "scanner_view_schedules"
ON public.schedules FOR SELECT
USING (public.is_scanner());

DROP POLICY IF EXISTS "active_authenticated_schedules_only" ON public.schedules;
CREATE POLICY "active_authenticated_schedules_only"
ON public.schedules AS RESTRICTIVE FOR ALL
USING (public.is_active_authenticated_user())
WITH CHECK (public.is_active_authenticated_user());

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "web_admin_manage_attendance" ON public.attendance;
CREATE POLICY "web_admin_manage_attendance"
ON public.attendance FOR ALL
USING (public.is_web_admin())
WITH CHECK (public.is_web_admin());

DROP POLICY IF EXISTS "school_admin_view_attendance" ON public.attendance;
CREATE POLICY "school_admin_view_attendance"
ON public.attendance FOR SELECT
USING (public.is_school_admin());

DROP POLICY IF EXISTS "school_admin_read_only_attendance_insert" ON public.attendance;
CREATE POLICY "school_admin_read_only_attendance_insert"
ON public.attendance AS RESTRICTIVE FOR INSERT
WITH CHECK (NOT public.is_school_admin());

DROP POLICY IF EXISTS "school_admin_read_only_attendance_update" ON public.attendance;
CREATE POLICY "school_admin_read_only_attendance_update"
ON public.attendance AS RESTRICTIVE FOR UPDATE
USING (NOT public.is_school_admin())
WITH CHECK (NOT public.is_school_admin());

DROP POLICY IF EXISTS "school_admin_read_only_attendance_delete" ON public.attendance;
CREATE POLICY "school_admin_read_only_attendance_delete"
ON public.attendance AS RESTRICTIVE FOR DELETE
USING (NOT public.is_school_admin());

DROP POLICY IF EXISTS "scanner_view_current_attendance" ON public.attendance;
CREATE POLICY "scanner_view_current_attendance"
ON public.attendance FOR SELECT
USING (
  public.is_scanner()
  AND attendance_date = (NOW() AT TIME ZONE 'Asia/Manila')::DATE
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
      AND p.section_id = attendance.section_id
  )
);

DROP POLICY IF EXISTS "scanner_record_current_attendance" ON public.attendance;
CREATE POLICY "scanner_record_current_attendance"
ON public.attendance FOR INSERT
WITH CHECK (
  public.is_scanner()
  AND status = 'present'
  AND attendance_date = (NOW() AT TIME ZONE 'Asia/Manila')::DATE
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
      AND p.section_id = attendance.section_id
  )
);

DROP POLICY IF EXISTS "scanner_update_current_attendance" ON public.attendance;
CREATE POLICY "scanner_update_current_attendance"
ON public.attendance FOR UPDATE
USING (
  public.is_scanner()
  AND status = 'absent'
  AND attendance_date = (NOW() AT TIME ZONE 'Asia/Manila')::DATE
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
      AND p.section_id = attendance.section_id
  )
)
WITH CHECK (
  public.is_scanner()
  AND status = 'present'
  AND attendance_date = (NOW() AT TIME ZONE 'Asia/Manila')::DATE
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
      AND p.section_id = attendance.section_id
  )
);

DROP POLICY IF EXISTS "scanner_cannot_delete_attendance" ON public.attendance;
CREATE POLICY "scanner_cannot_delete_attendance"
ON public.attendance AS RESTRICTIVE FOR DELETE
USING (NOT public.is_scanner());

DROP POLICY IF EXISTS "active_authenticated_attendance_only" ON public.attendance;
CREATE POLICY "active_authenticated_attendance_only"
ON public.attendance AS RESTRICTIVE FOR ALL
USING (public.is_active_authenticated_user())
WITH CHECK (public.is_active_authenticated_user());

ALTER TABLE public.grades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "web_admin_manage_grades" ON public.grades;
CREATE POLICY "web_admin_manage_grades"
ON public.grades FOR ALL
USING (public.is_web_admin())
WITH CHECK (public.is_web_admin());

DROP POLICY IF EXISTS "school_admin_view_grades" ON public.grades;
CREATE POLICY "school_admin_view_grades"
ON public.grades FOR SELECT
USING (public.is_school_admin());

DROP POLICY IF EXISTS "school_admin_read_only_grades_insert" ON public.grades;
CREATE POLICY "school_admin_read_only_grades_insert"
ON public.grades AS RESTRICTIVE FOR INSERT
WITH CHECK (NOT public.is_school_admin());

DROP POLICY IF EXISTS "school_admin_read_only_grades_update" ON public.grades;
CREATE POLICY "school_admin_read_only_grades_update"
ON public.grades AS RESTRICTIVE FOR UPDATE
USING (NOT public.is_school_admin())
WITH CHECK (NOT public.is_school_admin());

DROP POLICY IF EXISTS "school_admin_read_only_grades_delete" ON public.grades;
CREATE POLICY "school_admin_read_only_grades_delete"
ON public.grades AS RESTRICTIVE FOR DELETE
USING (NOT public.is_school_admin());

DROP POLICY IF EXISTS "active_authenticated_grades_only" ON public.grades;
CREATE POLICY "active_authenticated_grades_only"
ON public.grades AS RESTRICTIVE FOR ALL
USING (public.is_active_authenticated_user())
WITH CHECK (public.is_active_authenticated_user());
