ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender TEXT,
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS linked_student_id UUID
    REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_student_student_id_unique
  ON public.profiles (LOWER(BTRIM(student_id)))
  WHERE role = 'STUDENT' AND NULLIF(BTRIM(student_id), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS profiles_linked_student_id_idx
  ON public.profiles (linked_student_id)
  WHERE linked_student_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.can_view_student_portal_profile(student_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles viewer
    JOIN public.profiles student
      ON student.id = student_profile_id
     AND student.role = 'STUDENT'
    WHERE viewer.id = auth.uid()
      AND LOWER(COALESCE(viewer.status, 'active')) = 'active'
      AND LOWER(COALESCE(student.status, 'active')) <> 'archived'
      AND (
        (viewer.role = 'STUDENT' AND viewer.id = student.id)
        OR (viewer.role = 'PARENT' AND viewer.linked_student_id = student.id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_student_portal_section(student_section_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles student
    WHERE student.role = 'STUDENT'
      AND student.section_id::TEXT = student_section_id::TEXT
      AND public.can_view_student_portal_profile(student.id)
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_student_portal_section(student_section_id BIGINT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles student
    WHERE student.role = 'STUDENT'
      AND student.section_id::TEXT = student_section_id::TEXT
      AND public.can_view_student_portal_profile(student.id)
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_student_portal_profile(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_student_portal_section(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_student_portal_section(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_student_portal_profile(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_student_portal_section(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_student_portal_section(BIGINT) TO authenticated;

DROP POLICY IF EXISTS "student_parent_view_permitted_profiles" ON public.profiles;
CREATE POLICY "student_parent_view_permitted_profiles"
  ON public.profiles FOR SELECT
  USING (
    (id = auth.uid() AND role = 'PARENT')
    OR public.can_view_student_portal_profile(id)
  );

DROP POLICY IF EXISTS "student_parent_view_permitted_attendance" ON public.attendance;
CREATE POLICY "student_parent_view_permitted_attendance"
  ON public.attendance FOR SELECT
  USING (public.can_view_student_portal_profile(student_id));

DROP POLICY IF EXISTS "student_parent_view_permitted_grades" ON public.grades;
CREATE POLICY "student_parent_view_permitted_grades"
  ON public.grades FOR SELECT
  USING (public.can_view_student_portal_profile(student_id));

DROP POLICY IF EXISTS "student_parent_view_permitted_schedules" ON public.schedules;
CREATE POLICY "student_parent_view_permitted_schedules"
  ON public.schedules FOR SELECT
  USING (public.can_view_student_portal_section(section_id));

DROP POLICY IF EXISTS "student_parent_view_permitted_sections" ON public.sections;
CREATE POLICY "student_parent_view_permitted_sections"
  ON public.sections FOR SELECT
  USING (public.can_view_student_portal_section(id));

DROP POLICY IF EXISTS "student_parent_view_permitted_subjects" ON public.subjects;
CREATE POLICY "student_parent_view_permitted_subjects"
  ON public.subjects FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.schedules schedule
      WHERE schedule.subject_id::TEXT = subjects.id::TEXT
        AND public.can_view_student_portal_section(schedule.section_id)
    )
  );

CREATE OR REPLACE FUNCTION public.get_student_portal_teacher_names(p_student_id UUID)
RETURNS TABLE(id UUID, name TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_view_student_portal_profile(p_student_id) THEN
    RAISE EXCEPTION 'Not authorized to view these class teachers.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT teacher.id, teacher.name
  FROM public.profiles student
  JOIN public.schedules schedule ON schedule.section_id = student.section_id
  JOIN public.profiles teacher ON teacher.id = schedule.teacher_id
  WHERE student.id = p_student_id
    AND student.role = 'STUDENT'
    AND teacher.role = 'TEACHER'
  ORDER BY teacher.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_portal_teacher_names(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_portal_teacher_names(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_student_portal_guardians(p_student_id UUID)
RETURNS TABLE(id UUID, name TEXT, email TEXT, contact TEXT, relation TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_view_student_portal_profile(p_student_id) THEN
    RAISE EXCEPTION 'Not authorized to view these guardian details.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT parent.id, parent.name, parent.email, parent.contact, parent.relation
  FROM public.profiles parent
  WHERE parent.role = 'PARENT'
    AND parent.linked_student_id = p_student_id
    AND LOWER(COALESCE(parent.status, 'active')) = 'active'
    AND (
      parent.id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.profiles viewer
        WHERE viewer.id = auth.uid()
          AND viewer.role = 'STUDENT'
      )
    )
  ORDER BY parent.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_portal_guardians(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_portal_guardians(UUID) TO authenticated;
